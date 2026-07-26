import { type SQL, sql } from 'drizzle-orm';
import {
	customType,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	serial,
	text,
	timestamp,
	unique
} from 'drizzle-orm/pg-core';

/** A flat source list on a Revision. No stable source ids, no claim-level joins. */
export type RevisionSource = { uri: string; title?: string };

const tsvector = customType<{ data: string; driverData: string }>({
	dataType: () => 'tsvector'
});

export const knowledgeStatus = pgEnum('knowledge_status', ['draft', 'stable', 'deprecated']);
export const knowledgeVerdict = pgEnum('knowledge_verdict', ['approved', 'rejected']);

/**
 * A thin identity anchor: the Document Path and nothing else. The row exists to be the global
 * uniqueness constraint on paths; every piece of content lives on a Revision.
 */
export const knowledgeDocument = pgTable(
	'knowledge_document',
	{
		id: serial('id').primaryKey(),
		path: text('path').notNull().unique(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		// `path like 'stack/drizzle/%'` — measured as good as ltree containment and needs no extension.
		index('knowledge_document_path_prefix').using(
			'btree',
			sql`${t.path} text_pattern_ops`.inlineParams()
		)
	]
);

/**
 * An immutable version of a Document. The highest `revisionNumber` for a document is current, so
 * there is no current-revision pointer to drift.
 */
export const knowledgeRevision = pgTable(
	'knowledge_revision',
	{
		id: serial('id').primaryKey(),
		documentId: integer('document_id')
			.notNull()
			.references(() => knowledgeDocument.id),
		revisionNumber: integer('revision_number').notNull(),
		/**
		 * The Document Path as searchable words, denormalised so the generated `tsvector` below can
		 * weight path segments — a generated column cannot read another table. Safe because a Document
		 * Path is immutable.
		 */
		pathWords: text('path_words').notNull(),
		title: text('title').notNull(),
		summary: text('summary').notNull(),
		body: text('body').notNull(),
		status: knowledgeStatus('status').notNull().default('stable'),
		/** Author-asserted absolute date. Absent means no staleness claim, never "fresh". */
		staleAfter: timestamp('stale_after', { withTimezone: true }),
		authorActor: text('author_actor').notNull(),
		sources: jsonb('sources').$type<RevisionSource[]>().notNull().default([]),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		/**
		 * Path segments and title weigh most, summary next. Bodies are deliberately not indexed: a body
		 * of Mermaid, code fences and file paths yields noisy lexemes, and a false positive costs a
		 * whole `read_document` to discover it was irrelevant.
		 */
		search: tsvector('search').generatedAlwaysAs(
			(): SQL => sql`
				setweight(to_tsvector('english', path_words), 'A') ||
				setweight(to_tsvector('english', title), 'A') ||
				setweight(to_tsvector('english', summary), 'B')
			`
		)
	},
	(t) => [
		unique('knowledge_revision_number').on(t.documentId, t.revisionNumber),
		index('knowledge_revision_search').using('gin', t.search)
	]
);

/** A verdict about one exact Revision. Append-only; the latest verdict per actor is the live one. */
export const knowledgeReview = pgTable('knowledge_review', {
	id: serial('id').primaryKey(),
	revisionId: integer('revision_id')
		.notNull()
		.references(() => knowledgeRevision.id),
	actor: text('actor').notNull(),
	verdict: knowledgeVerdict('verdict').notNull(),
	note: text('note'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});
