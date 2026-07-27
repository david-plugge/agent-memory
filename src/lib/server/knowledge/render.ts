/**
 * Compact text rendering of every tool result. Ten hits rendered as JSON is a meaningful slice of a
 * fresh session's context, and context economy is part of the thesis under test — so the POC returns
 * text only, no `structuredContent`.
 *
 * Retrieval is lean: results carry the trust and freshness *outcome*, never the reasoning behind it.
 */
import type {
	Descriptor,
	DocumentDetail,
	FindResult,
	ListingNode,
	ReviewOutcome,
	RootSegment,
	WriteOutcome
} from './store';

function badges(descriptor: Descriptor, extra: string[] = []): string {
	const parts = [descriptor.status, descriptor.trustTier, ...extra];
	if (descriptor.stale) parts.push('stale');
	return `[${parts.join(' · ')}]`;
}

function day(date: Date): string {
	return date.toISOString().slice(0, 10);
}

/** A leaf: title, summary and tier — this is the level where the choice is actually made. */
function renderLeaf(label: string, descriptor: Descriptor, extra: string[] = []): string {
	return `${label} — ${descriptor.title}\n    ${descriptor.summary}\n    ${badges(descriptor, [`updated ${day(descriptor.updatedAt)}`, ...extra])}`;
}

/**
 * A node and its subtree. The immediate level carries descriptors, so it renders as a leaf block;
 * everything below it is a bare indented name — #10 measured that borrowing descriptions onto deeper
 * nodes costs more than dumping the whole corpus. A trailing slash marks a segment with no document of
 * its own, and a count appears only at the depth boundary, where documents really are hidden.
 */
function renderNode(node: ListingNode, indent: string): string[] {
	const count = node.hiddenCount > 0 ? ` (${node.hiddenCount})` : '';
	const head =
		node.descriptor === undefined
			? `${indent}${node.segment}${node.isDocument ? '' : '/'}${count}`
			: // A document that is also a branch earns a `below` badge only when the branch is not expanded.
				renderLeaf(
					node.segment,
					node.descriptor,
					node.hiddenCount > 0 ? [`${node.hiddenCount} below`] : []
				);
	return [head, ...node.children.flatMap((child) => renderNode(child, `${indent}  `))];
}

/**
 * The root skeleton, on one line: names and counts, no titles or summaries. This is the bootstrap tree
 * an agent that only ever searched would otherwise never see, so it has to stay cheap enough to ride on
 * every such result — two levels would cost roughly ten times as much, and one level is enough to say
 * the tree exists and where to descend.
 */
function renderRoot(root: RootSegment[]): string {
	const segments = root
		.map((entry) => `${entry.segment}${entry.isDocument ? '' : '/'} (${entry.documentCount})`)
		.join('  ');
	return `Top of the tree: ${segments} — browse a branch with path_prefix.`;
}

function renderFindBody(result: FindResult): string {
	if (result.kind === 'hits') {
		if (result.hits.length === 0)
			return [
				'No documents matched.',
				'Try a broader query phrased as the process you are carrying out (for example "how do I create a table in drizzle"), or browse with path_prefix.'
			].join('\n');
		return result.hits.map((hit) => renderLeaf(hit.path, hit)).join('\n');
	}

	// A document at exactly the browsed prefix describes the level, so it *is* the header — the agent
	// that descended on a `below` badge reads it here rather than spending another call.
	const header =
		result.self !== undefined
			? renderLeaf(result.prefix, result.self)
			: result.prefix === ''
				? ''
				: `${result.prefix}/`;

	const where = result.prefix === '' ? 'the top of the tree' : `'${result.prefix}'`;
	if (result.nodes.length === 0) {
		if (result.self !== undefined) return `${header}\nNothing below it.`;
		return [
			`Nothing under ${where}.`,
			'Browse a shorter path_prefix, or search with a query. Add status to see drafts or deprecated documents.'
		].join('\n');
	}
	const body = result.nodes.flatMap((node) => renderNode(node, '')).join('\n');
	return (header === '' ? '' : `${header}\n`) + body;
}

export function renderFind(result: FindResult): string {
	const body = renderFindBody(result);
	return result.root?.length ? `${body}\n\n${renderRoot(result.root)}` : body;
}

export function renderDocument(document: DocumentDetail): string {
	const head = `${document.path} (revision ${document.revisionNumber} of ${document.revisionCount})`;
	const meta = badges(document, [
		`${document.rejectedCount} rejected`,
		`by ${document.authorActor}`,
		`written ${day(document.createdAt)}`
	]);
	const sources = document.sources.length
		? '\nSources:\n' +
			document.sources.map((source) => `  - ${source.title ?? source.uri} ${source.uri}`).join('\n')
		: '';
	return `${head}\n${document.title}\n${meta}${sources}\n\n${document.body}`;
}

export function renderWrite(outcome: WriteOutcome): string {
	return `${outcome.action} '${outcome.path}' as revision ${outcome.revisionNumber}.`;
}

export function renderReview(outcome: ReviewOutcome, verdict: string, actor: string): string {
	return `recorded ${verdict} by ${actor} on '${outcome.path}' revision ${outcome.revisionNumber}; trust tier is now ${outcome.trustTier}.`;
}
