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
function renderLeaf(label: string, descriptor: Descriptor): string {
	return `${label} — ${descriptor.title}\n    ${descriptor.summary}\n    ${badges(descriptor, [`updated ${day(descriptor.updatedAt)}`])}`;
}

function renderNode(node: ListingNode): string {
	// An intermediate node gets a bare segment and a descendant count. Nothing more: borrowing titles
	// from the documents beneath it costs more context than dumping the entire corpus.
	if (node.kind === 'segment') return `${node.segment}/ (${node.documentCount})`;
	return renderLeaf(node.segment, node.descriptor);
}

export function renderFind(result: FindResult): string {
	if (result.kind === 'hits') {
		if (result.hits.length === 0)
			return [
				'No documents matched.',
				'Try a broader query phrased as the process you are carrying out (for example "how do I create a table in drizzle"), or browse with path_prefix.'
			].join('\n');
		return result.hits.map((hit) => renderLeaf(hit.path, hit)).join('\n');
	}

	const where = result.prefix === '' ? 'the top of the tree' : `'${result.prefix}'`;
	if (result.nodes.length === 0)
		return [
			`Nothing under ${where}.`,
			'Browse a shorter path_prefix, or search with a query. Add status to see drafts or deprecated documents.'
		].join('\n');
	const header = result.prefix === '' ? '' : `${result.prefix}/\n`;
	return header + result.nodes.map(renderNode).join('\n');
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
