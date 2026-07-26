/** @type {import("prettier").Config} */
const config = {
	useTabs: true,
	singleQuote: true,
	trailingComma: 'none',
	printWidth: 100,
	plugins: [
		'@trivago/prettier-plugin-sort-imports',
		'prettier-plugin-svelte',
		'prettier-plugin-tailwindcss'
	],
	overrides: [
		{ files: '*.svelte', options: { parser: 'svelte' } },
		{
			files: 'pnpm-workspace.yaml',
			options: {
				singleQuote: false
			}
		}
	],
	tailwindStylesheet: './src/routes/layout.css',

	importOrder: ['^\\$env/(.*)$', '^\\$app/(.*)$', '^\\$lib/(.*)$', '^[./]'],
	importOrderSeparation: true,
	importOrderSortSpecifiers: true
};

export default config;
