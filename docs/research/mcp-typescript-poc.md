# Research: MCP constraints for the TypeScript proof of concept

## Summary

The smallest remote POC is one stateless Streamable HTTP endpoint backed by a module-scoped PostgreSQL pool, with a per-request `McpServer` factory registering exactly `create_document`, `find_documents`, `read_document`, and `review_document`. The minimal SvelteKit mount uses v2 `createMcpHandler(...).fetch`, but v2 remains beta as of 2026-07-26; pin matching server/client beta versions for the POC only, then require stable v2 or a deliberate stable-v1 implementation before production. [Official SDK](https://github.com/modelcontextprotocol/typescript-sdk) [v2 beta release](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.0.0-beta.1)

## Findings

1. **High — one stateless Streamable HTTP endpoint is sufficient.** Streamable HTTP is the standard remote transport; stdio is for a locally spawned subprocess. `createMcpHandler(factory)` exposes a web-standard `fetch(Request): Promise<Response>`, creates a fresh server for every request, and retains no session state. In `src/routes/mcp/+server.ts`, keep the handler at module scope and delegate `/mcp` requests to `handler.fetch(request)`. Do not add `Mcp-Session-Id`, transport maps, event stores, resumability, notification streams, or sticky routing: PostgreSQL is the only required state boundary. [SDK HTTP guide](https://ts.sdk.modelcontextprotocol.io/v2/serving/http.html) [SDK scaling guide](https://ts.sdk.modelcontextprotocol.io/v2/serving/sessions-state-scaling.html) [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)

2. **High — the smallest mount uses prerelease APIs.** Current v2 packages are split into `@modelcontextprotocol/server` and `@modelcontextprotocol/client`; the official repository says v2 is beta while v1.x remains production-supported. Pin the same exact v2 beta version for the POC server and test client. Do not mix v1/v2 imports. Production promotion must upgrade to stable v2 or explicitly accept the larger stable `@modelcontextprotocol/sdk` v1.x Streamable HTTP integration. [Official SDK](https://github.com/modelcontextprotocol/typescript-sdk) [stable v1.28.0](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v1.28.0)

3. **High — validate the remote HTTP boundary outside MCP.** Clients POST JSON-RPC messages to one endpoint and must accept JSON or SSE. A GET notification stream may return 405 and is unnecessary here. `createMcpHandler` does not validate `Host`, `Origin`, or credentials. The route must reject an invalid present `Origin` with 403 and restrict deployment hostnames before calling `handler.fetch`. Authentication is excluded by the ticket, but that leaves a deployment risk. [MCP transport security](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) [SDK HTTP boundary guidance](https://ts.sdk.modelcontextprotocol.io/v2/serving/http.html)

4. **High — register four tools with strict schemas.** Use `server.registerTool(name, config, handler)` and Zod v4 strict object schemas. The SDK derives advertised JSON Schema, validates before handler execution, and infers handler types. Bound all strings, arrays, and result limits; use opaque cursors for deterministic pagination. The four underscore names satisfy MCP naming guidance. [SDK tools](https://ts.sdk.modelcontextprotocol.io/v2/servers/tools.html) [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)

5. **High — model the domain around Document Path and Relations, never a Project namespace.** A Knowledge Document has one globally unique hierarchical Document Path. Context/project association is many-to-many through Relations; there is no privileged Project namespace and no `projects` metadata field. API consequences:
   - `create_document` accepts the global Document Path and document content/metadata plus Relations if the contract permits creating them atomically; it must reject a duplicate path as a recoverable tool error.
   - `read_document` addresses a document by its global path (or an explicitly contracted opaque id), never by `{ project, path }`.
   - `find_documents` searches globally and may filter/traverse Relations for one or more contexts/projects; it must not require a project selector or partition pagination by project.
   - `review_document` identifies the same global document and preserves/returns Relations without inventing project ownership.
   - Output schemas expose `documentPath` and `relations`, not `project`, `projectId`, or `projects` metadata. PostgreSQL must enforce path uniqueness globally and represent Relations separately from document metadata.

6. **High — return validated structured output and text fallback.** Give every tool an `outputSchema`; successful handlers return the same object as `structuredContent` and serialized JSON in text `content`. The SDK validates output, while the text copy preserves backwards compatibility. Keep find results bounded and include cursor metadata. Client-side `structuredContent` remains `unknown` and must be narrowed. [SDK structured output](https://ts.sdk.modelcontextprotocol.io/v2/servers/tools.html) [MCP structured content](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) [SDK client calls](https://ts.sdk.modelcontextprotocol.io/v2/clients/calling.html)

7. **Medium — annotations are non-enforcing hints.** `find_documents` and `read_document` are read-only; `create_document` is not read-only and is normally non-idempotent. Do not classify `review_document` until its contract decides whether it computes only or persists state. That decision changes `readOnlyHint` and `idempotentHint`. Database constraints and transactions remain authoritative. [SDK annotations](https://ts.sdk.modelcontextprotocol.io/v2/servers/tools.html)

8. **High — use tool errors for recoverable domain/database failures.** Missing documents, duplicate Document Paths, relation failures, version conflicts, invalid cursors, and transient PostgreSQL faults should return `isError: true` with actionable, sanitized text. Schema failures already use this channel. Never expose SQL, connection strings, or stacks. Unknown tools, malformed JSON-RPC, negotiation failures, and timeouts are protocol/transport failures and may throw client-side; callers must check `isError` before trusting results. [SDK errors](https://ts.sdk.modelcontextprotocol.io/v2/servers/errors.html) [MCP error model](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)

9. **Medium — keep the database pool outside the server factory.** The handler factory runs once per HTTP request, so create the PostgreSQL pool/repositories once in a server-only module and close over them. Never store documents or relations in `McpServer`. Use transactions when document creation/review and Relation changes must be atomic. [SDK per-request factory](https://ts.sdk.modelcontextprotocol.io/v2/serving/http.html)

10. **Medium — clients own connection lifecycle and timeouts.** Construct `Client`, connect with `StreamableHTTPClientTransport`, discover via `listTools()`, and invoke via `callTool()`. The SDK handles legacy initialization/capability negotiation. In v2, `versionNegotiation: { mode: 'auto' }` opts into newest-era discovery with conservative legacy fallback. Tool failures resolve with `isError`; protocol failures throw. Use finite per-call timeouts. [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle) [SDK protocol versions](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions.html) [SDK calls](https://ts.sdk.modelcontextprotocol.io/v2/clients/calling.html)

11. **High — test through the production handler with a real client.** Instantiate the production factory, wrap it in `createMcpHandler`, then connect a real `Client` through `StreamableHTTPClientTransport` with custom `fetch` delegated to `handler.fetch`. This exercises negotiation, discovery, schema conversion/validation, errors, and output encoding without sockets. Against isolated PostgreSQL, cover:
   - exactly four advertised tools;
   - rejected additional/oversized/invalid inputs;
   - create→find→read→review;
   - globally duplicate Document Path rejection, including documents related to different projects;
   - one document related to multiple contexts/projects and relation-filtered discovery;
   - deterministic global pagination;
   - not-found/conflict/sanitized database errors;
   - output schema and text fallback;
   - teardown with `client.close()` then `handler.close()`.

   Add one adapter-node HTTP smoke test for route/body/header behavior and invalid-Origin 403. `InMemoryTransport.createLinkedPair()` only covers 2025-era instances, so it is not the primary v2-handler test. [Official SDK testing guide](https://ts.sdk.modelcontextprotocol.io/v2/testing.html)

## Proposed paths

- `docs/research/mcp-typescript-poc.md` — this report.
- `src/lib/server/mcp/server.ts` — cheap server factory and four registrations.
- `src/lib/server/mcp/schemas.ts` — strict schemas after issue 8 fixes contracts.
- `src/routes/mcp/+server.ts` — Origin/Host guard and handler delegation.
- `src/lib/server/mcp/server.test.ts` — real client + in-process handler + PostgreSQL.
- `tests/mcp-http.test.ts` — adapter-node boundary smoke test.

## Decision boundary

No product decision blocks the MCP integration. Exact schema fields and whether `review_document` writes state remain contract decisions for issue 8. Those details must preserve the corrected invariant: globally unique hierarchical Document Path plus many-to-many Relations, with no Project namespace or `projects` metadata.

## Sources

- Kept: [Official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) — package and release support status.
- Kept: [Serve over HTTP](https://ts.sdk.modelcontextprotocol.io/v2/serving/http.html) — handler API and lifecycle.
- Kept: [Tools](https://ts.sdk.modelcontextprotocol.io/v2/servers/tools.html) — registration, schemas, output, annotations.
- Kept: [Errors](https://ts.sdk.modelcontextprotocol.io/v2/servers/errors.html) — tool/protocol failure behavior.
- Kept: [Test a server](https://ts.sdk.modelcontextprotocol.io/v2/testing.html) — in-process real-client strategy.
- Kept: [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) and [tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) — normative rules.
- Dropped: unofficial tutorials, deprecated HTTP+SSE examples, and GitHub issues — redundant or weaker than official docs/specification.

## Gaps

- **High:** v2 remains beta on the ticket date.
- **High:** authentication is excluded, so the POC is not production-safe for unrestricted exposure.
- **Medium:** exact review persistence, relation mutation ownership, concurrency rules, search ranking, and cursor ordering await issue 8.
- **Medium:** no official SvelteKit adapter is documented; verify Web Request/Response delegation via HTTP smoke test.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Severity-ranked findings name docs/research/mcp-typescript-poc.md and concrete implementation/test paths; review findings and residual risks are supplied."
    }
  ],
  "changedFiles": [
    "/Users/d.plugge/dev/personal/agent-memory/.pi-subagents/artifacts/outputs/954d9b20-b08c-4558-a3ba-1531c337dfd1/mcp-research-result.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "Official MCP specification/TypeScript SDK research and repository inspection via provided tools",
      "result": "passed",
      "summary": "Verified server, schema, output, transport, client, lifecycle, error, and testing constraints."
    },
    {
      "command": "git commit/push and gh issue comment/close",
      "result": "not-run",
      "summary": "Child research role had no shell/GitHub mutation tool; parent must perform repository and issue operations."
    }
  ],
  "validationOutput": [
    "Primary evidence is from official MCP and TypeScript SDK sources.",
    "Report incorporates the corrected global Document Path plus Relations domain model and rejects Project namespace/projects metadata assumptions.",
    "No Wayfinder map was edited."
  ],
  "residualRisks": [
    "high: v2 SDK remains beta as of 2026-07-26.",
    "high: authentication is out of scope for a remotely reachable endpoint.",
    "medium: review_document persistence and exact Relation mutation contracts remain unresolved in issue 8.",
    "medium: SvelteKit has no official MCP adapter; verify the route with a real HTTP smoke test."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added the requested research artifact only; no repository files were changed by this child run.",
  "reviewFindings": [
    "high: docs/research/mcp-typescript-poc.md - preserve the v2-beta caveat; do not call it production-stable.",
    "high: src/lib/server/mcp/schemas.ts - use globally unique Document Path and Relations; do not add project namespace, projectId ownership, or projects metadata.",
    "high: src/routes/mcp/+server.ts - reject invalid Origin/Host before handler.fetch.",
    "high: src/lib/server/mcp/server.ts - keep PostgreSQL pool outside the per-request server factory.",
    "medium: src/lib/server/mcp/schemas.ts - defer review_document write annotations until issue 8 resolves persistence.",
    "no blockers in the research report itself"
  ],
  "manualNotes": "Parent must copy this report to docs/research/mcp-typescript-poc.md, commit/push research/mcp-typescript-poc, comment with the GitHub report link, and close issue 6."
}
```
