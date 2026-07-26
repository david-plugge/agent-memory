# Research: Which OKF v0.2 ideas the Wayfinder POC should preserve

## Summary

OKF v0.2 is a deliberately small interchange model for knowledge that remains readable as Markdown while making origin, review, currency, and sanctioned computation machine-visible. For this PostgreSQL/MCP POC, preserve those **semantics**, not OKF's file/YAML packaging: hierarchical paths and staged retrieval; immutable revision-scoped provenance and reviews; derived, advisory trust tiers; and visible lifecycle/freshness. Omit OKF conformance, bundle files, generated indexes/logs, source popularity scoring, relationship graphs, and attested-computation execution.

The central design rule is separation of concerns: content generation is not verification; source credibility is not a stored trust verdict; document verification is not run attestation; freshness is not lifecycle; and hierarchy is a discovery aid rather than the full relationship model.

## Findings

1. **OKF solves exchange and maintenance problems, not storage or serving.** Its base format—UTF-8 Markdown, YAML frontmatter, and a directory tree—aims to be human-readable, agent-parseable, diffable, portable, and usable without bespoke SDKs. v0.2 specifically addresses continuously agent-maintained corpora by making five questions queryable: provenance, trust, freshness, lifecycle, and computation attestation. Storage/query infrastructure, fixed taxonomies, domain schemas, and code packaging are explicit non-goals. The Google README also calls its reference agent and visualizer proofs of concept rather than part of the format. [SPEC §§1–2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md#1-motivation) [Google OKF README](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf#open-knowledge-format-okf)

2. **Hierarchy and progressive disclosure form a retrieval protocol.** In OKF, a concept's path (minus `.md`) is its identity; directories group concepts, while optional `index.md` files expose one level's titles/descriptions before consumers load full bodies. Indexes may be generated or synthesized when absent. Ordinary Markdown links add untyped graph edges beyond the tree, and broken links remain consumable. Thus hierarchy answers “where should I look?”, an index answers “what is here?”, and a concept body answers “what does it say?”—a bounded context-loading sequence rather than merely a filesystem layout. [SPEC §§3, 6, 8](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md#3-bundle-structure)

3. **Structured metadata and prose have deliberately different jobs.** OKF makes only `type` universally required; fields that consumers filter, route, or summarize belong in frontmatter, while explanation, schemas, citations, examples, and links stay in Markdown. Unknown types and extension fields must be tolerated, and unknown keys should be preserved on round-trip. This is the idea the POC should carry into service-managed columns/records plus unchanged Markdown bodies; reproducing YAML frontmatter would duplicate the database contract without improving the experiment. [SPEC §4](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md#4-concept-documents) [README, “Why OKF?”](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf#why-okf)

4. **Provenance is evidence, while credibility remains a consumer judgment.** `sources` records each material's URI/scope and optionally a stable `id`, title, actor-like author, usage count/window, and last-modified date. Stable source IDs join claim-level Markdown footnotes to source records and survive source reordering. OKF intentionally does **not** store a credibility score: authority, use, and recency are objective-but-partial signals whose weight varies by consumer and can go stale. Links to internal concepts permit recursive lineage; explicit deep/external lineage is deferred. [SPEC §5.1](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md#51-provenance-sources)

5. **Generated and verified are separate event histories.** `generated.by/at` identifies who or what produced the current content and its last meaningful change. `verified[]` independently records actors and times that checked it against sources or the represented resource. Edits may occur without re-verification, and re-verification may occur without edits. Actor strings distinguish agents/tools, `human:<id>`, and `process:<id>`; this is classification syntax, not authenticated identity. [SPEC §§5.2, 7](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md#52-trust-generated-and-verified)

6. **Trust tiers are derived, coarse, and advisory.** No verification means `unverified`; only non-human verification means `machine-confirmed`; any `human:` verification means `human-reviewed`. Missing trust metadata never makes a concept invalid, and tiers are not access control. This preserves inspectable evidence and avoids a mutable `trust` flag drifting from its review events. It does not measure correctness, reviewer independence, source quality, or cryptographic authenticity. [SPEC §5.3](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md#53-trust-tiers)

7. **Lifecycle and freshness are orthogonal signals.** `status` is `draft | stable | deprecated`, with absent status meaning stable; deprecation retains an address for links/history while saying it is no longer current. `stale_after` is an optional absolute date and becomes stale on that date, while `generated.at` says when content last meaningfully changed and `verified[].at` says when it was last checked. A document may therefore be stable but stale, draft but recently generated, or deprecated yet preserved. OKF does not model the separate question “for which product/version/time interval is this claim applicable?” [SPEC §§5.2, 5.4–5.5](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md#54-lifecycle-status)

8. **Attested computation closes a different trust gap.** A standalone `Attested Computation` defines a runtime, typed parameter holes, immutable inline/referenced computation, executor receipt shape, and deterministic non-LLM attester. Consumers bind only declared values; the attester compares the actual expanded/compiled artifact and authoritative result with the sanctioned definition. `verified` says the definition still matches policy; a runtime attestation says one execution used that definition and produced the displayed result. Either can succeed while the other fails. The specification records the contract but executes nothing. [SPEC §§10.1–10.6](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md#10-attested-computations-concept)

9. **Normative OKF behavior is intentionally permissive.** For conformance, non-reserved Markdown documents need parseable frontmatter and non-empty `type`; reserved `index.md`/`log.md` follow their specified structures. Consumers must normalize a single `verified` mapping to a one-element list and must not reject missing optional families, unknown types/keys, broken links, or missing indexes. Most richer behavior uses MAY/SHOULD, including indexes, descriptions, trust derivation, staleness handling, and surfacing failed attestation. The attestation workflow in §10.5 is explicitly informative. Since Wayfinder is not an OKF producer/consumer, none of these requirements bind the POC; they are evidence for its domain choices. [SPEC §§10.5, 11–12](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md#11-conformance)

10. **v0.2 itself demonstrates why semantics should outlive field shapes.** It supersedes v0.1 `timestamp` with `generated.at` and body `# Citations` with structured `sources`, while offering consumer fallbacks. The new provenance/trust/lifecycle/computation families are otherwise optional additions. The durable ideas are separate evidence, review, and currency axes—not exact frontmatter spelling. [SPEC §13](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md#13-changes-from-v01)

## Concrete POC implications

### Preserve

- **Human-authored hierarchical Document Paths as public identity.** Support path-prefix browsing as the tree axis. Return lightweight path/title/summary/trust/freshness records from `find_documents`; reserve full Markdown and revision detail for `read_document`. This is the service equivalent of progressive disclosure.
- **Markdown as the knowledge payload and queryable service metadata beside it.** Do not rewrite bodies to embed service state. PostgreSQL replaces YAML/frontmatter and Git as the canonical persistence mechanism; this is an adaptation, not an OKF bundle.
- **Immutable Revision provenance.** Each revision should carry asserted producer actor and creation time, plus any accepted source references. Because revisions never mutate, a new edit naturally starts a new verification context rather than ambiguously invalidating reviews on old content.
- **Reviews as revision-scoped evidence.** `review_document` should append a review event against an exact Revision. Authorship must not count as verification merely because the author is human: in OKF, `generated` and `verified` are different facts.
- **Derived Trust Tiers.** Derive the approved `unverified → agent-reviewed → human-reviewed` tier from reviews rather than storing it independently. `agent-reviewed` is the POC adaptation of OKF's broader `machine-confirmed`. Return the tier together with enough review evidence (actor class and timestamp) to explain it. It remains advisory because POC actors are asserted, not authenticated.
- **Visible lifecycle/freshness as independent filters/warnings.** Preserve a small lifecycle state and an absolute stale-after date if issue #7 includes them; expose both in find/read responses. Never infer “fresh” merely from a high trust tier or recent creation, and never use staleness as deletion.
- **Graceful partial knowledge.** Missing optional provenance/reviews/freshness should produce explicit unknown/unverified states, not rejection. This is essential for incremental authoring.

### Adapt

- **Synthesize indexes in `find_documents`; do not persist `index.md`.** PostgreSQL can generate child listings and snippets consistently, avoiding duplicate index documents and update races.
- **Use service timestamps rather than `generated.at` inside Markdown.** Revision creation time is a strong equivalent for “current content last meaningfully changed”; a latest-review timestamp must remain separate.
- **Attach source records to Revisions, not mutable Documents.** A source supported the exact claims in a particular body. If the POC supports claim-level citations, retain stable source keys so Markdown footnotes can join to metadata; otherwise keep simple source URI/title provenance and explicitly defer claim-level linkage.
- **Keep lifecycle semantics while fitting immutable history.** A current Revision can expose draft/stable/deprecated state, and old revisions retain their former state. Exact ownership of status (Document versus Revision) is a contract decision for issue #7, not something OKF settles for a database model.
- **Surface rather than enforce trust.** Retrieval may rank or warn using trust/freshness, but should not hide unverified documents by default; OKF's tiers are not authorization.

### Deliberately omit from this POC

- OKF conformance, YAML parsing/round-tripping, filesystem bundles, `okf_version`, `index.md`, and prose `log.md`.
- Fixed/enforced concept taxonomy, typed relationship graph, backlink extraction, and broken-link validation. Ordinary Markdown links can remain content.
- Source `usage_count`/`usage_window`, credibility scores, and automatic credibility propagation. The POC has no trustworthy cross-kind telemetry, and OKF itself rejects a universal score.
- Attested Computation executors, receipts, attesters, ABI/sandboxing, and per-run gating. Preserve only the conceptual distinction between document review and execution proof; the approved scope explicitly defers runtime execution.
- Semantic/vector search unless lexical search fails, plus authentication, permissions, multitenancy, cryptographic actor/source authenticity, and policy enforcement.

## Gaps and deferred concerns

- **Freshness is not applicability.** `stale_after` cannot express that knowledge applies only to release X–Y, environment A, or an effective-date interval. Add applicability only after a demonstrated developer use case.
- **Path identity makes moves identity changes unless aliases/redirects are designed.** OKF tolerates broken links but does not specify renames. The POC needs no move operation today; future rename semantics must be deliberate.
- **No contradiction/conflict model.** OKF does not say how competing claims, rejected reviews, or multiple current documents resolve. The four-tool POC can prove discovery without solving consensus.
- **Trust evidence is asserted, not authenticated.** A `human-reviewed` label in the single-user POC proves workflow classification, not the reviewer's identity or authority.
- **Trust tier loses nuance.** Multiple independent reviews, reviewer expertise, source quality, and negative/disputed reviews do not fit the three-tier ladder. Return evidence alongside the tier and avoid presenting it as confidence.
- **Lifecycle placement remains for issue #7.** Research supports separate lifecycle/freshness semantics but does not decide whether status is revision state, document state, or a current-pointer policy.
- **Attestation is knowingly incomplete even in OKF v0.2.** Receipt/verdict wire formats, lifecycle, ABI, portability, sandboxing, caching, and semantic-layer comparison are explicitly deferred by the specification. [SPEC §12, “Considered and deferred”](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md#considered-and-deferred)

## Recommendation

The POC should test one narrow hypothesis: a fresh agent session can cheaply browse/search a hierarchical corpus, inspect full Markdown only when needed, see where the selected revision came from, and judge review and currency from explicit evidence. That preserves OKF v0.2's most important system property—a self-describing trust surface—while avoiding a misleading claim of format compatibility and excluding runtime computation trust from a document-memory experiment.

## Sources

- **Kept:** [Open Knowledge Format v0.2 normative specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) — authoritative definitions, RFC-style requirements, examples, conformance, and deferred work.
- **Kept:** [Google Knowledge Catalog OKF README](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) — primary design rationale and explicit boundary between the format and reference producer/consumer proofs of concept.
- **Kept:** [Wayfinder parent issue #4](https://github.com/david-plugge/agent-memory/issues/4) — authoritative approved POC constraints against which implications were evaluated.
- **Dropped:** Google repository sample bundles — useful illustrations but redundant with the specification's worked example and not normative.
- **Dropped:** Google repository reference-agent tests — implementation-oriented and still contain older v0.1-era validation assumptions; they do not override the self-contained v0.2 specification.
- **Dropped:** Community proposals/issues on reliability, stable IDs, and temporal validity — useful future directions but not accepted OKF v0.2 normative material.

## Review findings

- **No blockers:** research supports the already approved POC boundaries and does not require a new material product decision.
- **Medium — future contract risk:** `docs/research/okf-v02-poc.md` should not imply that a human author automatically creates a human-reviewed revision; generation and verification must remain separate.
- **Medium — future UX risk:** trust and freshness must both be returned in retrieval/read results; collapsing either into ranking alone would hide the evidence OKF is designed to expose.
- **Low — terminology risk:** call the middle POC tier `agent-reviewed` as approved, but document that it adapts OKF's `machine-confirmed` and is not cryptographic verification.

## Residual risks

- Citations target Google repository `main`; a future upstream edit could change content at those URLs. Pin the source commit if the project requires reproducible historical citation.
- Exact source schema, negative-review semantics, lifecycle ownership, and MCP response fields remain decisions for issues #7 and #8.
- This research subagent did not modify the project branch, commit/push, comment on issue #5, or close it because the runtime required the deliverable only at this artifact path; the parent must apply and publish the report.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete preserve/adapt/omit findings, file-targeted review findings for docs/research/okf-v02-poc.md, and residual risks are included above."
    }
  ],
  "changedFiles": [
    "/Users/d.plugge/dev/personal/agent-memory/.pi-subagents/artifacts/outputs/954d9b20-b08c-4558-a3ba-1531c337dfd1/okf-research-result.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "No shell commands available; researched via web_search/fetch_content and wrote the runtime artifact",
      "result": "not-run",
      "summary": "Primary OKF v0.2 specification, Google README, and Wayfinder issues were inspected."
    }
  ],
  "validationOutput": [
    "Report covers hierarchy/progressive disclosure, provenance, credibility signals, generated versus verified, derived trust tiers, lifecycle/freshness, attested computation, normative versus informative behavior, gaps, and POC implications.",
    "All substantive OKF claims cite primary Google repository material.",
    "No Wayfinder map was edited."
  ],
  "residualRisks": [
    "Upstream citations point to mutable main rather than a pinned commit.",
    "Parent must copy/publish the report, commit and push the branch, then comment on and close issue #5.",
    "Exact lifecycle ownership and tool response fields remain for issues #7 and #8."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added one research artifact with a source-cited OKF v0.2 analysis and concrete preserve/adapt/omit guidance for the approved PostgreSQL/MCP POC.",
  "reviewFindings": [
    "no blockers",
    "medium: docs/research/okf-v02-poc.md - do not conflate human authorship with human verification",
    "medium: MCP retrieval contract - expose both trust evidence and freshness instead of hiding them in ranking",
    "low: trust terminology - document agent-reviewed as an adaptation of OKF machine-confirmed"
  ],
  "manualNotes": "Runtime path override prevented direct creation of docs/research/okf-v02-poc.md and publication operations in this subagent run."
}
```
