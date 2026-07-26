/**
 * The only POC interface: one stateless Streamable HTTP MCP endpoint.
 *
 * The handler is module-scoped and builds a fresh server per request, so PostgreSQL is the single
 * state boundary — no session ids, no transport map, no event store. `createMcpHandler` does not check
 * `Origin`, so the route does it before delegating; the endpoint is unauthenticated, which is why it
 * is not safe to expose unrestricted.
 */
import {
	createMcpHandler,
	localhostAllowedOrigins,
	originValidationResponse
} from '@modelcontextprotocol/server';

import { ORIGIN } from '$app/env/private';

import { db } from '#lib/server/db';
import { knowledgeServerFactory } from '#lib/server/mcp/server';

import type { RequestHandler } from './$types';

const handler = createMcpHandler(knowledgeServerFactory(db), {
	onerror: (error) => console.error('[mcp] handler error', error)
});

const allowedOriginHostnames = [
	...localhostAllowedOrigins(),
	...(ORIGIN ? [new URL(ORIGIN).hostname] : [])
];

const serve: RequestHandler = ({ request }) => {
	const rejected = originValidationResponse(request, allowedOriginHostnames);
	if (rejected) return rejected;
	return handler.fetch(request);
};

export const POST = serve;
export const GET = serve;
export const DELETE = serve;
