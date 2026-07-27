# Changelog

## [0.1.0](https://github.com/david-plugge/agent-memory/compare/agent-memory-v0.0.1...agent-memory-v0.1.0) (2026-07-27)


### ⚠ BREAKING CHANGES

* **knowledge:** replace find_documents' recursive flag with a depth-bounded table of contents

### Features

* **auth:** generate better-auth drizzle schema ([abd83b7](https://github.com/david-plugge/agent-memory/commit/abd83b77b35491327cbeb97cbf6a447c77d280d7))
* **env:** add build-time defaults for private env vars ([99ec2a0](https://github.com/david-plugge/agent-memory/commit/99ec2a055f6dd1e7e8bcf952408b624eef0ea509))
* **knowledge:** build the end-to-end knowledge MCP proof of concept ([5f91e53](https://github.com/david-plugge/agent-memory/commit/5f91e53554c4a44b379cb2aaab3967c6fd04c0d8)), closes [#11](https://github.com/david-plugge/agent-memory/issues/11)
* **knowledge:** end-to-end knowledge MCP proof of concept ([ea4cd1e](https://github.com/david-plugge/agent-memory/commit/ea4cd1ee6508959b08cf8d18aa98406773ea9d38))
* **knowledge:** replace find_documents' recursive flag with a depth-bounded table of contents ([3dc2d0d](https://github.com/david-plugge/agent-memory/commit/3dc2d0dcdc485eb453db218839e7979fab4cb083)), closes [#19](https://github.com/david-plugge/agent-memory/issues/19)
* **knowledge:** ride a one-level root skeleton on every non-browsing find_documents result ([f0455d0](https://github.com/david-plugge/agent-memory/commit/f0455d016bffe0223a05140af7fa1fd38a8a76fb))


### Bug Fixes

* **build:** patch kit remote module detection ([0ad36f8](https://github.com/david-plugge/agent-memory/commit/0ad36f8d21f2f3ccd233eba2100228eac7b693f2))
* **knowledge:** group the progressive listing in SQL, and keep branch-and-document nodes ([c2bb0a2](https://github.com/david-plugge/agent-memory/commit/c2bb0a25a143d821b335a419013395e9ebb8eb8c))
* **knowledge:** group the progressive listing in SQL, and keep branch-and-document nodes ([ad27a3a](https://github.com/david-plugge/agent-memory/commit/ad27a3acb4d0b74283a55efca2fea1fa6b29cdf6)), closes [#16](https://github.com/david-plugge/agent-memory/issues/16)


### Refactors

* **knowledge:** drop an unnecessary cast and clarify a comment ([23edd9e](https://github.com/david-plugge/agent-memory/commit/23edd9e3343714ec57743df515a0c710ad9d9d15))
* use #lib import alias instead of $lib ([fb494e4](https://github.com/david-plugge/agent-memory/commit/fb494e487c10bb9ca1ef6b09d7842c9c3baaea1f))
