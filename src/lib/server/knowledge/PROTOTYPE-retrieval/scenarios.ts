/**
 * PROTOTYPE — the experiment itself. Two vocabularies for the same fourteen information needs of the
 * `hunga` favourite-recipes session, because who is responsible for phrasing the query is itself the
 * question:
 *
 * - `process` — the agent asks about the *process* it is executing ("how do I create a table in
 *   drizzle"). This is what OKF's progressive disclosure assumes, and what a tool description can
 *   ask for.
 * - `task` — the agent asks about the *noun* it is working on ("favourite recipes per user"). Task
 *   vocabulary that no generic stack document would ever contain.
 *
 * `expect` is what the query has to find. `outrank` is a near-miss pair: [winner, loser].
 */

export type Scenario = {
	query: string;
	expect: string[];
	outrank?: [string, string];
	note?: string;
};

/** The three documents that lost their Relations in #9's amendment: findable by words alone or not at all. */
export const CROSS_CONTEXT = [
	'stack/drizzle/migration-workflow',
	'stack/better-auth/server-wiring',
	'practice/testing/mcp-client-integration'
];

/** The agent names the process and the technology it is using. Both are visible to it from the repo. */
const process: Scenario[] = [
	{
		query: 'how do I create a table in drizzle',
		expect: ['stack/drizzle/schema-conventions', 'stack/drizzle/migration-workflow']
	},
	{
		query: 'drizzle migration workflow',
		expect: ['stack/drizzle/migration-workflow'],
		outrank: ['stack/drizzle/migration-workflow', 'stack/drizzle/push-workflow'],
		note: 'the planted conflict, asked neutrally'
	},
	{
		query: 'apply a drizzle schema change to postgres',
		expect: ['stack/drizzle/migration-workflow'],
		outrank: ['stack/drizzle/migration-workflow', 'stack/drizzle/push-workflow']
	},
	{
		query: 'better auth session in sveltekit',
		expect: ['stack/better-auth/server-wiring'],
		note: 'cross-context, named by technology rather than by path'
	},
	{
		query: 'sveltekit hooks server locals user',
		expect: ['stack/better-auth/server-wiring', 'stack/sveltekit/env-and-hooks']
	},
	{
		query: 'sveltekit environment variables',
		expect: ['stack/sveltekit/env-and-hooks'],
		outrank: ['stack/sveltekit/env-and-hooks', 'agent-memory/mcp/transport-constraints'],
		note: 'both subtrees say "env" — discrimination, not luck'
	},
	{
		query: 'docker compose postgres local development',
		expect: ['stack/compose/local-services']
	},
	{
		query: 'sveltekit adapter node docker deployment',
		expect: ['stack/sveltekit/deployment-adapter']
	},
	{
		query: 'mcp streamable http transport',
		expect: ['agent-memory/mcp/transport-constraints']
	},
	{
		query: 'mcp integration testing',
		expect: ['practice/testing/mcp-client-integration'],
		note: 'cross-context'
	},
	{
		query: 'trust tier derivation',
		expect: ['agent-memory/okf/trust-tiers']
	},
	{
		query: 'knowledge document domain language',
		expect: ['agent-memory/domain/language']
	},
	{
		query: 'drizzle foreign key cascade delete',
		expect: ['stack/drizzle/schema-conventions'],
		note: 'a detail buried in a body — tests whether weight C is still reachable'
	},
	{
		query: 'immutable revision model',
		expect: ['agent-memory/okf/trust-tiers', 'agent-memory/domain/language']
	}
];

/** The same needs, phrased in the task's own nouns. The control on "who phrases the query". */
const task: Scenario[] = [
	{
		query: 'add a table for favourite recipes per user',
		expect: ['stack/drizzle/schema-conventions', 'stack/drizzle/migration-workflow']
	},
	{
		query: 'database migration',
		expect: ['stack/drizzle/migration-workflow'],
		outrank: ['stack/drizzle/migration-workflow', 'stack/drizzle/push-workflow']
	},
	{
		query: 'how do I apply a schema change to the database',
		expect: ['stack/drizzle/migration-workflow'],
		outrank: ['stack/drizzle/migration-workflow', 'stack/drizzle/push-workflow']
	},
	{
		query: 'only logged in users should see their own rows',
		expect: ['stack/better-auth/server-wiring']
	},
	{
		query: 'get the current session user on the server',
		expect: ['stack/better-auth/server-wiring', 'stack/sveltekit/env-and-hooks']
	},
	{
		query: 'where do environment variables go',
		expect: ['stack/sveltekit/env-and-hooks'],
		outrank: ['stack/sveltekit/env-and-hooks', 'agent-memory/mcp/transport-constraints']
	},
	{
		query: 'run postgres locally',
		expect: ['stack/compose/local-services']
	},
	{
		query: 'deploy the app in a container',
		expect: ['stack/sveltekit/deployment-adapter']
	},
	{
		query: 'transport',
		expect: ['agent-memory/mcp/transport-constraints']
	},
	{
		query: 'how should I test this',
		expect: ['practice/testing/mcp-client-integration']
	},
	{
		query: 'trust tier human reviewed',
		expect: ['agent-memory/okf/trust-tiers']
	},
	{
		query: 'what do we call a knowledge document',
		expect: ['agent-memory/domain/language']
	},
	{
		query: 'foreign key cascade delete',
		expect: ['stack/drizzle/schema-conventions']
	},
	{
		query: 'immutable revisions',
		expect: ['agent-memory/okf/trust-tiers', 'agent-memory/domain/language']
	}
];

export const scenarioSets = { process, task };

export type Vocabulary = keyof typeof scenarioSets;
