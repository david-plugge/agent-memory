import { defineEnvVars } from '@sveltejs/kit/env';
import * as z from 'zod';

import { building } from '$app/env';

/**
 * Placeholder used while building, where the real value is not available yet.
 * At runtime the variable stays required.
 */
function buildTimeDefault<Schema extends z.ZodType>(
	schema: Schema,
	value: z.core.util.NoUndefined<z.core.output<Schema>>
) {
	return building ? schema.default(value) : schema;
}

export const variables = defineEnvVars({
	DATABASE_URL: {
		description: 'The database connection string.',
		schema: buildTimeDefault(z.string(), 'postgres://build:build@localhost:5432/build')
	},
	ORIGIN: {
		description: 'The app origin (base URL), e.g. `http://localhost:5173`.',
		schema: buildTimeDefault(z.string(), 'http://localhost:3000')
	},
	BETTER_AUTH_SECRET: {
		schema: buildTimeDefault(z.string(), 'build-time-placeholder-not-used-at-runtime'),
		description:
			'Secret used to sign tokens. For production use 32 characters generated with high entropy. See [Better Auth installation](https://www.better-auth.com/docs/installation).'
	}
});
