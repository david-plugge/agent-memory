/**
 * PROTOTYPE — throwaway terminal shell over ./retrieval.ts. Nothing here ships.
 * Run: pnpm proto:retrieval
 *
 * Traversal first: you are the agent. Start at the root, read what the service would hand back at
 * this level, and pick a branch. The walk records how many levels and how many tokens it cost you to
 * reach the document. Search is the fallback arm, behind [s].
 */
import readline from 'node:readline/promises';
import postgres from 'postgres';

import { type Trust, corpus } from './corpus.ts';
import * as r from './retrieval.ts';
import { CROSS_CONTEXT, type Vocabulary, scenarioSets } from './scenarios.ts';

const DATABASE_URL =
	process.env.DATABASE_URL ?? 'postgres://root:mysecretpassword@localhost:5432/local';

const b = (s: string) => `\x1b[1m${s}\x1b[0m`;
const d = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

const TRUST_MARK: Record<Trust, string> = {
	'human-reviewed': green('H'),
	'agent-reviewed': yellow('A'),
	unverified: d('·')
};

const STYLES: r.ListingStyle[] = [
	'progressive',
	'segments',
	'segments-and-counts',
	'borrowed-titles',
	'full'
];

const sql = postgres(DATABASE_URL, { onnotice: () => {} });
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

type View = { title: string; lines: string[] };

let view: View = { title: 'ready', lines: [] };
let cwd = '';
let style: r.ListingStyle = 'progressive';
let walk: { steps: string[]; tokens: number } = { steps: [], tokens: 0 };
let queryMode: r.QueryMode = 'and';
let vocabulary: Vocabulary = 'process';
let docCount = 0;

function render() {
	console.clear();
	console.log(b('PROTOTYPE — traversal-first retrieval') + d('  (#10)'));
	console.log(
		d(
			`${docCount} documents   listing style: ${style}   search: ${vocabulary}/${queryMode}   trust: ${TRUST_MARK['human-reviewed']}uman ${TRUST_MARK['agent-reviewed']}gent ·unverified`
		)
	);
	console.log(d('─'.repeat(100)));
	console.log(b(view.title));
	console.log('');
	for (const line of view.lines) console.log(line);
	console.log('');
	console.log(d('─'.repeat(100)));
	console.log(
		[
			`${b('[<segment>]')}${d(' descend')}`,
			`${b('[u]')}${d(' up')}`,
			`${b('[/]')}${d(' root')}`,
			`${b('[l]')}${d(' listing style')}`,
			`${b('[c]')}${d(' cost table')}`,
			`${b('[s]')}${d(' search')}`,
			`${b('[x]')}${d(' scenarios')}`,
			`${b('[o]')}${d(' and/or')}`,
			`${b('[v]')}${d(' process/task')}`,
			`${b('[i]')}${d(' inflate')}`,
			`${b('[r]')}${d(' reseed')}`,
			`${b('[q]')}${d(' quit')}`
		].join('  ')
	);
}

/** The traversal view: exactly what the service would return for `cwd`, and nothing else. */
async function showLevel() {
	const nodes = await r.listing(sql, cwd);
	const rendered = r.renderListing(nodes, style);

	const lines = [
		d(`find_documents(prefix: "${cwd}") → ${nodes.length} entries, ~${r.tokens(rendered)} tokens`),
		'',
		...rendered.split('\n').map((line) => (line.startsWith('    ') ? d(line) : `  ${line}`)),
		''
	];

	if (walk.steps.length) {
		lines.push(d('─'.repeat(96)));
		lines.push(
			`${b('walk:')} ${walk.steps.map(cyan).join(d(' → '))}   ${b('levels:')} ${walk.steps.length}   ${b('tokens paid:')} ~${walk.tokens}`
		);
	}

	view = { title: `/${cwd}`, lines };
}

async function descend(segment: string) {
	const nodes = await r.listing(sql, cwd);
	const match = nodes.find((node) => node.segment === segment);
	if (!match) {
		view = { title: `/${cwd}`, lines: [red(`no child "${segment}" at this level`)] };
		return;
	}

	walk.tokens += r.tokens(r.renderListing(nodes, style));
	walk.steps.push(segment);

	if (!match.isDocument) {
		cwd = match.path;
		await showLevel();
		return;
	}

	const [row] = await sql<{ body: string }[]>`
		select r.body from ${sql(r.SCHEMA)}.revision r
		join ${sql(r.SCHEMA)}.document d on d.id = r.document_id
		where d.path = ${match.path}
	`;
	view = {
		title: `read_document("${match.path}")`,
		lines: [
			`${b(match.title!)} ${TRUST_MARK[match.trust!]}`,
			d(match.summary!),
			'',
			d(`body: ~${r.tokens(row.body)} tokens`),
			d('─'.repeat(96)),
			`${b('walk:')} ${walk.steps.map(cyan).join(d(' → '))}   ${b('levels:')} ${walk.steps.length}   ${b('tokens paid to find it:')} ~${walk.tokens}`
		]
	};
}

/** Walking versus dumping: what each option costs at this corpus size. */
async function costTable() {
	const lines = [b('one level, by listing style')];
	for (const prefix of ['', 'stack', 'stack/drizzle']) {
		const nodes = await r.listing(sql, prefix);
		lines.push(d(`  prefix "${prefix || '/'}" — ${nodes.length} entries`));
		for (const candidate of STYLES) {
			const text = r.renderListing(nodes, candidate);
			lines.push(`    ${candidate.padEnd(20)} ~${String(r.tokens(text)).padStart(5)} tokens`);
		}
	}

	lines.push('');
	lines.push(b('the whole corpus in one call — the alternative to walking at all'));
	for (const [label, flatStyle] of [
		['paths only', 'paths'],
		['paths + titles', 'paths-and-titles'],
		['paths + summaries', 'paths-titles-summaries']
	] as const) {
		const text = await r.flatListing(sql, flatStyle);
		lines.push(`    ${label.padEnd(20)} ~${String(r.tokens(text)).padStart(5)} tokens`);
	}

	lines.push('');
	lines.push(
		d(
			'A walk pays for every level it passes through. Compare that total against dumping everything once.'
		)
	);
	view = { title: 'listing cost', lines };
}

function searchRow(hit: r.Descriptor, index: number) {
	return `${d(String(index + 1).padStart(2))} ${hit.rank.toFixed(4)} ${TRUST_MARK[hit.trust]} ${hit.path.padEnd(44)} ${d(hit.title.slice(0, 40))}`;
}

async function doSearch(query: string) {
	const [weighted, bodyOnly] = await Promise.all([
		r.search(sql, query, 'weighted', queryMode),
		r.search(sql, query, 'body', queryMode)
	]);
	view = {
		title: `search "${query}" — the fallback arm`,
		lines: [
			b(`weighted tsvector (path+title A, summary B, body C) — ${queryMode}`),
			...(weighted.length ? weighted.map(searchRow) : [d('   no matches')]),
			'',
			b(`control: body-only, unweighted — ${queryMode}`),
			...(bodyOnly.length ? bodyOnly.map(searchRow) : [d('   no matches')])
		]
	};
}

async function runScenarios() {
	const scenarios = scenarioSets[vocabulary];
	const lines: string[] = [];
	let top1 = 0;
	let top3 = 0;
	let any = 0;
	let order = 0;
	let orderTotal = 0;
	const cross = new Set<string>();

	for (const scenario of scenarios) {
		const hits = await r.search(sql, scenario.query, 'weighted', queryMode);
		const paths = hits.map((hit) => hit.path);
		const positions = scenario.expect.map((path) => paths.indexOf(path));

		if (positions.some((p) => p === 0)) top1++;
		if (positions.some((p) => p >= 0 && p < 3)) top3++;
		if (positions.some((p) => p >= 0)) any++;
		for (const [i, path] of scenario.expect.entries()) {
			if (positions[i] >= 0 && CROSS_CONTEXT.includes(path)) cross.add(path);
		}

		let note = '';
		if (scenario.outrank) {
			orderTotal++;
			const wi = paths.indexOf(scenario.outrank[0]);
			const li = paths.indexOf(scenario.outrank[1]);
			const ok = wi >= 0 && (li < 0 || wi < li);
			if (ok) order++;
			note = `   ${ok ? green('order ok') : red('OUTRANKED')}`;
		}

		const verdicts = scenario.expect.map((path, i) => {
			const at = positions[i];
			if (at === 0) return green(`#1 ${path}`);
			if (at > 0 && at < 3) return yellow(`#${at + 1} ${path}`);
			if (at >= 3) return d(`#${at + 1} ${path}`);
			return red(`-- ${path}`);
		});

		lines.push(`${b(scenario.query)} ${d(`(${hits.length})`)}`);
		lines.push(`   ${verdicts.join('   ')}${note}`);
	}

	const n = scenarios.length;
	lines.push('');
	lines.push(d('─'.repeat(96)));
	lines.push(
		`${b('#1:')} ${top1}/${n}   ${b('top 3:')} ${top3}/${n}   ${b('found:')} ${any}/${n}   ${b('near-miss order:')} ${order}/${orderTotal}   ${b('cross-context:')} ${cross.size}/3`
	);
	view = { title: `search scenarios — ${vocabulary} vocabulary, ${queryMode} mode`, lines };
}

async function reseed() {
	await r.reset(sql);
	await r.seed(sql, corpus);
	docCount = await r.count(sql);
	cwd = '';
	walk = { steps: [], tokens: 0 };
	await showLevel();
}

async function main() {
	await reseed();
	render();

	for (;;) {
		if (rl.closed) break;
		const input = (await rl.question('> ')).trim();
		const key = input.toLowerCase();
		try {
			if (key === 'q') break;
			else if (key === 'u') {
				cwd = cwd.split('/').slice(0, -1).join('/');
				await showLevel();
			} else if (key === '/') {
				cwd = '';
				walk = { steps: [], tokens: 0 };
				await showLevel();
			} else if (key === 'l') {
				style = STYLES[(STYLES.indexOf(style) + 1) % STYLES.length];
				await showLevel();
			} else if (key === 'c') await costTable();
			else if (key === 's') await doSearch((await rl.question('query: ')).trim());
			else if (key === 'x') await runScenarios();
			else if (key === 'o') {
				queryMode = queryMode === 'and' ? 'or' : 'and';
				await runScenarios();
			} else if (key === 'v') {
				vocabulary = vocabulary === 'process' ? 'task' : 'process';
				await runScenarios();
			} else if (key === 'i') {
				await r.inflate(sql, 5000);
				docCount = await r.count(sql);
				await showLevel();
			} else if (key === 'r') await reseed();
			else if (input) await descend(input);
			else await showLevel();
		} catch (error) {
			view = { title: 'error', lines: [red(String(error))] };
		}
		render();
	}

	rl.close();
	await sql.end();
}

await main();
