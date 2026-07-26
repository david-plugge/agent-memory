/**
 * Document Path grammar and Actor identity. The service enforces grammar and uniqueness only — no
 * taxonomy, no reserved segments, no interpretation of the hierarchy beyond prefix browsing.
 */

export const MAX_PATH_DEPTH = 8;
const SEGMENT = /^[a-z0-9-]+$/;

export class KnowledgeError extends Error {}

/** Throws a {@link KnowledgeError} naming the field and the rule it broke. */
export function assertValidPath(path: string): string {
	if (path !== path.trim() || path === '')
		throw new KnowledgeError(`path: must be a non-empty path, got '${path}'`);
	if (path.startsWith('/') || path.endsWith('/'))
		throw new KnowledgeError(`path: no leading or trailing slash, got '${path}'`);
	if (path.endsWith('.md')) throw new KnowledgeError(`path: no '.md' extension, got '${path}'`);
	const segments = path.split('/');
	if (segments.length > MAX_PATH_DEPTH)
		throw new KnowledgeError(
			`path: at most ${MAX_PATH_DEPTH} segments, got ${segments.length} in '${path}'`
		);
	for (const segment of segments) {
		if (!SEGMENT.test(segment))
			throw new KnowledgeError(
				`path: each segment must match [a-z0-9-]+, got '${segment}' in '${path}'`
			);
	}
	return path;
}

/** A prefix is a path that need not be a full document path, so depth alone is not a constraint. */
export function assertValidPathPrefix(prefix: string): string {
	return assertValidPath(prefix);
}

/** `stack/drizzle/migration-workflow` -> `stack drizzle migration workflow` */
export function pathWords(path: string): string {
	return path.split(/[/-]/).join(' ');
}

/** Every proper ancestor prefix of a path, longest first: used to steer a failed read back to browsing. */
export function ancestorPrefixes(path: string): string[] {
	const segments = path.split('/');
	const prefixes: string[] = [];
	for (let depth = segments.length - 1; depth > 0; depth--)
		prefixes.push(segments.slice(0, depth).join('/'));
	return prefixes;
}

const ACTOR_ID = /^[a-z0-9._-]{1,64}$/;

/**
 * Actors are asserted, never authenticated. MCP is the only POC interface, so every Revision is
 * agent-authored; `review_document`'s `on_behalf_of` is the one place a human identity enters.
 */
export function agentActor(clientName: string | undefined): string {
	const name = (clientName ?? '')
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return `agent:${ACTOR_ID.test(name) ? name : 'unknown'}`;
}

export function assertHumanActor(onBehalfOf: string): string {
	const id = onBehalfOf.startsWith('human:') ? onBehalfOf.slice('human:'.length) : '';
	if (!ACTOR_ID.test(id))
		throw new KnowledgeError(
			`on_behalf_of: must be 'human:<id>' where id matches [a-z0-9._-]{1,64}, got '${onBehalfOf}'`
		);
	return `human:${id}`;
}
