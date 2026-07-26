/**
 * PROTOTYPE — the portable half. Schema plus the retrieval queries under test.
 * No terminal code, no logging: the TUI imports this and calls into it.
 */
import type { Sql } from 'postgres';

import type { CorpusDoc, Trust } from './corpus.ts';

export const SCHEMA = 'prototype_retrieval_wipe_me';

export type Descriptor = {
	path: string;
	title: string;
	summary: string;
	status: string;
	trust: Trust;
	rank: number;
};

export type PrefixMode = 'like' | 'ltree';

export type BrowseResult = {
	children: { segment: string; subtreeCount: number }[];
	documents: { path: string; title: string; trust: Trust }[];
};

/** `stack/drizzle/migration-workflow` -> `stack.drizzle.migration-workflow` */
export function toLtree(path: string): string {
	return path.split('/').join('.');
}

/** Path segments as searchable words: `stack/drizzle/migration-workflow` -> `stack drizzle migration workflow` */
export function pathWords(path: string): string {
	return path.split(/[/-]/).join(' ');
}

export async function reset(sql: Sql) {
	await sql.unsafe(`
		drop schema if exists ${SCHEMA} cascade;
		create schema ${SCHEMA};
		create extension if not exists ltree;
		set search_path to ${SCHEMA}, public;

		create table document (
			id serial primary key,
			path text not null unique,
			path_ltree ltree not null,
			created_at timestamptz not null default now()
		);

		create table revision (
			id serial primary key,
			document_id integer not null references document(id),
			revision_number integer not null,
			-- PROTOTYPE ONLY: denormalised so the generated tsvector can include path segments.
			path_words text not null,
			title text not null,
			summary text not null,
			body text not null,
			status text not null default 'stable',
			trust text not null default 'unverified',
			created_at timestamptz not null default now(),

			-- ARM 1: the candidate. Path segments and title weigh most, summary next, body last.
			search_weighted tsvector generated always as (
				setweight(to_tsvector('english', path_words), 'A') ||
				setweight(to_tsvector('english', title), 'A') ||
				setweight(to_tsvector('english', summary), 'B') ||
				setweight(to_tsvector('english', body), 'C')
			) stored,

			-- ARM 2: the control. Body only, no weighting, no path.
			search_body tsvector generated always as (to_tsvector('english', body)) stored,

			unique (document_id, revision_number)
		);

		create index revision_weighted_gin on revision using gin (search_weighted);
		create index revision_body_gin on revision using gin (search_body);

		-- ARM 3a: plain text prefix matching.
		create index document_path_prefix on document (path text_pattern_ops);
		-- ARM 3b: ltree subtree containment.
		create index document_path_ltree on document using gist (path_ltree);
	`);
}

export async function seed(sql: Sql, docs: CorpusDoc[]) {
	for (const doc of docs) {
		const [row] = await sql<{ id: number }[]>`
			insert into ${sql(SCHEMA)}.document (path, path_ltree)
			values (${doc.path}, ${toLtree(doc.path)})
			returning id
		`;
		await sql`
			insert into ${sql(SCHEMA)}.revision
				(document_id, revision_number, path_words, title, summary, body, status, trust)
			values (${row.id}, 1, ${pathWords(doc.path)}, ${doc.title}, ${doc.summary},
				${doc.body}, ${doc.status}, ${doc.trust})
		`;
	}
}

/**
 * Pad the corpus with filler documents so query plans are realistic. The real corpus is 14 rows,
 * where PostgreSQL will seq-scan everything and every index looks pointless.
 */
export async function inflate(sql: Sql, count: number) {
	await sql`
		insert into ${sql(SCHEMA)}.document (path, path_ltree)
		select p, ${sql('replace')}(p, '/', '.')::ltree from (
			select 'filler/area-' || (i / 100) || '/topic-' || (i % 100) || '/doc-' || i as p
			from generate_series(1, ${count}) i
		) g
		on conflict do nothing
	`;
	await sql`
		insert into ${sql(SCHEMA)}.revision
			(document_id, revision_number, path_words, title, summary, body, status, trust)
		select d.id, 1, ${sql('replace')}(${sql('replace')}(d.path, '/', ' '), '-', ' '),
			'Filler document ' || d.id,
			'Filler summary for load testing the query planner.',
			'Filler body about unrelated subjects: kubernetes ingress, terraform state, ' ||
				'python packaging, rust borrow checker, document ' || d.id,
			'stable', 'unverified'
		from ${sql(SCHEMA)}.document d
		where d.path like 'filler/%'
			and not exists (select 1 from ${sql(SCHEMA)}.revision r where r.document_id = d.id)
	`;
	// Without this the planner works off stale stats and an unflushed GIN pending list, and picks a
	// seq scan over an index that is in fact much cheaper.
	await sql.unsafe(`vacuum analyze ${SCHEMA}.document, ${SCHEMA}.revision`);
}

export async function count(sql: Sql) {
	const [row] = await sql<{ n: number }[]>`
		select count(*)::int as n from ${sql(SCHEMA)}.document
	`;
	return row.n;
}

const ARM_COLUMN = { weighted: 'search_weighted', body: 'search_body' } as const;

export type Arm = keyof typeof ARM_COLUMN;

/**
 * `and` is stock `websearch_to_tsquery`: every term must appear. `or` stems the query through the
 * same dictionary, drops stopwords, then ORs the lexemes, so a conversational query degrades into
 * ranked partial matches instead of returning nothing.
 */
export type QueryMode = 'and' | 'or';

export async function search(
	sql: Sql,
	query: string,
	arm: Arm,
	mode: QueryMode = 'and',
	limit = 8
): Promise<Descriptor[]> {
	const column = ARM_COLUMN[arm];
	const tsquery =
		mode === 'and'
			? sql`select websearch_to_tsquery('english', ${query}) as q`
			: sql`
					select coalesce(string_agg(lexeme, ' | '), '')::tsquery as q
					from unnest(to_tsvector('english', ${query}))
				`;
	return sql<Descriptor[]>`
		with tsq as (${tsquery})
		select d.path, r.title, r.summary, r.status, r.trust,
			ts_rank_cd(r.${sql(column)}, tsq.q, 32) as rank
		from ${sql(SCHEMA)}.revision r
		join ${sql(SCHEMA)}.document d on d.id = r.document_id
		cross join tsq
		where r.${sql(column)} @@ tsq.q
		order by rank desc, d.path
		limit ${limit}
	`;
}

export async function browse(sql: Sql, prefix: string, mode: PrefixMode): Promise<BrowseResult> {
	const depth = prefix === '' ? 0 : prefix.split('/').length;
	const rows =
		mode === 'like'
			? await sql<{ path: string; title: string; trust: Trust }[]>`
					select d.path, r.title, r.trust
					from ${sql(SCHEMA)}.document d
					join ${sql(SCHEMA)}.revision r on r.document_id = d.id
					where ${prefix === '' ? sql`true` : sql`d.path like ${prefix + '/%'}`}
					order by d.path
				`
			: await sql<{ path: string; title: string; trust: Trust }[]>`
					select d.path, r.title, r.trust
					from ${sql(SCHEMA)}.document d
					join ${sql(SCHEMA)}.revision r on r.document_id = d.id
					where ${prefix === '' ? sql`true` : sql`d.path_ltree <@ ${toLtree(prefix)}::ltree`}
					order by d.path
				`;

	const counts = new Map<string, number>();
	for (const row of rows) {
		const segments = row.path.split('/');
		const child = segments[depth];
		if (child !== undefined) counts.set(child, (counts.get(child) ?? 0) + 1);
	}

	return {
		children: [...counts]
			.map(([segment, subtreeCount]) => ({ segment, subtreeCount }))
			.sort((a, b) => a.segment.localeCompare(b.segment)),
		documents: rows
	};
}

/**
 * A node in a listing: either a leaf (a Document, so it has a Revision's title and summary) or an
 * intermediate segment, which owns no metadata at all — #7 made Document a thin identity anchor, so
 * a segment is a bare word. `descendantTitles` is what an intermediate node can borrow from below it
 * without inventing any new domain concept.
 */
export type ListingNode = {
	segment: string;
	path: string;
	isDocument: boolean;
	docCount: number;
	title?: string;
	summary?: string;
	trust?: Trust;
	descendantTitles: string[];
};

/** What `find_documents(prefix)` returns for one level of the tree. */
export async function listing(sql: Sql, prefix: string): Promise<ListingNode[]> {
	const depth = prefix === '' ? 0 : prefix.split('/').length;
	const rows = await sql<{ path: string; title: string; summary: string; trust: Trust }[]>`
		select d.path, r.title, r.summary, r.trust
		from ${sql(SCHEMA)}.document d
		join ${sql(SCHEMA)}.revision r on r.document_id = d.id
		where ${prefix === '' ? sql`true` : sql`d.path like ${prefix + '/%'}`}
		order by d.path
	`;

	const nodes = new Map<string, ListingNode>();
	for (const row of rows) {
		const segments = row.path.split('/');
		const segment = segments[depth];
		if (segment === undefined) continue;
		const path = prefix === '' ? segment : `${prefix}/${segment}`;
		const isDocument = segments.length === depth + 1;
		const node = nodes.get(segment) ?? {
			segment,
			path,
			isDocument,
			docCount: 0,
			descendantTitles: []
		};
		node.docCount++;
		if (isDocument) {
			node.title = row.title;
			node.summary = row.summary;
			node.trust = row.trust;
		} else {
			node.descendantTitles.push(row.title);
		}
		nodes.set(segment, node);
	}

	return [...nodes.values()].sort((a, b) => a.segment.localeCompare(b.segment));
}

/**
 * How the service could render one level. The question traversal turns on is not correctness but
 * cost: an agent walking the tree pays for every level, so the descriptor has to be legible enough
 * to choose a branch and cheap enough that walking beats dumping the whole corpus.
 */
export type ListingStyle =
	| 'segments'
	| 'segments-and-counts'
	| 'borrowed-titles'
	| 'full'
	/**
	 * Asymmetric: an intermediate node gets a bare segment and a count, because the segment is
	 * human-authored and legible by construction and anything more is paid for at every level of the
	 * walk. A leaf gets title, summary and trust, because that is the level where the choice is
	 * actually made and where two siblings can be indistinguishable by name.
	 */
	| 'progressive';

export function renderListing(nodes: ListingNode[], style: ListingStyle): string {
	return nodes
		.map((node) => {
			const name = node.isDocument ? node.segment : `${node.segment}/`;
			if (style === 'segments') return name;
			if (style === 'segments-and-counts')
				return node.isDocument ? name : `${name} (${node.docCount})`;
			if (style === 'progressive')
				return node.isDocument
					? `${name} — ${node.title}\n    ${node.summary} [${node.trust}]`
					: `${name} (${node.docCount})`;
			if (style === 'borrowed-titles')
				return node.isDocument
					? `${name} — ${node.title}`
					: `${name} (${node.docCount}) — ${node.descendantTitles.slice(0, 3).join('; ')}`;
			return node.isDocument
				? `${name} — ${node.title}\n    ${node.summary} [${node.trust}]`
				: `${name} (${node.docCount}) — ${node.descendantTitles.join('; ')}`;
		})
		.join('\n');
}

/** Every document as one flat listing — the alternative to walking at all. */
export async function flatListing(
	sql: Sql,
	style: 'paths' | 'paths-and-titles' | 'paths-titles-summaries'
): Promise<string> {
	const rows = await sql<{ path: string; title: string; summary: string; trust: Trust }[]>`
		select d.path, r.title, r.summary, r.trust
		from ${sql(SCHEMA)}.document d
		join ${sql(SCHEMA)}.revision r on r.document_id = d.id
		order by d.path
	`;
	return rows
		.map((row) =>
			style === 'paths'
				? row.path
				: style === 'paths-and-titles'
					? `${row.path} — ${row.title}`
					: `${row.path} — ${row.title}\n    ${row.summary} [${row.trust}]`
		)
		.join('\n');
}

/** Rough token count. Good enough to compare orders of magnitude, which is all this decides. */
export function tokens(text: string): number {
	return Math.ceil(text.length / 4);
}

export async function plan(sql: Sql, kind: 'search' | 'like' | 'ltree', input: string) {
	const query =
		kind === 'search'
			? sql`
					explain (analyze, buffers)
					select d.path, ts_rank_cd(r.search_weighted, q, 32)
					from ${sql(SCHEMA)}.revision r
					join ${sql(SCHEMA)}.document d on d.id = r.document_id,
						websearch_to_tsquery('english', ${input}) q
					where r.search_weighted @@ q
					order by 2 desc limit 8
				`
			: kind === 'like'
				? sql`
						explain (analyze, buffers)
						select d.path from ${sql(SCHEMA)}.document d where d.path like ${input + '/%'}
					`
				: sql`
						explain (analyze, buffers)
						select d.path from ${sql(SCHEMA)}.document d
						where d.path_ltree <@ ${toLtree(input)}::ltree
					`;
	const rows = await query;
	return rows.map((row) => Object.values(row)[0] as string);
}
