---
name: svelte-mcp
description: The Svelte MCP server provides comprehensive Svelte 5 and SvelteKit documentation plus an autofixer. Use it whenever you write or change Svelte / SvelteKit code.
---

# Svelte MCP docs workflow

1. **`list-sections`** — call first to discover all available documentation sections (returns
   titles, `use_cases`, and paths).
2. **`get-documentation`** — fetch every section relevant to the task; judge relevance from each
   section's `use_cases`. Accepts single or multiple sections.
3. **`svelte-autofixer`** — run on any Svelte code you write, and keep calling it until it returns
   no issues or suggestions, before showing the code to the user.
