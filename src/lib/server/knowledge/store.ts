/**
 * The four knowledge operations against PostgreSQL, in Drizzle.
 *
 * Every read has to pick the current Revision per Document and derive a Trust Tier from each actor's
 * latest verdict, so the reads are built from two CTEs. Raw `sql` appears only where PostgreSQL has
 * no builder equivalent: `bool_or`, aggregate `filter`, `tsquery` construction and `ts_rank_cd`.
 */
import { and, count, desc, eq, inArray, like, max, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { RevisionSource } from '../db/knowledge.schema';
import { knowledgeDocument, knowledgeReview, knowledgeRevision } from '../db/knowledge.schema';
import type * as schema from '../db/schema';
import {
	KnowledgeError,
	ancestorPrefixes,
	assertValidPath,
	assertValidPathPrefix,
	pathWords
} from './paths';

export type KnowledgeDb = PostgresJsDatabase<typeof schema>;

export type DocumentStatus = 'draft' | 'stable' | 'deprecated';
export type Verdict = 'approved' | 'rejected';
export type TrustTier = 'unverified' | 'agent-reviewed' | 'human-reviewed';

/** What `find_documents` shows for one document: everything but the body. */
export type Descriptor = {
	path: string;
	title: string;
	summary: string;
	status: DocumentStatus;
	trustTier: TrustTier;
	stale: boolean;
	updatedAt: Date;
};

/**
 * One node of the browsed subtree. A segment may be both a document and a branch — the grammar
 * reserves nothing, so `a/b` may be a document while `a/b/c` also exists — and that needs no special
 * case here: it is a node that happens to be a document and happens to have children.
 */
export type ListingNode = {
	segment: string;
	/** Set only at the immediate level. Deeper nodes are bare names: descriptors there cost more than they return. */
	descriptor?: Descriptor;
	/** False for a segment with no document of its own, which renders with a trailing slash. */
	isDocument: boolean;
	children: ListingNode[];
	/** Documents strictly beneath, counted only at the depth boundary — everything above it is expanded. */
	hiddenCount: number;
};

/** One top-level segment of the root skeleton: a name and how many documents live under it. */
export type RootSegment = { segment: string; isDocument: boolean; documentCount: number };

export type FindResult = (
	| { kind: 'hits'; hits: Descriptor[] }
	/** `self` is the document at exactly the browsed prefix, when one exists: the level describing itself. */
	| { kind: 'listing'; prefix: string; nodes: ListingNode[]; self?: Descriptor }
) & {
	/** The one-level bootstrap tree, present only on results that did not browse the tree themselves. */
	root?: RootSegment[];
};

export type DocumentDetail = Descriptor & {
	revisionNumber: number;
	revisionCount: number;
	body: string;
	rejectedCount: number;
	authorActor: string;
	createdAt: Date;
	sources: RevisionSource[];
};

export const DEFAULT_DEPTH = 3;
export const MAX_DEPTH = 5;
export const MAX_TITLE = 200;
export const MAX_SUMMARY = 500;

/** Each actor's live verdict on a revision: an actor who approves and then rejects no longer approves. */
function latestVerdictCte(db: KnowledgeDb) {
	return db.$with('latest_verdict').as(
		db
			.selectDistinctOn([knowledgeReview.revisionId, knowledgeReview.actor], {
				revisionId: knowledgeReview.revisionId,
				actor: knowledgeReview.actor,
				verdict: knowledgeReview.verdict
			})
			.from(knowledgeReview)
			.orderBy(
				knowledgeReview.revisionId,
				knowledgeReview.actor,
				desc(knowledgeReview.createdAt),
				desc(knowledgeReview.id)
			)
	);
}

/**
 * The Trust Tier, derived on read and never stored: any human approval wins, else any agent
 * approval, else unverified. Rejections never lower the tier — they surface as a count.
 */
function trustCte(db: KnowledgeDb, latestVerdict: ReturnType<typeof latestVerdictCte>) {
	return db.$with('trust').as(
		db
			.select({
				revisionId: latestVerdict.revisionId,
				trustTier: sql<TrustTier>`
					case
						when bool_or(${latestVerdict.verdict} = 'approved' and ${latestVerdict.actor} like 'human:%')
							then 'human-reviewed'
						when bool_or(${latestVerdict.verdict} = 'approved' and ${latestVerdict.actor} like 'agent:%')
							then 'agent-reviewed'
						else 'unverified'
					end
				`.as('trust_tier'),
				rejectedCount:
					sql<number>`count(*) filter (where ${latestVerdict.verdict} = 'rejected')::int`.as(
						'rejected_count'
					)
			})
			.from(latestVerdict)
			.groupBy(latestVerdict.revisionId)
	);
}

/** The current Revision of every Document: the highest revision number, with its path. */
function currentRevisionCte(db: KnowledgeDb) {
	return db.$with('current_revision').as(
		db
			.selectDistinctOn([knowledgeRevision.documentId], {
				id: knowledgeRevision.id,
				documentId: knowledgeRevision.documentId,
				revisionNumber: knowledgeRevision.revisionNumber,
				title: knowledgeRevision.title,
				summary: knowledgeRevision.summary,
				status: knowledgeRevision.status,
				staleAfter: knowledgeRevision.staleAfter,
				createdAt: knowledgeRevision.createdAt,
				search: knowledgeRevision.search,
				path: knowledgeDocument.path
			})
			.from(knowledgeRevision)
			.innerJoin(knowledgeDocument, eq(knowledgeDocument.id, knowledgeRevision.documentId))
			.orderBy(knowledgeRevision.documentId, desc(knowledgeRevision.revisionNumber))
	);
}

type CurrentRevision = ReturnType<typeof currentRevisionCte>;
type Trust = ReturnType<typeof trustCte>;

function descriptorFields(current: CurrentRevision, trust: Trust) {
	return {
		path: current.path,
		title: current.title,
		summary: current.summary,
		status: current.status,
		trustTier: sql<TrustTier>`coalesce(${trust.trustTier}, 'unverified')`.as('trust_tier'),
		// Absent `stale_after` means no staleness claim, which is reported as not stale rather than fresh.
		stale: sql<boolean>`coalesce(${current.staleAfter} < now(), false)`.as('stale'),
		updatedAt: current.createdAt
	};
}

function statusFilter(current: CurrentRevision, status: DocumentStatus[] | undefined) {
	return inArray(current.status, status?.length ? status : ['stable']);
}

function prefixFilter(current: CurrentRevision, prefix: string | undefined) {
	if (prefix === undefined) return undefined;
	return or(like(current.path, `${prefix}/%`), eq(current.path, prefix));
}

function boundedDepth(depth: number | undefined): number {
	if (depth === undefined) return DEFAULT_DEPTH;
	if (!Number.isInteger(depth) || depth < 1 || depth > MAX_DEPTH)
		throw new KnowledgeError(`depth: must be an integer between 1 and ${MAX_DEPTH}, got ${depth}`);
	return depth;
}

/**
 * The whole corpus at one level: top-level names with descendant counts, no descriptors. It rides on
 * every result that did not browse, because the server instructions are a channel with evidence of
 * being dropped while a tool *result* cannot be — so the only reliable place to tell an agent the tree
 * exists is the call it actually makes.
 */
async function rootSkeleton(
	db: KnowledgeDb,
	current: CurrentRevision,
	status: DocumentStatus[] | undefined
): Promise<RootSegment[]> {
	const segment = sql<string>`split_part(${current.path}, '/', 1)`;
	return db
		.with(current)
		.select({
			segment: segment.as('segment'),
			isDocument: sql<boolean>`bool_or(${current.path} = ${segment})`.as('is_document'),
			documentCount: sql<number>`count(*)::int`.as('document_count')
		})
		.from(current)
		.where(statusFilter(current, status))
		.groupBy(segment)
		.orderBy(segment);
}

export type WriteInput = {
	path: string;
	title: string;
	summary: string;
	body: string;
	status?: DocumentStatus;
	staleAfter?: string;
	sources?: RevisionSource[];
};

export type WriteOutcome = { path: string; revisionNumber: number; action: 'created' | 'revised' };

/**
 * Appends a Revision. A path that does not exist yet gets its Document row first, so one tool covers
 * first write and update and the path decides which — reported back as `action`. The revision number
 * is allocated inside the transaction, so numbering cannot collide.
 */
export async function writeDocument(
	db: KnowledgeDb,
	input: WriteInput,
	authorActor: string
): Promise<WriteOutcome> {
	const path = assertValidPath(input.path);
	if (input.title.length === 0 || input.title.length > MAX_TITLE)
		throw new KnowledgeError(`title: must be 1-${MAX_TITLE} characters, got ${input.title.length}`);
	if (input.summary.length === 0 || input.summary.length > MAX_SUMMARY)
		throw new KnowledgeError(
			`summary: must be 1-${MAX_SUMMARY} characters, got ${input.summary.length}`
		);
	if (input.body.trim().length === 0) throw new KnowledgeError('body: must not be empty');
	const staleAfter = input.staleAfter === undefined ? null : new Date(input.staleAfter);
	if (staleAfter !== null && Number.isNaN(staleAfter.getTime()))
		throw new KnowledgeError(`stale_after: must be an ISO 8601 date, got '${input.staleAfter}'`);

	return db.transaction(async (tx) => {
		await tx.insert(knowledgeDocument).values({ path }).onConflictDoNothing();
		const [document] = await tx
			.select({ id: knowledgeDocument.id })
			.from(knowledgeDocument)
			.where(eq(knowledgeDocument.path, path));
		const [previous] = await tx
			.select({ highest: max(knowledgeRevision.revisionNumber) })
			.from(knowledgeRevision)
			.where(eq(knowledgeRevision.documentId, document.id));
		const revisionNumber = (previous?.highest ?? 0) + 1;
		await tx.insert(knowledgeRevision).values({
			documentId: document.id,
			revisionNumber,
			pathWords: pathWords(path),
			title: input.title,
			summary: input.summary,
			body: input.body,
			status: input.status ?? 'stable',
			staleAfter,
			authorActor,
			sources: input.sources ?? []
		});
		return { path, revisionNumber, action: revisionNumber === 1 ? 'created' : 'revised' };
	});
}

export type FindInput = {
	pathPrefix?: string;
	query?: string;
	status?: DocumentStatus[];
	/** How many levels of the subtree a browse expands, counted from the immediate level. Ignored when `query` is set. */
	depth?: number;
};

/**
 * Two retrieval shapes behind one tool. A browse — no `query` — returns the subtree expanded to
 * `depth`: a table of contents, descriptors at the immediate level and bare names below it. A `query`
 * returns flat ranked hits instead. Neither shape is capped: ordering is opaque to the caller and
 * never influenced by Trust Tier.
 */
export async function findDocuments(db: KnowledgeDb, input: FindInput): Promise<FindResult> {
	const depth = boundedDepth(input.depth);
	const prefix =
		input.pathPrefix === undefined ? undefined : assertValidPathPrefix(input.pathPrefix);
	const query = input.query?.trim();

	const latestVerdict = latestVerdictCte(db);
	const trust = trustCte(db, latestVerdict);
	const current = currentRevisionCte(db);

	if (query) {
		// Stemming the query through the same dictionary and OR-ing the lexemes. Stock
		// `websearch_to_tsquery` ANDs every term, so one word the corpus lacks empties the result.
		const tsquery = sql`(
			select coalesce(string_agg(lexeme, ' | '), '')::tsquery
			from unnest(to_tsvector('english', ${query}))
		)`;
		const hits = await db
			.with(latestVerdict, trust, current)
			.select(descriptorFields(current, trust))
			.from(current)
			.leftJoin(trust, eq(trust.revisionId, current.id))
			.where(
				and(
					statusFilter(current, input.status),
					prefixFilter(current, prefix),
					sql`${current.search} @@ ${tsquery}`
				)
			)
			.orderBy(desc(sql`ts_rank_cd(${current.search}, ${tsquery}, 32)`), current.path);
		// A searcher never saw the tree, whether the search hit or missed.
		return { kind: 'hits', hits, root: await rootSkeleton(db, current, input.status) };
	}

	// The browse, in three queries: the immediate level with its descriptors, the bare names between
	// that level and the depth boundary, and the counts of whatever the boundary hides. Grouping in SQL
	// rather than over a fetched page keeps every count exact at any corpus size.
	const base = prefix === undefined ? 0 : prefix.split('/').length;
	// Both depths are inlined rather than bound: array slicing and the comparisons need typed integers,
	// and an untyped bind parameter arrives as text. Safe to inline — they derive from a validated prefix
	// and a range-checked `depth`.
	const level = sql.raw(String(base + 1));
	const boundary = sql.raw(String(base + depth));
	const pathDepth = sql<number>`array_length(string_to_array(${current.path}, '/'), 1)`;
	const atThisLevel = sql`${pathDepth} = ${level}`;
	const scope = and(statusFilter(current, input.status), prefixFilter(current, prefix));

	// The level's own documents, plus the document at exactly the prefix if there is one — it sorts
	// first, being a proper prefix of everything else.
	const levelRows = await db
		.with(latestVerdict, trust, current)
		.select(descriptorFields(current, trust))
		.from(current)
		.leftJoin(trust, eq(trust.revisionId, current.id))
		.where(
			and(scope, prefix === undefined ? atThisLevel : or(eq(current.path, prefix), atThisLevel))
		)
		.orderBy(current.path);

	// Everything between the immediate level and the boundary, as paths only: below the immediate level a
	// node is a bare name. A name needs no trust, so this query and the next skip the review CTEs.
	const innerRows =
		depth === 1
			? []
			: await db
					.with(current)
					.select({ path: current.path })
					.from(current)
					.where(and(scope, sql`${pathDepth} > ${level}`, sql`${pathDepth} <= ${boundary}`))
					.orderBy(current.path);

	// What the boundary hides, counted against the ancestor sitting on the boundary. Nothing above the
	// boundary carries a count, because everything above it is expanded; this one is the only signal
	// telling the agent whether descending is worth another call.
	const boundaryPath = sql<string>`array_to_string((string_to_array(${current.path}, '/'))[1:${boundary}], '/')`;
	const boundaryRows = await db
		.with(current)
		.select({
			path: boundaryPath.as('boundary_path'),
			documentCount: sql<number>`count(*)::int`.as('document_count')
		})
		.from(current)
		.where(and(scope, sql`${pathDepth} > ${boundary}`))
		.groupBy(boundaryPath);

	const self = prefix === undefined ? undefined : levelRows.find((row) => row.path === prefix);
	const roots = new Map<string, MutableNode>();
	const relative = (path: string) => path.slice(prefix === undefined ? 0 : prefix.length + 1);

	for (const descriptor of levelRows) {
		if (descriptor === self) continue;
		const node = nodeAt(roots, relative(descriptor.path));
		node.isDocument = true;
		node.descriptor = descriptor;
	}
	for (const row of innerRows) nodeAt(roots, relative(row.path)).isDocument = true;
	for (const row of boundaryRows) nodeAt(roots, relative(row.path)).hiddenCount = row.documentCount;

	// A browse that found nothing is the other place the tree is worth handing over: the caller guessed a
	// prefix that holds none, so the top level is strictly better information than what they asked for.
	// A browse that *did* find something needs no skeleton — it is looking at the tree already.
	const nodes = settleNodes(roots);
	const root =
		nodes.length === 0 && self === undefined
			? await rootSkeleton(db, current, input.status)
			: undefined;

	return { kind: 'listing', prefix: prefix ?? '', nodes, self, root };
}

type MutableNode = Omit<ListingNode, 'children'> & { children: Map<string, MutableNode> };

/**
 * The node at a path relative to the browsed prefix, creating it and every missing ancestor on the way.
 * Ancestors have to be creatable: a branch need not have a document of its own, and a document past the
 * boundary can be the only reason its levels exist at all.
 */
function nodeAt(roots: Map<string, MutableNode>, path: string): MutableNode {
	let siblings = roots;
	let node!: MutableNode;
	for (const segment of path.split('/')) {
		let found = siblings.get(segment);
		if (found === undefined) {
			found = { segment, isDocument: false, children: new Map(), hiddenCount: 0 };
			siblings.set(segment, found);
		}
		node = found;
		siblings = found.children;
	}
	return node;
}

/** The mutable tree, turned into the contract shape: children as sorted arrays. */
function settleNodes(siblings: Map<string, MutableNode>): ListingNode[] {
	return [...siblings.values()]
		.map((node) => ({ ...node, children: settleNodes(node.children) }))
		.sort((a, b) => a.segment.localeCompare(b.segment));
}

/** Unknown paths fail loudly with the nearest prefix that does exist — a silent empty result teaches nothing. */
async function nearestPrefixHint(db: KnowledgeDb, path: string): Promise<string> {
	for (const prefix of ancestorPrefixes(path)) {
		const [row] = await db
			.select({ documents: count() })
			.from(knowledgeDocument)
			.where(like(knowledgeDocument.path, `${prefix}/%`));
		if (row && row.documents > 0)
			return `no document at '${path}'; try find_documents with path_prefix '${prefix}'`;
	}
	return `no document at '${path}'; try find_documents with no path_prefix to see the top of the tree`;
}

/** The document's surrogate id plus its revision range — the shape both read and review need first. */
async function locateDocument(db: KnowledgeDb, path: string) {
	assertValidPath(path);
	const [document] = await db
		.select({
			id: knowledgeDocument.id,
			revisionCount: count(knowledgeRevision.id),
			highest: max(knowledgeRevision.revisionNumber)
		})
		.from(knowledgeDocument)
		.leftJoin(knowledgeRevision, eq(knowledgeRevision.documentId, knowledgeDocument.id))
		.where(eq(knowledgeDocument.path, path))
		.groupBy(knowledgeDocument.id);
	if (!document) throw new KnowledgeError(await nearestPrefixHint(db, path));
	return { id: document.id, revisionCount: document.revisionCount, highest: document.highest ?? 0 };
}

export async function readDocument(
	db: KnowledgeDb,
	path: string,
	revisionNumber?: number
): Promise<DocumentDetail> {
	const document = await locateDocument(db, path);
	const target = revisionNumber ?? document.highest;
	if (revisionNumber !== undefined && (revisionNumber < 1 || revisionNumber > document.highest))
		throw new KnowledgeError(
			`revision_number: '${path}' has revisions 1-${document.highest}, got ${revisionNumber}`
		);

	const latestVerdict = latestVerdictCte(db);
	const trust = trustCte(db, latestVerdict);
	const [row] = await db
		.with(latestVerdict, trust)
		.select({
			path: knowledgeDocument.path,
			title: knowledgeRevision.title,
			summary: knowledgeRevision.summary,
			status: knowledgeRevision.status,
			body: knowledgeRevision.body,
			revisionNumber: knowledgeRevision.revisionNumber,
			authorActor: knowledgeRevision.authorActor,
			sources: knowledgeRevision.sources,
			createdAt: knowledgeRevision.createdAt,
			trustTier: sql<TrustTier>`coalesce(${trust.trustTier}, 'unverified')`.as('trust_tier'),
			rejectedCount: sql<number>`coalesce(${trust.rejectedCount}, 0)`.as('rejected_count'),
			stale: sql<boolean>`coalesce(${knowledgeRevision.staleAfter} < now(), false)`.as('stale')
		})
		.from(knowledgeRevision)
		.innerJoin(knowledgeDocument, eq(knowledgeDocument.id, knowledgeRevision.documentId))
		.leftJoin(trust, eq(trust.revisionId, knowledgeRevision.id))
		.where(
			and(
				eq(knowledgeRevision.documentId, document.id),
				eq(knowledgeRevision.revisionNumber, target)
			)
		);
	if (!row) throw new KnowledgeError(`revision_number: '${path}' has no revision ${target}`);

	return {
		...row,
		revisionCount: document.revisionCount,
		updatedAt: row.createdAt,
		sources: row.sources ?? []
	};
}

export type ReviewInput = {
	path: string;
	revisionNumber: number;
	verdict: Verdict;
	note?: string;
};

export type ReviewOutcome = { path: string; revisionNumber: number; trustTier: TrustTier };

/**
 * Records a verdict against an exact Revision. Reviews append; the Trust Tier returned is derived
 * fresh, which is the fastest way to catch an `on_behalf_of` typo.
 */
export async function reviewDocument(
	db: KnowledgeDb,
	input: ReviewInput,
	actor: string
): Promise<ReviewOutcome> {
	const document = await locateDocument(db, input.path);
	const [revision] = await db
		.select({ id: knowledgeRevision.id })
		.from(knowledgeRevision)
		.where(
			and(
				eq(knowledgeRevision.documentId, document.id),
				eq(knowledgeRevision.revisionNumber, input.revisionNumber)
			)
		);
	if (!revision)
		throw new KnowledgeError(
			`revision_number: '${input.path}' has revisions 1-${document.highest}, got ${input.revisionNumber}`
		);

	await db.insert(knowledgeReview).values({
		revisionId: revision.id,
		actor,
		verdict: input.verdict,
		note: input.note ?? null
	});

	const latestVerdict = latestVerdictCte(db);
	const trust = trustCte(db, latestVerdict);
	const [row] = await db
		.with(latestVerdict, trust)
		.select({ trustTier: trust.trustTier })
		.from(trust)
		.where(eq(trust.revisionId, revision.id));

	return {
		path: input.path,
		revisionNumber: input.revisionNumber,
		trustTier: row?.trustTier ?? 'unverified'
	};
}
