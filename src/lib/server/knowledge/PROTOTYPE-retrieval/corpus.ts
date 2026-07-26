/**
 * PROTOTYPE — the 14-document corpus from #9, distilled from real sources in this repo.
 * Throwaway. See README.md.
 */

export type Trust = 'unverified' | 'agent-reviewed' | 'human-reviewed';

export type CorpusDoc = {
	path: string;
	title: string;
	summary: string;
	body: string;
	status: 'draft' | 'stable' | 'deprecated';
	trust: Trust;
};

export const corpus: CorpusDoc[] = [
	{
		path: 'agent-memory/okf/semantic-model',
		title: 'Treat OKF v0.2 as a semantic model, not a storage contract',
		summary:
			'Which properties of the Open Knowledge Format to preserve in a PostgreSQL-backed service, and which parts of the spec to drop.',
		status: 'stable',
		trust: 'agent-reviewed',
		body: `OKF v0.2 describes a file packaging format for portable knowledge bundles. A service backed by PostgreSQL cannot claim conformance and should not try to, but the semantics behind the format are worth keeping.

Preserve four properties. Hierarchical progressive disclosure: a consumer sees a cheap descriptor first — path, title, summary — and pays for the full body only when it decides the document is relevant. Immutable revision-scoped provenance: every version records who generated it and when, and that record is never rewritten. Derived advisory trust: credibility is computed from recorded verdicts at read time rather than stored as a score somebody can edit. Independent lifecycle and freshness signals: whether content is draft, stable or deprecated is a different claim from whether it has gone stale.

Keep three separations that OKF is careful about. Generation is separate from verification — authoring a document is not vouching for it. Credibility evidence is separate from verdicts — the note explaining a rejection is not the rejection. Document verification is separate from runtime attestation — nothing here claims that code inside a document was executed or is safe to execute.

Drop the file layout, the manifest, the conformance levels, the attested-computation runtime, and the typed relationship graph. Unchanged Markdown bodies plus service-managed metadata columns carry every property above without any of that machinery.`
	},
	{
		path: 'agent-memory/okf/trust-tiers',
		title: 'Derive Trust Tiers on read from revision-scoped reviews',
		summary:
			'The three-tier trust model, how it is computed, and why a rejection never lowers a tier.',
		status: 'stable',
		trust: 'unverified',
		body: `A Trust Tier is the consumer-facing classification of one Revision: unverified, agent-reviewed, or human-reviewed. It is derived on read and never stored, so there is no column to drift out of sync with the reviews behind it.

The rule is a precedence check over that revision's reviews. Any approval from a \`human:\` actor makes the revision human-reviewed. Otherwise any approval from an \`agent:\` actor makes it agent-reviewed. Otherwise it is unverified. Reviews attach to an exact revision number and are never carried forward, so a new revision of a previously approved document starts at unverified again. That is the point of scoping review to content rather than to identity.

A rejection never lowers the tier. Lowering it would mean one dissenting reviewer could erase another reviewer's approval, which is a verdict about the reviewers rather than about the content. Instead rejections surface as a rejected count, so a disputed document does not read identically to one nobody has looked at.

Retrieval returns the outcome, not the reasoning. The tier and the rejected count go out on every result; review notes are stored but never read back, because pulling somebody's reasoning into a consuming agent's context is exactly the kind of bloat progressive disclosure exists to prevent.

Agent-reviewed is an adaptation of OKF's machine-confirmed tier and implies no cryptographic verification whatsoever. It means an agent asserted an approval under an unauthenticated identity.`
	},
	{
		path: 'agent-memory/mcp/transport-constraints',
		title: 'Serve MCP over a stateless Streamable HTTP endpoint',
		summary:
			'Transport choice, per-request server construction, and where session state is allowed to live.',
		status: 'stable',
		trust: 'agent-reviewed',
		body: `Use Streamable HTTP in stateless mode. A single route handles POST for requests and rejects GET, since nothing here needs a server-initiated event stream. Stateless means no session id is issued and no in-memory session map exists, which is what makes the endpoint safe to run behind a load balancer or on a platform that recycles instances between requests.

Construct a fresh server instance per request inside a factory, wire the transport to it, and let both be garbage collected when the response finishes. Sharing one long-lived server across requests reintroduces exactly the cross-request state the stateless mode is chosen to avoid.

PostgreSQL is the only state boundary. Anything that must survive a request goes in a table; nothing lives in module scope. The connection pool is the one deliberate exception, and it is a resource rather than state.

Tool schemas are strict. Every tool declares its input schema with Zod, unknown keys are rejected rather than ignored, and the descriptions are written for a model that will only ever see the tool list, never the implementation.

Pin the SDK. The minimal v2 TypeScript path is still beta and its exports move between releases, so an exact version in package.json is cheaper than debugging a transport that changed shape underneath you.

Test through a real client against the in-process production handler, plus one smoke test that crosses the actual HTTP boundary. A hand-rolled fake client agrees with your assumptions instead of with the protocol.`
	},
	{
		path: 'agent-memory/mcp/tool-schema-rules',
		title: 'Write MCP tool schemas for a model that only sees the tool list',
		summary:
			'Naming, argument shape, and response conventions for tools an unfamiliar agent has to use unprompted.',
		status: 'stable',
		trust: 'unverified',
		body: `An agent decides whether to call a tool from its name, its description, and its parameter names. That text is the entire user interface, so it gets written with the same care as a public API.

Name tools for the intent, not the table: find, read, create, review. Keep the surface small — four tools an agent will actually reach for beat a dozen it has to choose between.

Every argument is validated with Zod and every optional argument states its default in the description, because a model reading the schema cannot see the code that fills it in. Reject unknown keys instead of silently dropping them; a typo'd argument that is quietly ignored produces a plausible-looking wrong result, which is worse than an error.

Responses stay lean. A find call returns descriptors — path, title, summary, trust, freshness — and never bodies, so listing results cannot blow up the caller's context window. A read call returns one body. This split is the whole progressive disclosure story, and it only works if the descriptors are genuinely cheap.

Errors are messages, not exceptions. A rejected path grammar comes back as text explaining the grammar, because the agent can fix its own input if you tell it the rule.

Include the vocabulary a caller would search for in the descriptions. A tool described only in the service's own jargon will not be found by an agent thinking in its task's terms.`
	},
	{
		path: 'agent-memory/domain/language',
		title: 'Ubiquitous language for shared agent knowledge',
		summary:
			'The seven domain terms — Knowledge Document, Document Path, Revision, Review, Trust Tier, Actor — and the words to avoid.',
		status: 'stable',
		trust: 'human-reviewed',
		body: `A Knowledge Document is a Markdown document capturing one unit of developer knowledge together with its provenance, lifecycle, and review metadata. Do not call it a concept, a memory, or an entry.

A Document Path is the stable, globally unique, human-authored hierarchical identity of a Knowledge Document, immutable once created. It is slash-separated segments of lowercase letters, digits and hyphens, one to eight deep, with no extension. Do not call it an id, a key, or a slug — those names invite the assumption that it is machine-generated and disposable, and it is neither.

A Revision is an immutable version of a Knowledge Document at a Document Path. The latest Revision is current; there is no pointer to maintain and no revert. Do not say version or overwrite.

A Review is a recorded human or agent verdict about exactly one Revision. Do not say approval or verification.

A Trust Tier is the consumer-facing classification derived from a Revision's Reviews: unverified, agent-reviewed, or human-reviewed. Do not say trust score or credibility score — it is a tier, not a number, and nothing averages.

An Actor is the asserted, unauthenticated identity that authored a Revision or recorded a Review, written as \`agent:<name>\` or \`human:<id>\`. Do not say user, author, or reviewer.

No Project is a privileged namespace. Cross-project sharing rests entirely on the path an author chooses plus full-text search.`
	},
	{
		path: 'stack/sveltekit/deployment-adapter',
		title: 'Deploy SvelteKit with adapter-node in a multi-stage Docker build',
		summary:
			'Adapter choice, the four-stage Dockerfile, why the runtime image ships no node_modules, and the healthcheck.',
		status: 'stable',
		trust: 'agent-reviewed',
		body: `Use @sveltejs/adapter-node and run the output with \`node build\`. It deploys anywhere that can run a container, which is the default assumption for these projects.

The Dockerfile has four stages on a node alpine base. A base stage enables corepack, sets PNPM_HOME on the PATH and sets HUSKY=0 so git hooks do not try to install inside the image. A deps stage copies only package.json, the lockfile, the workspace file, .npmrc and any patches, then runs \`pnpm install --frozen-lockfile\` with a cache mount on the pnpm store — copying the source here would invalidate the dependency layer on every edit. A build stage copies node_modules from deps, copies the source, and runs \`pnpm build\`. A runtime stage copies only the build directory and package.json.

The runtime image ships no node_modules at all. Every dependency is a devDependency and rollup bundles what the server needs into the build output, so the final image is the compiled app and nothing else.

Set NODE_ENV=production and PORT, run as the node user rather than root, expose the port, and add a HEALTHCHECK that fetches the app's own origin and exits non-zero on a failed response.

ORIGIN must be set at runtime. adapter-node needs it to construct URLs and to validate form submissions, and getting it wrong produces cross-origin errors that look like an auth bug.`
	},
	{
		path: 'stack/sveltekit/env-and-hooks',
		title: 'Validate environment variables with defineEnvVars and a build-time default',
		summary:
			'Declaring typed env vars with Zod, the build-time placeholder trick, and what belongs in hooks.server.ts.',
		status: 'stable',
		trust: 'unverified',
		body: `Declare every environment variable in one \`src/env.ts\` using \`defineEnvVars\` from @sveltejs/kit/env, each with a description and a Zod schema. Private values are then imported from \`$app/env/private\`, which fails loudly at startup when something is missing instead of surfacing as undefined halfway through a request.

Build breaks unless you handle it. The build has no real secrets, but the variables are still required at runtime, so wrap each schema in a helper that applies a throwaway default only when \`building\` is true and leaves the schema strictly required otherwise. DATABASE_URL gets a fake connection string, ORIGIN gets localhost, and the auth secret gets an obvious placeholder that is never used at runtime.

Keep \`hooks.server.ts\` thin. It resolves the session once per request, puts the session and user on \`event.locals\` when one exists, and delegates the rest. Typing those locals in \`app.d.ts\` is what makes them usable in load functions and remote functions without a cast.

Handles compose in order and the order is behaviour, not style. Anything that depends on \`event.locals.user\` must run after the handle that populates it.

Do not reach for \`process.env\` in application code. The validated module is the only entry point, and bypassing it is how a variable ends up documented nowhere.`
	},
	{
		path: 'stack/drizzle/migration-workflow',
		title: 'Generate and commit Drizzle migration files',
		summary:
			'The generate-then-migrate workflow: edit the schema, generate SQL, review it, commit it, apply it.',
		status: 'stable',
		trust: 'human-reviewed',
		body: `Schema changes go through generated migration files that are committed to the repository. This is the workflow for anything that touches a real database, including local development once other people share it.

Edit the table definitions in \`src/lib/server/db/schema.ts\`. Run \`pnpm db:generate\`, which diffs the schema against the recorded migration history and writes a new timestamped SQL file plus updated metadata into the migrations directory. Open that file and read it. Drizzle infers intent from the diff, and a renamed column can come out as a drop plus an add, which silently destroys data — this is the review step that catches it before it runs anywhere. Commit the migration alongside the schema change in the same commit, so checking out any revision gives you a schema and the SQL that produces it. Apply it with \`pnpm db:migrate\`.

Never run \`drizzle-kit push\` against a database whose contents matter. Push diffs the schema straight at the live database and applies the change immediately, leaving no artifact in the repository, no ordering relative to other people's changes, and nothing to review. A migration you cannot see is a migration you cannot roll back or reason about later.

To add a table for a new feature: define it, generate, read the SQL, commit both files, then migrate. Adding a foreign key to an existing table means thinking about existing rows — a non-nullable column needs a default or a backfill, and generate will not decide that for you.`
	},
	{
		path: 'stack/drizzle/schema-conventions',
		title: 'Drizzle schema conventions for PostgreSQL tables',
		summary:
			'Table and column naming, primary keys, timestamps, foreign keys, and how the schema file is composed.',
		status: 'stable',
		trust: 'agent-reviewed',
		body: `Define tables with \`pgTable\` from drizzle-orm/pg-core in \`src/lib/server/db/schema.ts\`. Table names are singular and snake_case: \`task\`, \`recipe\`, \`favourite_recipe\`. Column names match the property names unless SQL needs snake_case, in which case the string argument carries the SQL name.

Primary keys are \`serial('id').primaryKey()\` unless something else is genuinely the identity. Text columns are \`text\`, not varchar with an arbitrary limit. Mark everything \`notNull()\` that should be, and give a \`default()\` wherever the application would otherwise have to remember one — a nullable column with no default is a decision deferred to every future caller.

Timestamps use \`timestamp('created_at', { withTimezone: true }).notNull().defaultNow()\`. Timezone-naive timestamps are a bug waiting for a deployment in another region.

Foreign keys are declared inline with \`.references(() => other.id)\` and a deletion policy chosen deliberately. A per-user join table that should disappear with its user gets \`onDelete: 'cascade'\`; anything you would want to notice instead of losing does not.

Generated auth tables live in their own \`auth.schema.ts\` and are re-exported from the main schema file with \`export *\`. Keeping them separate means regenerating them never clobbers hand-written tables, and the single re-export still gives drizzle one module to read.

A join table linking two entities takes a composite unique constraint on the pair, so the same row cannot be inserted twice.`
	},
	{
		path: 'stack/drizzle/push-workflow',
		title: 'Push schema changes straight to the database with drizzle-kit push',
		summary:
			'Skip migration files entirely and let drizzle-kit sync the schema to the database on every change.',
		status: 'stable',
		trust: 'unverified',
		body: `DEMO CORPUS ONLY — planted for the #12 viability test. This document contradicts stack/drizzle/migration-workflow on purpose and is deleted once that ticket closes.

Migration files are ceremony. Edit the tables in \`src/lib/server/db/schema.ts\` and run \`pnpm db:push\`. Drizzle diffs the schema against the live database and applies the change immediately, so the database always matches the code and there is no migrations directory to review, order, or resolve conflicts in.

The workflow for adding a table for a new feature is one step: define it, then push. No generate, no SQL file to read, nothing extra in the commit. Iterating on a schema during feature work is much faster this way, because you can reshape a table five times in an afternoon without leaving five migration files behind.

Push prompts before anything it considers destructive, so a dropped column is a confirmation rather than a surprise. Keep \`strict: true\` and \`verbose: true\` in \`drizzle.config.ts\` and read what it tells you.

Because the schema file is the single source of truth, checking out an older revision and pushing gets you back to that schema. Treat the database as derived state and the schema file as the thing under version control.`
	},
	{
		path: 'stack/better-auth/server-wiring',
		title: 'Wire better-auth into SvelteKit with the Drizzle adapter',
		summary:
			'Server config, the SvelteKit cookies plugin and its ordering rule, generated tables, and guarding a request.',
		status: 'stable',
		trust: 'human-reviewed',
		body: `Configure better-auth once in \`src/lib/server/auth.ts\`. Import \`betterAuth\` from better-auth/minimal, pass \`baseURL: ORIGIN\` and \`secret: BETTER_AUTH_SECRET\` from the validated private env module, and give it \`drizzleAdapter(db, { provider: 'pg' })\` so it stores users and sessions in the same PostgreSQL database as everything else. Enable \`emailAndPassword\` for local development.

Add the \`sveltekitCookies(getRequestEvent)\` plugin and keep it last in the plugins array. It reads the ambient request event to set cookies, and a plugin registered after it will not see the cookie handling it installs. This ordering is load-bearing and the failure mode is a session that appears to authenticate and then vanishes on the next request.

The auth tables are generated, not hand-written. Run \`pnpm auth:schema\` to emit \`src/lib/server/db/auth.schema.ts\` from the auth config, then generate and commit a migration for them like any other schema change.

In \`hooks.server.ts\`, call \`auth.api.getSession({ headers: event.request.headers })\`, put the session and user on \`event.locals\` when one comes back, and pass the event through \`svelteKitHandler\`.

Guard a request by checking \`event.locals.user\` and throwing a 401 when it is missing. A remote function or load function that reads user-owned rows filters by \`locals.user.id\` — never by an id taken from the client, which is how one account ends up reading another's data.`
	},
	{
		path: 'stack/compose/local-services',
		title: 'Run local backing services with Docker Compose',
		summary:
			'The compose file for a local PostgreSQL, the connection string it implies, and named volumes.',
		status: 'stable',
		trust: 'unverified',
		body: `Local development gets its backing services from a single \`compose.yaml\` at the repository root, started with \`pnpm db:start\`. Nothing is installed on the host.

The database service uses the official postgres image with \`restart: always\`, publishes 5432, and sets POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_DB to obvious development values. Those three values are what DATABASE_URL in \`.env\` has to agree with, and a mismatch shows up as an authentication failure that looks like a driver problem.

Data lives in a named volume rather than a bind mount, so it survives \`docker compose down\` and does not litter the working tree or fight with file permissions on macOS. Wiping the database is \`docker compose down -v\`, which is deliberately a different command from stopping it.

Keep \`.env\` out of git and \`.env.example\` in it, listing every variable with a safe placeholder. The example file is the checklist a new clone works through, so a variable missing from it is a variable the next person spends an hour discovering.

Adding another service — a cache, an object store — means adding it here rather than to a developer's machine, and adding its connection string to both \`.env.example\` and the validated env module.`
	},
	{
		path: 'practice/wayfinding/map-and-tickets',
		title: 'Chart a large effort as a wayfinder map with decision tickets',
		summary:
			'The map as an index, tickets sized to one session, blocking and the frontier, and fog of war.',
		status: 'stable',
		trust: 'unverified',
		body: `An effort too big for one agent session gets charted as a map: a single issue naming the destination, with child issues as tickets. Naming the destination comes first, because it fixes the scope every later decision is judged against.

The map is an index, not a store. It lists the decisions already made as one line each, pointing at the ticket that holds the detail, so a decision lives in exactly one place and the map stays cheap to load at the start of a session. Open tickets are not listed; they are found by querying the map's open children.

Each ticket asks one question sized to a single session, and carries a type: research when a fact is needed from outside the working directory, prototype when a rough artifact is needed to react to, grilling for the default conversation, task for manual work that unblocks a decision. Blocking uses the tracker's native dependency edges so the frontier — open, unblocked, unclaimed tickets — renders in the tracker's own interface. A session claims a ticket by assigning it before doing any work, so concurrent sessions do not collide.

The map is deliberately incomplete. Decisions you can tell are coming but cannot yet phrase precisely go in a fog-of-war section and graduate into tickets once the frontier reaches them. The test is whether the question is sharp now, not whether the answer is. Work that turns out to sit past the destination is closed and recorded as out of scope rather than resolved, because a scope boundary is not a step on the route.

Resolve one ticket per session: post the answer, close the issue, append the one-line gist to the map.`
	},
	{
		path: 'practice/testing/mcp-client-integration',
		title: 'Test an MCP server through a real client against the production handler',
		summary:
			'Why integration tests use the real SDK client and the real handler, and what the one HTTP smoke test covers.',
		status: 'stable',
		trust: 'unverified',
		body: `Test an MCP server the way an agent uses it: construct a real SDK client, connect it to the same handler production serves, and call tools through the protocol. A hand-written fake client agrees with whatever you assumed about the protocol, which is exactly the assumption the test was supposed to check.

Run the client in process against the production request handler using an in-memory transport pair. No port, no spawned process, no sleep waiting for a server to come up — the tests stay fast enough to run on every change while still exercising real serialisation, real schema validation, and real error shapes.

Add exactly one test that crosses the actual HTTP boundary. It starts the endpoint, connects a client over Streamable HTTP, and lists tools. Its job is to catch route wiring, method rejection and content-type mistakes that the in-process transport cannot see. One is enough; duplicating the whole suite over HTTP buys nothing but minutes.

State goes to a real PostgreSQL database, not a mock. The tools' behaviour is mostly database behaviour — uniqueness violations, monotonic numbering inside a transaction, full-text ranking — and none of that survives being stubbed. Truncate between tests rather than mocking the client.

Assert on the client-visible surface: the tool list, the result content, the error text a model would read. Reaching past the client into internals produces tests that pass while the tool is unusable.`
	}
];
