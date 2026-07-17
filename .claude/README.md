# Claude Code configuration

## Codex reviewer plugin

This repo enables the [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc)
plugin so OpenAI Codex can act as a second-opinion reviewer for code that
Claude Code writes. The marketplace and plugin are declared in
`settings.json`, so anyone who opens this repo in Claude Code is prompted to
trust and enable it automatically — no manual `/plugin` steps needed.

### Commands

| Command | Purpose |
| --- | --- |
| `/codex:review` | Fast second-opinion review of the current git diff |
| `/codex:adversarial-review` | Hunts for edge cases, race conditions, and security flaws |
| `/codex:rescue` | Offloads a stubborn bug to Codex in the background |
| `/codex:status` / `/codex:result` / `/codex:cancel` | Manage background Codex jobs |
| `/codex:setup [--enable-review-gate]` | Verify Codex readiness; optional gate blocks Claude from finishing until Codex approves the diff |

### Prerequisites (per developer machine)

The plugin shells out to the Codex CLI, which is **not** bundled. On your
working environment you need:

1. **Node.js 18.18+** and the Codex CLI: `npm install -g @openai/codex`
2. **Auth** — a ChatGPT subscription (`codex login`) or an OpenAI API key.
3. Run `/codex:setup` once to verify readiness.

> Note: the optional review gate (`/codex:setup --enable-review-gate`) can
> create a long-running Claude/Codex loop and may drain usage limits quickly.
