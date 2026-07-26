/**
 * The contract tests: a real MCP client talking to the production handler in process, against a real
 * PostgreSQL database. Nothing is stubbed, so these exercise protocol negotiation, tool discovery,
 * schema validation, the SQL, and the rendered text an agent actually reads.
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { McpHttpHandler } from '@modelcontextprotocol/server';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../db/schema';
import type { KnowledgeDb } from '../knowledge/store';
import { knowledgeServerFactory } from './server';

const CLIENT_NAME = 'claude-code';

// Read straight from `.env` rather than through `$app/env/private`, which validates every variable the
// app needs at runtime; these tests only need the database.
process.loadEnvFile();
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set; run `pnpm db:start` and check .env');

const sql = postgres(databaseUrl);
const db = drizzle(sql, { schema }) as unknown as KnowledgeDb;

let handler: McpHttpHandler;
let client: Client;

beforeAll(async () => {
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
});

afterAll(async () => {
	await client.close();
	await handler.close();
	await sql.end();
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

	it('browses one level of the tree, with counts on intermediate nodes', async () => {
		const root = await ok('find_documents');
		expect(root).toContain('stack/ (2)');
		expect(root).toContain('practice/ (1)');
		// No leaf detail at the root: an intermediate node is a bare segment and a count.
		expect(root).not.toContain(migrationWorkflow.title);

		const level = await ok('find_documents', { path_prefix: 'stack/drizzle' });
		expect(level).toContain(migrationWorkflow.title);
		expect(level).toContain(pushWorkflow.title);
		expect(level).toContain('unverified');
	});

	it('flattens the subtree when asked recursively', async () => {
		const flat = await ok('find_documents', { path_prefix: 'stack', recursive: true });
		expect(flat).toContain(migrationWorkflow.path);
		expect(flat).toContain(pushWorkflow.path);
		expect(flat).not.toContain('drizzle/ (2)');
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

	it('honours the limit and rejects one out of range', async () => {
		const limited = await ok('find_documents', { path_prefix: 'stack/drizzle', limit: 1 });
		expect(limited.split('\n').filter((line) => line.includes(' — '))).toHaveLength(1);
		expect((await call('find_documents', { limit: 500 })).isError).toBe(true);
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
