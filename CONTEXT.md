# Shared Agent Knowledge

A shared body of developer knowledge that agents can author, discover, and consume across projects and sessions.

## Language

**Knowledge Document**:
A Markdown document that captures one unit of developer knowledge together with provenance, lifecycle, and review metadata.
_Avoid_: Concept, memory, entry

**Document Path**:
The stable, globally unique, human-authored hierarchical identity of a Knowledge Document. Immutable once created.
_Avoid_: Document ID, key, slug

**Revision**:
An immutable version of a Knowledge Document at a Document Path. The latest Revision is current.
_Avoid_: Version, overwrite

**Review**:
A recorded human or agent verdict about one Revision.
_Avoid_: Approval, verification

**Trust Tier**:
The consumer-facing classification derived from a Revision's Reviews: unverified, agent-reviewed, or human-reviewed.
_Avoid_: Trust score, credibility score

**Actor**:
The asserted, unauthenticated identity that authored a Revision or recorded a Review, classified as `agent:<name>` or `human:<id>`.
_Avoid_: User, author, reviewer
