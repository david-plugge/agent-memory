/**
 * The contract tests: a real MCP client talking to the production handler in process, against a real
 * PostgreSQL database. Nothing is stubbed, so these exercise protocol negotiation, tool discovery,
 * schema validation, the SQL, and the rendered text an agent actually reads.
 *
 * The database is a throwaway container, not the developer's own: `beforeEach` truncates, and pointing
 * that at the running knowledge service would delete a corpus that is in real use.
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { McpHttpHandler } from '@modelcontextprotocol/server';
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { Sql } from 'postgres';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../db/schema';
import type { KnowledgeDb } from '../knowledge/store';
import { knowledgeServerFactory } from './server';

const CLIENT_NAME = 'claude-code';

let container: StartedPostgreSqlContainer;
let sql: Sql;
let db: KnowledgeDb;
let handler: McpHttpHandler;
let client: Client;

// Pulling and booting PostgreSQL takes far longer than a test does. The schema is diffed out of the
// Drizzle definitions against an empty database, which is what `pnpm db:push` does in development —
// so there is no migration folder to keep in step, and no drift between the tests and the app.
beforeAll(async () => {
	container = await new PostgreSqlContainer('postgres:18-alpine').start();
	sql = postgres(container.getConnectionUri());
	db = drizzle(sql, { schema });
	const ddl = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema));
	for (const statement of ddl) await sql.unsafe(statement);

	handler = createMcpHandler(knowledgeServerFactory(db));
	// Newest-era discovery with conservative fallback. It is also what puts the client's identity on
	// every request, which is what `author_actor` is derived from.
	client = new Client(
		{ name: CLIENT_NAME, version: '1.0.0' },
		{ versionNegotiation: { mode: 'auto' } }
	);
	await client.connect(
		new StreamableHTTPClientTransport(new URL('http://mcp.test/mcp'), {
			fetch: (url, init) => handler.fetch(new Request(url, init))
		})
	);
}, 180_000);

afterAll(async () => {
	await client.close();
	await handler.close();
	await sql.end();
	await container.stop();
});

beforeEach(async () => {
	await sql`truncate knowledge_review, knowledge_revision, knowledge_document restart identity cascade`;
});

type Called = { text: string; isError: boolean };

async function call(name: string, args: Record<string, unknown> = {}): Promise<Called> {
	const result = await client.callTool({ name, arguments: args });
	const text = (result.content ?? [])
		.map((block) => (block.type === 'text' ? block.text : ''))
		.join('\n');
	return { text, isError: result.isError === true };
}

async function ok(name: string, args: Record<string, unknown> = {}): Promise<string> {
	const result = await call(name, args);
	expect(result.isError, `${name} failed: ${result.text}`).toBe(false);
	return result.text;
}

const migrationWorkflow = {
	path: 'stack/drizzle/migration-workflow',
	title: 'Generate and commit Drizzle migration files',
	summary: 'The generate-then-migrate workflow: drizzle-kit generate, review the SQL, commit it.',
	body: '# Migrations\n\nRun `pnpm db:generate`, review, commit. Rollbacks are a manual psql runbook.'
};

const pushWorkflow = {
	path: 'stack/drizzle/push-workflow',
	title: 'Push schema changes straight to the database',
	summary: 'Skip migration files entirely with drizzle-kit push. Local development only.',
	body: '# Push\n\nRun `pnpm db:push`.'
};

describe('the advertised surface', () => {
	it('is exactly the four contracted tools', async () => {
		const { tools } = await client.listTools();
		expect(tools.map((tool) => tool.name).sort()).toEqual([
			'find_documents',
			'read_document',
			'review_document',
			'write_document'
		]);
	});

	it('describes find_documents in the consumer’s vocabulary', async () => {
		const { tools } = await client.listTools();
		const find = tools.find((tool) => tool.name === 'find_documents');
		expect(find?.description).toMatch(/conventions, workflows, and prior decisions/);
	});

	it('rejects an unknown argument, because the schemas are strict', async () => {
		const result = await call('read_document', { path: migrationWorkflow.path, project: 'hunga' });
		expect(result.isError).toBe(true);
	});
});

describe('write_document', () => {
	it('creates a document, then appends an immutable revision on the same path', async () => {
		expect(await ok('write_document', migrationWorkflow)).toContain('created');
		const second = await ok('write_document', { ...migrationWorkflow, body: 'Revised body.' });
		expect(second).toContain('revised');
		expect(second).toContain('revision 2');

		const current = await ok('read_document', { path: migrationWorkflow.path });
		expect(current).toContain('revision 2 of 2');
		expect(current).toContain('Revised body.');
		const first = await ok('read_document', { path: migrationWorkflow.path, revision_number: 1 });
		expect(first).toContain(migrationWorkflow.body);
	});

	it('attributes the revision to the calling client, not to an argument', async () => {
		await ok('write_document', migrationWorkflow);
		expect(await ok('read_document', { path: migrationWorkflow.path })).toContain(
			`agent:${CLIENT_NAME}`
		);
	});

	it('degrades authorship to agent:unknown for a client on the 2025 era', async () => {
		// Stateless legacy serving answers each request with a fresh instance, so the identity from
		// `initialize` is gone by the time a tool runs. A limitation of the era, not of the store.
		const legacyClient = new Client({ name: CLIENT_NAME, version: '1.0.0' });
		await legacyClient.connect(
			new StreamableHTTPClientTransport(new URL('http://mcp.test/mcp'), {
				fetch: (url, init) => handler.fetch(new Request(url, init))
			})
		);
		await legacyClient.callTool({ name: 'write_document', arguments: pushWorkflow });
		await legacyClient.close();
		expect(await ok('read_document', { path: pushWorkflow.path })).toContain('agent:unknown');
	});

	it('names the field and the rule when validation fails', async () => {
		const badPath = await call('write_document', { ...migrationWorkflow, path: 'Stack/Drizzle' });
		expect(badPath.isError).toBe(true);
		expect(badPath.text).toMatch(/^path:/);

		const longSummary = await call('write_document', {
			...migrationWorkflow,
			summary: 'x'.repeat(501)
		});
		expect(longSummary.isError).toBe(true);
	});
});

describe('find_documents', () => {
	beforeEach(async () => {
		await ok('write_document', migrationWorkflow);
		await ok('write_document', pushWorkflow);
		await ok('write_document', {
			path: 'practice/wayfinding/mapping-an-effort',
			title: 'Chart a wayfinder map before planning',
			summary: 'How to chart the map, name the destination, and work its decision tickets.',
			body: '# Wayfinding'
		});
	});

	it('browses the subtree as a table of contents, expanded to the default depth', async () => {
		const root = await ok('find_documents');
		// Three levels, fully expanded: nothing is hidden inside the requested depth, so nothing is counted.
		expect(root.split('\n')).toEqual([
			'practice/',
			'  wayfinding/',
			'    mapping-an-effort',
			'stack/',
			'  drizzle/',
			'    migration-workflow',
			'    push-workflow'
		]);
		// Names only below the immediate level, and the immediate level here is bare segments.
		expect(root).not.toContain(migrationWorkflow.title);
	});

	it('describes the immediate level and names everything below it', async () => {
		const level = await ok('find_documents', { path_prefix: 'stack/drizzle' });
		expect(level).toContain(migrationWorkflow.title);
		expect(level).toContain(migrationWorkflow.summary);
		expect(level).toContain('unverified');

		// One level up, the same two documents are names: the descriptors stop at the level asked for.
		const above = await ok('find_documents', { path_prefix: 'stack' });
		expect(above).toContain('  migration-workflow');
		expect(above).not.toContain(migrationWorkflow.title);
	});

	it('stops at the requested depth and counts what it hides', async () => {
		const shallow = await ok('find_documents', { depth: 1 });
		expect(shallow.split('\n')).toEqual(['practice/ (1)', 'stack/ (2)']);

		// A level deeper the branch is expanded, so it carries no count of its own.
		const two = await ok('find_documents', { depth: 2 });
		expect(two).toContain('  drizzle/ (2)');
		expect(two).not.toContain('stack/ (2)');
	});

	it('rejects a depth outside the schema bounds', async () => {
		expect((await call('find_documents', { depth: 9 })).isError).toBe(true);
		expect((await call('find_documents', { depth: 0 })).isError).toBe(true);
	});

	// A path is legal both as a document and as a branch: the grammar reserves no segment, so nothing
	// stops `stack/drizzle` being written alongside `stack/drizzle/push-workflow`.
	const drizzleOverview = {
		path: 'stack/drizzle',
		title: 'Drizzle in this repo',
		summary: 'Where the schema lives, and which workflow to reach for when changing it.',
		body: '# Drizzle'
	};

	it('keeps a document that is also a branch as one node carrying both', async () => {
		await ok('write_document', drizzleOverview);

		const level = await ok('find_documents', { path_prefix: 'stack' });
		// One node, not two: the descriptor and the subtree arrive under the same name.
		expect(level).toContain(drizzleOverview.title);
		expect(level).not.toContain('drizzle/');
		expect(level.split('\n').filter((line) => line.startsWith('drizzle'))).toHaveLength(1);
		expect(level).toContain('  migration-workflow');
		// Expanded, so no count — the `below` badge is for a subtree the depth actually cuts off.
		expect(level).not.toContain('2 below');
		expect(await ok('find_documents', { path_prefix: 'stack', depth: 1 })).toContain('2 below');
	});

	it('renders a merged node past the boundary as a name and a count', async () => {
		await ok('write_document', {
			path: 'practice/wayfinding/mapping-an-effort/ticket-types',
			title: 'The four wayfinder ticket types',
			summary: 'Research, prototype, grilling and task, and which one a question wants.',
			body: '# Ticket types'
		});
		// `mapping-an-effort` sits exactly on the default boundary and is both a document and a branch: no
		// slash, because it is readable, plus the count of what lies past the boundary.
		expect(await ok('find_documents')).toContain('    mapping-an-effort (1)');
	});

	it('shows the document at exactly the browsed prefix as the level’s header', async () => {
		await ok('write_document', drizzleOverview);

		const level = await ok('find_documents', { path_prefix: 'stack/drizzle' });
		expect(level.split('\n')[0]).toBe(`stack/drizzle — ${drizzleOverview.title}`);
		expect(level).toContain(drizzleOverview.summary);
		// And the children are still listed beneath it.
		expect(level).toContain(migrationWorkflow.title);
		expect(level).toContain(pushWorkflow.title);
	});

	it('counts in SQL and returns every node, with no limit to truncate either', async () => {
		for (let index = 0; index < 12; index++)
			await ok('write_document', {
				path: `stack/drizzle/note-${String(index).padStart(2, '0')}`,
				title: `Drizzle note ${index}`,
				summary: `Filler document number ${index}, well past any limit the tool used to impose.`,
				body: '# Note'
			});
		// 14 documents under `stack`: exact as a count at depth 1, and all present as names at depth 2.
		expect(await ok('find_documents', { path_prefix: 'stack', depth: 1 })).toContain(
			'drizzle/ (14)'
		);
		const names = await ok('find_documents', { path_prefix: 'stack', depth: 2 });
		expect(names.split('\n').filter((line) => line.startsWith('  note-'))).toHaveLength(12);
		// And a search returns all 14 hits rather than a first page of them.
		const hits = await ok('find_documents', { query: 'drizzle' });
		expect(hits.split('\n').filter((line) => line.startsWith('stack/drizzle/'))).toHaveLength(14);
	});

	it('searches paths, titles and summaries — never bodies', async () => {
		const hits = await ok('find_documents', { query: 'drizzle migration workflow' });
		expect(hits).toContain(migrationWorkflow.path);

		// 'psql runbook' appears only in the body, and the body is deliberately not indexed.
		const bodyOnly = await ok('find_documents', { query: 'psql runbook' });
		expect(bodyOnly).toContain('No documents matched');
	});

	it('degrades a query containing an unknown word into partial matches instead of nothing', async () => {
		const hits = await ok('find_documents', {
			query: 'how do I add a column with drizzle for favourite recipes'
		});
		expect(hits).toContain('stack/drizzle/');
	});

	it('returns an empty result with guidance, not an error, when nothing matches', async () => {
		const miss = await call('find_documents', { query: 'kubernetes ingress terraform' });
		expect(miss.isError).toBe(false);
		expect(miss.text).toContain('No documents matched');
	});

	it('combines path_prefix and query as AND', async () => {
		const scoped = await ok('find_documents', { path_prefix: 'practice', query: 'drizzle' });
		expect(scoped).toContain('No documents matched');
	});

	it('shows stable documents only until another status is asked for', async () => {
		await ok('write_document', {
			path: 'stack/drizzle/experimental-relations',
			title: 'Relations, unfinished',
			summary: 'A draft about drizzle relations that is not ready to be found.',
			body: '# Draft',
			status: 'draft'
		});
		expect(await ok('find_documents', { path_prefix: 'stack/drizzle' })).not.toContain(
			'Relations, unfinished'
		);
		expect(
			await ok('find_documents', { path_prefix: 'stack/drizzle', status: ['draft'] })
		).toContain('Relations, unfinished');
	});

	// The root skeleton exists because an agent may only ever search, and the server instructions are a
	// channel with evidence of going undelivered. A tool result is not.
	it('appends the top level to a search that hit, and to one that missed', async () => {
		const hits = await ok('find_documents', { query: 'drizzle migration workflow' });
		expect(hits).toContain('Top of the tree: practice/ (1)  stack/ (2)');
		expect(hits).toContain('browse a branch with path_prefix');

		expect(await ok('find_documents', { query: 'kubernetes ingress terraform' })).toContain(
			'Top of the tree: practice/ (1)  stack/ (2)'
		);
	});

	it('appends the top level to an empty browse, but never to one that found something', async () => {
		expect(await ok('find_documents', { path_prefix: 'stack/prisma' })).toContain(
			'Top of the tree:'
		);
		// A caller looking at the tree has better information than the root already.
		expect(await ok('find_documents')).not.toContain('Top of the tree:');
		expect(await ok('find_documents', { path_prefix: 'stack' })).not.toContain('Top of the tree:');
	});

	it('marks a top-level segment that is a readable document, and honours status', async () => {
		await ok('write_document', {
			path: 'practice',
			title: 'How this team works',
			summary: 'The index of practice documents: wayfinding, reviews, and the rest.',
			body: '# Practice'
		});
		// No trailing slash, because the segment itself is readable; the count includes it.
		expect(await ok('find_documents', { query: 'drizzle' })).toContain('practice (2)  stack/ (2)');

		await ok('write_document', { ...pushWorkflow, path: 'archive/old-note', status: 'deprecated' });
		const stableOnly = await ok('find_documents', { query: 'drizzle' });
		expect(stableOnly).not.toContain('archive');
		expect(await ok('find_documents', { query: 'drizzle', status: ['deprecated'] })).toContain(
			'archive/ (1)'
		);
	});

	it('rejects a limit, which is no longer part of the contract', async () => {
		expect((await call('find_documents', { limit: 10 })).isError).toBe(true);
	});
});

describe('review_document and Trust Tiers', () => {
	beforeEach(async () => {
		await ok('write_document', migrationWorkflow);
	});

	it('leaves an unreviewed revision unverified, even though an agent wrote it', async () => {
		expect(await ok('read_document', { path: migrationWorkflow.path })).toContain('unverified');
	});

	it('raises the tier to agent-reviewed, and to human-reviewed on behalf of a human', async () => {
		const agentReview = await ok('review_document', {
			path: migrationWorkflow.path,
			revision_number: 1,
			verdict: 'approved'
		});
		expect(agentReview).toContain('agent-reviewed');

		const humanReview = await ok('review_document', {
			path: migrationWorkflow.path,
			revision_number: 1,
			verdict: 'approved',
			on_behalf_of: 'human:david',
			note: 'Checked against the repo.'
		});
		expect(humanReview).toContain('human-reviewed');
		expect(await ok('read_document', { path: migrationWorkflow.path })).toContain('human-reviewed');
	});

	it('never returns the review note — retrieval carries the outcome, not the reasoning', async () => {
		await ok('review_document', {
			path: migrationWorkflow.path,
			revision_number: 1,
			verdict: 'approved',
			on_behalf_of: 'human:david',
			note: 'Checked against the repo.'
		});
		const read = await ok('read_document', { path: migrationWorkflow.path });
		expect(read).not.toContain('Checked against the repo.');
	});

	it('lets an actor retract an approval, because only their latest verdict counts', async () => {
		await ok('review_document', {
			path: migrationWorkflow.path,
			revision_number: 1,
			verdict: 'approved',
			on_behalf_of: 'human:david'
		});
		const retracted = await ok('review_document', {
			path: migrationWorkflow.path,
			revision_number: 1,
			verdict: 'rejected',
			on_behalf_of: 'human:david'
		});
		expect(retracted).toContain('unverified');
		expect(await ok('read_document', { path: migrationWorkflow.path })).toContain('1 rejected');
	});

	it('drops a new revision back to unverified', async () => {
		await ok('review_document', {
			path: migrationWorkflow.path,
			revision_number: 1,
			verdict: 'approved',
			on_behalf_of: 'human:david'
		});
		await ok('write_document', { ...migrationWorkflow, body: 'A typo fix.' });
		expect(await ok('read_document', { path: migrationWorkflow.path })).toContain('unverified');
		expect(
			await ok('read_document', { path: migrationWorkflow.path, revision_number: 1 })
		).toContain('human-reviewed');
	});

	it('rejects a review of a revision that does not exist, naming the valid range', async () => {
		const result = await call('review_document', {
			path: migrationWorkflow.path,
			revision_number: 7,
			verdict: 'approved'
		});
		expect(result.isError).toBe(true);
		expect(result.text).toContain('revisions 1-1');
	});

	it('rejects a malformed human identity', async () => {
		const result = await call('review_document', {
			path: migrationWorkflow.path,
			revision_number: 1,
			verdict: 'approved',
			on_behalf_of: 'david'
		});
		expect(result.isError).toBe(true);
		expect(result.text).toMatch(/^on_behalf_of:/);
	});
});

describe('read_document', () => {
	it('steers a failed read back to discovery with the nearest prefix', async () => {
		await ok('write_document', migrationWorkflow);
		const missing = await call('read_document', { path: 'stack/drizzle/seeding' });
		expect(missing.isError).toBe(true);
		expect(missing.text).toContain("try find_documents with path_prefix 'stack/drizzle'");
	});

	it('reports an expired staleness claim, and says nothing when there is none', async () => {
		await ok('write_document', { ...migrationWorkflow, stale_after: '2020-01-01' });
		expect(await ok('read_document', { path: migrationWorkflow.path })).toContain('stale');
		await ok('write_document', pushWorkflow);
		expect(await ok('read_document', { path: pushWorkflow.path })).not.toContain('stale');
	});

	it('returns sources when the author recorded them', async () => {
		await ok('write_document', {
			...migrationWorkflow,
			sources: [{ uri: 'https://orm.drizzle.team/docs/migrations', title: 'Drizzle migrations' }]
		});
		const read = await ok('read_document', { path: migrationWorkflow.path });
		expect(read).toContain('https://orm.drizzle.team/docs/migrations');
	});
});
