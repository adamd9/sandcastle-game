# SandCastle Wars — Secrets & Environment Variables Reference

This document covers every secret, token, and environment variable used across the full solution.
Keep it up to date when adding new secrets.

> ⚠️ Never commit actual secret values. This file documents **names and purposes only**.
>
> 💡 **Token naming convention**: all GitHub PATs created for this project are prefixed `sandcastle-wars-` in GitHub's token settings (e.g. `sandcastle-wars-copilot-token`), making them easy to identify and rotate together.

---

## Summary table

| Name | Where set | Used by | Purpose |
|---|---|---|---|
| `TICK_ADMIN_KEY` | Azure App Service env + repo secret | API server, God Mode UI | Admin key for all protected API endpoints |
| `COPILOT_TOKEN` | All 3 repos (Actions secret) | `hooks.js`, `improve.yml`, `player-turn.yml` | PAT to dispatch workflows + create GitHub issues |
| `COPILOT_GITHUB_TOKEN` | `sandcastle-game` repo (Actions secret) | `review-improvements.lock.yml` (gh-aw runner) | Authenticates the Copilot CLI inside the agentic workflow container |
| `SUGGESTIONS_GITHUB_TOKEN` | Azure App Service env | `suggest.js`, `mcp.js` | PAT to create GitHub issues from player suggestions (falls back to `COPILOT_TOKEN`) |
| `PLAYER1_API_KEY` | Azure App Service env | `mcp.js`, `suggest.js`, `turn.js` | Authenticates Player 1 MCP calls |
| `PLAYER2_API_KEY` | Azure App Service env | `mcp.js`, `suggest.js`, `turn.js` | Authenticates Player 2 MCP calls |
| `AZURE_WEBAPP_PUBLISH_PROFILE` | `sandcastle-game` repo (Actions secret) | `deploy-api.yml` | Azure deployment credential |
| `COSMOS_ENDPOINT` | Azure App Service env | `cosmos.js`, `god.js` | Azure Cosmos DB endpoint URL (optional — falls back to in-memory store) |
| `COSMOS_KEY` | Azure App Service env | `cosmos.js` | Azure Cosmos DB access key |
| `GH_AW_GITHUB_TOKEN` | `sandcastle-game` repo (Actions secret, optional) | `review-improvements.lock.yml` | PAT for the gh-aw MCP server GitHub tool calls (falls back to `GITHUB_TOKEN`) |
| `GH_AW_GITHUB_MCP_SERVER_TOKEN` | `sandcastle-game` repo (Actions secret, optional) | `review-improvements.lock.yml` | Override token for gh-aw GitHub MCP server (falls back to `GH_AW_GITHUB_TOKEN` then `GITHUB_TOKEN`) |
| `GITHUB_TOKEN` | Auto-injected by GitHub Actions | All workflows | Standard Actions token — read/write on the repo that owns the workflow |
| `TICK_CRON` | Azure App Service env | `scheduler.js` | Cron expression for the server-side tick scheduler (default: `0 * * * *`) |
| `ENABLE_SCHEDULER` | Azure App Service env | `scheduler.js` | Set to `false` to disable the server-side tick scheduler |
| `REVIEW_GAME_ISSUES_EVERY_N_TICKS` | Azure App Service env | `hooks.js` | How many ticks between auto-triggering the review-improvements hook (default: 10) |
| `PORT` | Azure App Service env (auto-set) | `server.js` | HTTP port the API listens on (default: 8080) |
| `PLAYER` | Azure App Service env | `mcp.js`, `turn.js`, `end-turn.js`, `move.js` | Which player this server instance represents (`player1` or `player2`) — only relevant if running player-side servers |

---

## Detail

### `TICK_ADMIN_KEY`
- **Type**: arbitrary secret string (generate with `openssl rand -hex 32`)
- **Set in**: Azure App Service → Configuration → Application settings
- **Also needed as**: repo secret in `sandcastle-game` only if using `game-tick.yml` manually
- **Used by**:
  - All admin API endpoints: `POST /tick`, `POST /god/tick`, `POST /god/trigger-hook`, `GET /debug/weather`, `POST /hooks/*`
  - God Mode UI (entered by the operator to unlock the panel)

---

### `COPILOT_TOKEN`
- **Type**: GitHub Fine-Grained PAT
- **Required scopes**: Actions (read/write), Contents (read/write), Issues (read/write), Pull Requests (read/write)
- **Resource owner**: your GitHub user account
- **Set in**: all 3 repos → Settings → Secrets → Actions
- **Used by**:
  - `sandcastle-game/improve.yml` — assigns `approved-for-work` issues to `copilot-swe-agent`
  - `sandcastle-player-one/player-turn.yml` — creates turn issues and assigns them to `copilot-swe-agent`
  - `sandcastle-player-two/player-turn.yml` — same
  - `sandcastle-player-one/player-improve.yml` — assigns `player-improvement` issues
  - `sandcastle-player-two/player-improve.yml` — same
  - `api/lib/hooks.js` — dispatches `player-turn.yml` workflows via GitHub API after each tick
  - `api/routes/suggest.js` — creates GitHub issues for player improvement suggestions (falls back to `SUGGESTIONS_GITHUB_TOKEN`)

> ⚠️ **Known limitation**: Fine-Grained PATs cannot have "Copilot Requests" permission for private repos — this is a GitHub platform restriction. This token is for workflow dispatch and issue management only, **not** for running the Copilot agent itself.

---

### `COPILOT_GITHUB_TOKEN`
- **Type**: GitHub Classic PAT (not fine-grained — see note below)
- **Required scopes**: `repo` is sufficient
- **Set in**: `sandcastle-game` repo → Settings → Secrets → Actions
- **Used by**: `review-improvements.lock.yml` (the `gh-aw` agentic workflow runner)
- **Purpose**: Authenticates the `copilot` CLI tool running inside the GitHub Actions agentic workflow container. This is what allows the Copilot coding agent to make LLM requests.

> ⚠️ **Must be a Classic PAT**, not a Fine-Grained PAT. GitHub's Fine-Grained PATs only expose the "Copilot Requests" permission when scoped to public repositories. For private repos, use a Classic PAT with `repo` scope — the Copilot subscription is validated via the token owner's account.

---

### `SUGGESTIONS_GITHUB_TOKEN`
- **Type**: GitHub Fine-Grained PAT (same permissions as `COPILOT_TOKEN`)
- **Set in**: Azure App Service → Configuration → Application settings
- **Used by**: `api/routes/suggest.js`, `api/routes/mcp.js`
- **Purpose**: Creates GitHub issues when players call `suggest_improvement` via MCP
- **Fallback chain**: `SUGGESTIONS_GITHUB_TOKEN` → `COPILOT_TOKEN` → `TICK_ADMIN_KEY` (last resort, likely to fail but won't crash)

> Can reuse the same PAT value as `COPILOT_TOKEN` — they are separate names for operational clarity.

---

### `PLAYER1_API_KEY` / `PLAYER2_API_KEY`
- **Type**: arbitrary secret strings
- **Set in**: Azure App Service → Configuration → Application settings
- **Used by**: `mcp.js`, `suggest.js`, `turn.js`, `end-turn.js`, `move.js`
- **Purpose**: Authenticate MCP calls from each player agent. Must match the `X-Api-Key` header sent by the player's MCP client.
- **Set in player repos**: stored in the player repo's MCP configuration (`.github/copilot-mcp.json` or similar) as the key passed to the MCP server

---

### `AZURE_WEBAPP_PUBLISH_PROFILE`
- **Type**: Azure publish profile XML (downloaded from Azure portal)
- **Set in**: `sandcastle-game` repo → Settings → Secrets → Actions
- **Used by**: `deploy-api.yml` (the Azure deployment workflow)
- **How to get**: Azure Portal → sandcastle-wars-api App Service → Overview → Download publish profile

---

### `COSMOS_ENDPOINT` / `COSMOS_KEY`
- **Type**: Azure Cosmos DB connection details
- **Set in**: Azure App Service → Configuration → Application settings
- **Used by**: `api/lib/cosmos.js`, `api/routes/god.js`
- **Purpose**: Persist game state to Azure Cosmos DB. If not set, the server falls back to in-memory storage (state lost on restart).

---

### `GH_AW_GITHUB_TOKEN` / `GH_AW_GITHUB_MCP_SERVER_TOKEN`
- **Type**: GitHub PAT (Fine-Grained or Classic)
- **Set in**: `sandcastle-game` repo → Settings → Secrets → Actions (both optional)
- **Used by**: `review-improvements.lock.yml` for the GitHub MCP server tool calls inside the agent
- **Fallback**: if not set, falls back to `GITHUB_TOKEN` (the standard Actions token). For most cases the default `GITHUB_TOKEN` is sufficient.
- **When to set explicitly**: if the agent needs to push to other repos, create PRs, or perform actions that require permissions beyond the `sandcastle-game` repo's `GITHUB_TOKEN`.

---

### `TICK_CRON` / `ENABLE_SCHEDULER`
- **Type**: plain strings
- **Set in**: Azure App Service → Configuration → Application settings
- **Defaults**: `TICK_CRON=0 * * * *` (hourly), `ENABLE_SCHEDULER=true`
- **Purpose**: Control the server-side tick scheduler without redeploying

---

### `REVIEW_GAME_ISSUES_EVERY_N_TICKS`
- **Type**: integer string
- **Set in**: Azure App Service → Configuration → Application settings
- **Default**: `10`
- **Purpose**: After every N ticks, the server automatically fires the `review-improvements` hook to triage pending improvement suggestions

---

## Where each secret needs to be set

### Azure App Service (`sandcastle-wars-api`) — Application Settings
| Setting | Required |
|---|---|
| `TICK_ADMIN_KEY` | ✅ Required |
| `PLAYER1_API_KEY` | ✅ Required |
| `PLAYER2_API_KEY` | ✅ Required |
| `SUGGESTIONS_GITHUB_TOKEN` | ✅ Required (or reuse COPILOT_TOKEN value) |
| `COSMOS_ENDPOINT` | ⚡ Optional (in-memory fallback) |
| `COSMOS_KEY` | ⚡ Optional |
| `TICK_CRON` | ⚡ Optional (default: hourly) |
| `ENABLE_SCHEDULER` | ⚡ Optional (default: true) |
| `REVIEW_GAME_ISSUES_EVERY_N_TICKS` | ⚡ Optional (default: 10) |

### `sandcastle-game` repo → Settings → Secrets → Actions
| Secret | Required |
|---|---|
| `COPILOT_TOKEN` | ✅ Required |
| `COPILOT_GITHUB_TOKEN` | ✅ Required (Classic PAT) |
| `AZURE_WEBAPP_PUBLISH_PROFILE` | ✅ Required |
| `GH_AW_GITHUB_TOKEN` | ⚡ Optional |
| `GH_AW_GITHUB_MCP_SERVER_TOKEN` | ⚡ Optional |

### `sandcastle-player-one` repo → Settings → Secrets → Actions
| Secret | Required |
|---|---|
| `COPILOT_TOKEN` | ✅ Required |

### `sandcastle-player-two` repo → Settings → Secrets → Actions
| Secret | Required |
|---|---|
| `COPILOT_TOKEN` | ✅ Required |
