import { describe, expect, it } from 'vitest';

import { KnowledgeError, agentActor, assertHumanActor, assertValidPath, pathWords } from './paths';

describe('Document Path grammar', () => {
	it('accepts a hierarchical lowercase path', () => {
		expect(assertValidPath('stack/drizzle/migration-workflow')).toBe(
			'stack/drizzle/migration-workflow'
		);
	});

	it.each([
		['', 'empty'],
		['/stack/drizzle', 'leading slash'],
		['stack/drizzle/', 'trailing slash'],
		['stack/drizzle/notes.md', 'markdown extension'],
		['Stack/Drizzle', 'uppercase'],
		['stack/drizzle workflow', 'space'],
		['stack//drizzle', 'empty segment'],
		['a/b/c/d/e/f/g/h/i', 'nine segments']
	])('rejects %j (%s)', (path) => {
		expect(() => assertValidPath(path)).toThrow(KnowledgeError);
	});
});

describe('Actors', () => {
	it('derives an agent actor from the client name', () => {
		expect(agentActor('claude-code')).toBe('agent:claude-code');
	});

	it('falls back to agent:unknown for a missing or unusable client name', () => {
		expect(agentActor(undefined)).toBe('agent:unknown');
		expect(agentActor('!!!')).toBe('agent:unknown');
	});

	it('accepts a well-formed human identity and rejects anything else', () => {
		expect(assertHumanActor('human:david')).toBe('human:david');
		expect(() => assertHumanActor('david')).toThrow(KnowledgeError);
		expect(() => assertHumanActor('agent:claude-code')).toThrow(KnowledgeError);
	});
});

describe('search terms', () => {
	it('turns path segments into words so the index can weight them', () => {
		expect(pathWords('stack/drizzle/migration-workflow')).toBe('stack drizzle migration workflow');
	});
});
