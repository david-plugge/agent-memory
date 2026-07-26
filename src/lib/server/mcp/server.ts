/**
 * The MCP surface: four tools over the knowledge store.
 *
 * In a fresh session the tool descriptions and the server instructions are the *only* prompt telling
 * an agent this knowledge exists, so they are part of the contract, not documentation. They are
 * written in the consumer's vocabulary ("conventions, workflows, prior decisions") rather than the
 * service's ("Knowledge Document"), because an agent working on an unrelated feature does not know it
 * wants a Knowledge Document.
 */
import type { CallToolResult, McpServerFactory, ServerContext } from '@modelcontextprotocol/server';
import { CLIENT_INFO_META_KEY, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';

import { KnowledgeError, agentActor, assertHumanActor } from '../knowledge/paths';
import { renderDocument, renderFind, renderReview, renderWrite } from '../knowledge/render';
import type { KnowledgeDb } from '../knowledge/store';
import {
	DEFAULT_LIMIT,
	MAX_LIMIT,
	MAX_SUMMARY,
	MAX_TITLE,
	findDocuments,
	readDocument,
	reviewDocument,
	writeDocument
} from '../knowledge/store';

const INSTRUCTIONS = `Shared developer knowledge written by other agent sessions: conventions, workflows, and prior decisions for this stack and this team.

Before implementing anything, call find_documents to check whether the convention is already written down — browse the path tree or search for the process you are about to carry out. Read what looks relevant with read_document and follow it. When two documents conflict, prefer the one with the higher trust tier (human-reviewed over agent-reviewed over unverified).

When you settle something durable that a future session would need, write it with write_document.`;

const statusSchema = z.enum(['draft', 'stable', 'deprecated']);

const pathArg = z
	.string()
	.max(512)
	.describe(
		"The document's path: slash-separated lowercase segments, e.g. 'stack/drizzle/migration-workflow'."
	);

/**
 * Every Revision is agent-authored, and the author is the calling client rather than an argument:
 * accepting it would let a client forge authorship for free.
 *
 * The identity rides the per-request `_meta` envelope on the 2026-07-28 era, which also seeds the
 * server instance. A client that negotiates the 2025 era is served statelessly, one fresh instance per
 * request, and its `initialize` identity is gone — so authorship degrades to `agent:unknown`.
 */
function callerActor(server: McpServer, ctx: ServerContext): string {
	const envelope = ctx.mcpReq.envelope as Record<string, { name?: string }> | undefined;
	return agentActor(
		server.server.getClientVersion()?.name ?? envelope?.[CLIENT_INFO_META_KEY]?.name
	);
}

/**
 * Domain failures are tool errors with readable text, never JSON-RPC protocol errors: an agent can
 * read and recover from the former. Unexpected failures are sanitized — no SQL, no connection
 * strings, no stacks.
 */
async function toolResult(work: () => Promise<string>): Promise<CallToolResult> {
	try {
		return { content: [{ type: 'text', text: await work() }] };
	} catch (error) {
		if (error instanceof KnowledgeError)
			return { isError: true, content: [{ type: 'text', text: error.message }] };
		console.error('[mcp] knowledge tool failed', error);
		return {
			isError: true,
			content: [
				{
					type: 'text',
					text: 'The knowledge service could not complete that request. Retry, or narrow the request.'
				}
			]
		};
	}
}

/** A fresh server per serving unit; the database pool lives outside the factory and is closed over. */
export function knowledgeServerFactory(db: KnowledgeDb): McpServerFactory {
	return () => {
		const server = new McpServer(
			{ name: 'agent-memory-knowledge', version: '0.1.0' },
			{ instructions: INSTRUCTIONS }
		);

		server.registerTool(
			'find_documents',
			{
				title: 'Find shared developer knowledge',
				description: `Search shared developer knowledge for existing conventions, workflows, and prior decisions before implementing something. Covers paths, titles and summaries — not document bodies.

Two ways to look:
- Browse: pass path_prefix (omit it for the top of the tree) to see one level at a time. 'area/ (3)' is a branch with three documents beneath it; a leaf shows its title, summary and trust tier. Pass recursive to flatten the whole subtree instead.
- Search: pass query. Phrase it as the process you are carrying out ("how do I add a column with drizzle"), not as your task's own nouns ("favourite recipes per user") — the knowledge is written about processes and stacks.

Results are relevance-ordered and never ranked by trust; read the tiers yourself.`,
				inputSchema: z.strictObject({
					path_prefix: z
						.string()
						.max(512)
						.optional()
						.describe(
							"Browse under this path, e.g. 'stack/drizzle'. Omit for the top of the tree."
						),
					query: z
						.string()
						.max(500)
						.optional()
						.describe('Free text over paths, titles and summaries. Combines with path_prefix.'),
					status: z
						.array(statusSchema)
						.max(3)
						.optional()
						.describe("Defaults to ['stable']. Pass ['draft'] or ['deprecated'] to see those too."),
					recursive: z
						.boolean()
						.optional()
						.describe(
							'Browse the whole subtree flat instead of one level. Ignored when query is set.'
						),
					limit: z
						.number()
						.int()
						.min(1)
						.max(MAX_LIMIT)
						.optional()
						.describe(
							`Default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}. Narrow your query instead of paging.`
						)
				}),
				annotations: { readOnlyHint: true, idempotentHint: true }
			},
			async (args) =>
				toolResult(async () =>
					renderFind(
						await findDocuments(db, {
							pathPrefix: args.path_prefix,
							query: args.query,
							status: args.status,
							recursive: args.recursive,
							limit: args.limit
						})
					)
				)
		);

		server.registerTool(
			'read_document',
			{
				title: 'Read a knowledge document',
				description: `Read one document found through find_documents, in full. Returns its body plus status, trust tier, staleness, author and revision count.

Pass revision_number to read an older revision; 'revision 3 of 5' means you can walk backwards by decrementing.`,
				inputSchema: z.strictObject({
					path: pathArg,
					revision_number: z
						.number()
						.int()
						.min(1)
						.optional()
						.describe('Defaults to the current (highest) revision.')
				}),
				annotations: { readOnlyHint: true, idempotentHint: true }
			},
			async (args) =>
				toolResult(async () =>
					renderDocument(await readDocument(db, args.path, args.revision_number))
				)
		);

		server.registerTool(
			'write_document',
			{
				title: 'Write shared developer knowledge',
				description: `Record something durable a future session would need: a convention, a workflow, a decision and its reasoning. Markdown body, stored verbatim.

Call find_documents first to see neighbouring paths and pick one that fits the existing tree. Write the summary as a retrieval surface: include the words a developer would search for, including tool and command names — paths, titles and summaries are the entire search index, so a badly-worded summary makes the document unfindable.

An existing path appends a new revision rather than failing; the response says which happened. Revisions are immutable and a new one starts back at the 'unverified' trust tier.`,
				inputSchema: z.strictObject({
					path: pathArg,
					title: z.string().min(1).max(MAX_TITLE),
					summary: z
						.string()
						.min(1)
						.max(MAX_SUMMARY)
						.describe('The retrieval surface and the teaser, in one. Searchable words, no fluff.'),
					body: z.string().min(1).describe('The document itself, as Markdown.'),
					status: statusSchema
						.optional()
						.describe(
							"Defaults to 'stable'. 'draft' means authored but not ready to be found; 'deprecated' retires it."
						),
					stale_after: z
						.string()
						.max(40)
						.optional()
						.describe('ISO 8601 date after which this content should be treated as stale.'),
					sources: z
						.array(
							z.strictObject({ uri: z.string().max(2048), title: z.string().max(200).optional() })
						)
						.max(20)
						.optional()
				}),
				annotations: { readOnlyHint: false, idempotentHint: false }
			},
			async (args, ctx) =>
				toolResult(async () =>
					renderWrite(
						await writeDocument(
							db,
							{
								path: args.path,
								title: args.title,
								summary: args.summary,
								body: args.body,
								status: args.status,
								staleAfter: args.stale_after,
								sources: args.sources
							},
							callerActor(server, ctx)
						)
					)
				)
		);

		server.registerTool(
			'review_document',
			{
				title: 'Review a knowledge document revision',
				description: `Record a verdict on an exact revision you have read, raising its trust tier for every future session. Reviewing is verification, not authoring: writing a document never reviews it.

revision_number is required — a review is a claim about content the reviewer actually saw. Pass on_behalf_of ('human:<id>') when a human is the one approving; that is what makes a document human-reviewed.`,
				inputSchema: z.strictObject({
					path: pathArg,
					revision_number: z.number().int().min(1),
					verdict: z.enum(['approved', 'rejected']),
					note: z
						.string()
						.max(2000)
						.optional()
						.describe('Stored with the review. Never returned by retrieval.'),
					on_behalf_of: z
						.string()
						.max(80)
						.optional()
						.describe("A human identity, e.g. 'human:david'. Records the review as human-made.")
				}),
				annotations: { readOnlyHint: false, idempotentHint: false }
			},
			async (args, ctx) =>
				toolResult(async () => {
					const actor =
						args.on_behalf_of === undefined
							? callerActor(server, ctx)
							: assertHumanActor(args.on_behalf_of);
					const outcome = await reviewDocument(
						db,
						{
							path: args.path,
							revisionNumber: args.revision_number,
							verdict: args.verdict,
							note: args.note
						},
						actor
					);
					return renderReview(outcome, args.verdict, actor);
				})
		);

		return server;
	};
}
