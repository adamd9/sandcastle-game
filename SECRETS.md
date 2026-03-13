# SandCastle Wars — Secrets, Tokens & Environment Variables

This document covers every secret, token, and environment variable used across the full solution.
Keep it up to date when adding new secrets or vars.

> ⚠️ Never commit actual secret values. This file documents **names, purposes, and how to generate them** only.
>
> 💡 **Token naming convention**: all GitHub PATs created for this project are prefixed `sandcastle-wars-` in GitHub's token settings (e.g. `sandcastle-wars-copilot-token`), making them easy to identify and rotate together.

---

## Summary table

| Name | Where set | Used by | Purpose |
|---|---|---|---|
| `TICK_ADMIN_KEY` | Azure App Service env + repo secret | API server, God Mode UI | Admin key for all protected API endpoints |
| `COPILOT_TOKEN` | All 3 repos (Actions secret) + Azure App Service env | `hooks.js`, `improve.yml`, `player-turn.yml` | Fine-Grained PAT to dispatch workflows + create GitHub issues |
| `COPILOT_GITHUB_TOKEN` | `sandcastle-game` repo (Actions secret) | `review-improvements.lock.yml` (gh-aw runner) | Fine-Grained PAT to authenticate the Copilot CLI inside the agentic workflow container |
| `SUGGESTIONS_GITHUB_TOKEN` | Azure App Service env | `suggest.js`, `mcp.js` | PAT to create GitHub issues from player suggestions (falls back to `COPILOT_TOKEN`) |
| `PLAYER1_API_KEY` | Azure App Service env | `mcp.js`, `suggest.js`, `turn.js` | Authenticates Player 1 MCP calls |
| `PLAYER2_API_KEY` | Azure App Service env | `mcp.js`, `suggest.js`, `turn.js` | Authenticates Player 2 MCP calls |
| `AZURE_WEBAPP_PUBLISH_PROFILE` | `sandcastle-game` repo (Actions secret) | `deploy-api.yml` | Azure deployment credential |
| `COSMOS_ENDPOINT` | Azure App Service env | `cosmos.js`, `god.js` | Azure Cosmos DB endpoint URL (optional — falls back to in-memory store) |
| `COSMOS_KEY` | Azure App Service env | `cosmos.js` | Azure Cosmos DB access key |
| `GH_AW_GITHUB_TOKEN` | `sandcastle-game` repo (Actions secret, optional) | `review-improvements.lock.yml` | PAT for gh-aw MCP GitHub tool calls (falls back to `GITHUB_TOKEN`) |
| `GH_AW_GITHUB_MCP_SERVER_TOKEN` | `sandcastle-game` repo (Actions secret, optional) | `review-improvements.lock.yml` | Override for gh-aw GitHub MCP server (falls back to `GH_AW_GITHUB_TOKEN` then `GITHUB_TOKEN`) |
| `GITHUB_TOKEN` | Auto-injected by GitHub Actions | All workflows | Standard Actions token — read/write on the workflow's own repo |
| `TICK_CRON` | Azure App Service env | `scheduler.js` | Cron expression for the server-side tick scheduler (default: `0 * * * *`) |
| `ENABLE_SCHEDULER` | Azure App Service env | `scheduler.js` | Set to `false` to disable the server-side tick scheduler |
| `REVIEW_GAME_ISSUES_EVERY_N_TICKS` | Azure App Service env | `hooks.js` | Ticks between auto-triggering the review-improvements hook (default: 10) |
| `PORT` | Azure App Service env (auto-set) | `server.js` | HTTP port the API listens on (default: 8080) |
| `PLAYER` | Azure App Service env | `mcp.js`, `turn.js`, `end-turn.js`, `move.js` | Which player this server instance represents (`player1` or `player2`) |

---

## Detail

### `TICK_ADMIN_KEY`
- **Type**: arbitrary secret string
- **How to generate**: `openssl rand -hex 32`
- **Set in**: Azure App Service → Configuration → Application settings
- **Used by**:
  - All admin API endpoints: `POST /tick`, `POST /god/tick`, `POST /god/trigger-hook`, `GET /debug/weather`, `POST /hooks/*`
  - God Mode UI (entered by the operator to unlock the panel)

---

### `COPILOT_TOKEN`
- **Type**: GitHub Fine-Grained PAT (`github_pat_...`)
- **How to generate**: GitHub → Settings → Developer Settings → Personal Access Tokens → Fine-grained tokens → Generate new token
  - Resource owner: your GitHub user account
  - Repository access: All repositories (or select the 3 sandcastle repos explicitly)
  - Repository permissions: Actions (read/write), Contents (read/write), Issues (read/write), Pull Requests (read/write)
  - Token name: `sandcastle-wars-copilot-token`
- **Set in**: all 3 repos → Settings → Secrets → Actions; also Azure App Service env (used by `hooks.js` server-side)
- **Used by**:
  - `sandcastle-game/improve.yml` — assigns `approved-for-work` issues to `copilot-swe-agent`
  - `sandcastle-player-one/player-turn.yml` — creates turn issues and assigns them to `copilot-swe-agent`
  - `sandcastle-player-two/player-turn.yml` — same
  - `sandcastle-player-one/player-improve.yml` — assigns `player-improvement` issues
  - `sandcastle-player-two/player-improve.yml` — same
  - `api/lib/hooks.js` — dispatches `player-turn.yml` workflows via GitHub API after each tick
  - `api/routes/suggest.js` — creates GitHub issues for player improvement suggestions

> ⚠️ This token is for workflow dispatch and issue management only — **not** for authenticating the Copilot agent itself (that's `COPILOT_GITHUB_TOKEN`).

---

### `COPILOT_GITHUB_TOKEN`
- **Type**: GitHub Fine-Grained PAT (`github_pat_...`) — Classic PATs (`ghp_...`) are explicitly rejected by the gh-aw runner
- **How to generate**: GitHub → Settings → Developer Settings → Personal Access Tokens → Fine-grained tokens → Generate new token
  - Resource owner: your personal GitHub account
  - Repository access: **"Public repositories"** ← required to unlock the Copilot Requests permission
  - Account permissions: **Copilot Requests: Read-only**
  - Token name: `sandcastle-wars-copilot-github-token`
- **Set in**: `sandcastle-game` repo → Settings → Secrets → Actions
- **Used by**: `review-improvements.lock.yml` (the `gh-aw` agentic workflow runner)
- **Purpose**: Authenticates the `copilot` CLI inside the GitHub Actions agentic container. This token is for Copilot API access only — actual repo read/write uses `GITHUB_TOKEN` separately.

> ℹ️ "Public repositories" scope doesn't restrict the agent to public repos — it's just the UI quirk that unlocks "Copilot Requests" in the permissions list. The agent's actual repo access comes from `GITHUB_TOKEN` / `GH_AW_GITHUB_TOKEN`.

---

### `SUGGESTIONS_GITHUB_TOKEN`
- **Type**: GitHub Fine-Grained PAT — same permissions as `COPILOT_TOKEN`
- **How to generate**: same process as `COPILOT_TOKEN` above; or reuse the same PAT value for simplicity
  - Token name: `sandcastle-wars-suggestions-token` (or just reuse `sandcastle-wars-copilot-token`)
- **Set in**: Azure App Service → Configuration → Application settings
- **Used by**: `api/routes/suggest.js`, `api/routes/mcp.js`
- **Purpose**: Creates GitHub issues when players call `suggest_improvement` via MCP
- **Fallback chain**: `SUGGESTIONS_GITHUB_TOKEN` → `COPILOT_TOKEN` → `TICK_ADMIN_KEY` (last resort)

---

### `PLAYER1_API_KEY` / `PLAYER2_API_KEY`
- **Type**: arbitrary secret strings
- **How to generate**: `openssl rand -hex 24` (one per player)
- **Set in**: Azure App Service → Configuration → Application settings
- **Also set in**: each player repo's MCP server config (`.github/mcp/sandcastle-game.json` or similar) as the `X-Api-Key` header value sent with every MCP call
- **Used by**: `mcp.js`, `suggest.js`, `turn.js`, `end-turn.js`, `move.js` — identifies which player is making each request

---

### `AZURE_WEBAPP_PUBLISH_PROFILE`
- **Type**: Azure publish profile XML blob
- **How to generate**: Azure Portal → App Services → `sandcastle-wars-api` → Overview → **Download publish profile** button → copy the full XML content
- **Set in**: `sandcastle-game` repo → Settings → Secrets → Actions
- **Used by**: `deploy-api.yml` — the CD workflow that deploys to Azure on every push to main
- **Rotation**: re-download from Azure portal whenever it expires or is reset

---

### `COSMOS_ENDPOINT` / `COSMOS_KEY`
- **Type**: Azure Cosmos DB connection string values
- **How to get**: Azure Portal → Cosmos DB account → Keys → URI (endpoint) and PRIMARY KEY
- **Set in**: Azure App Service → Configuration → Application settings
- **Used by**: `api/lib/cosmos.js`, `api/routes/god.js`
- **Purpose**: Persist game state across server restarts. If not set, falls back to in-memory storage (state lost on restart).

---

### `GH_AW_GITHUB_TOKEN` / `GH_AW_GITHUB_MCP_SERVER_TOKEN`
- **Type**: GitHub PAT (Fine-Grained or Classic, depending on required access)
- **How to generate**: same process as `COPILOT_TOKEN`; grant whatever repo permissions the agent needs across repos
- **Set in**: `sandcastle-game` repo → Settings → Secrets → Actions (both optional)
- **Used by**: `review-improvements.lock.yml` for the GitHub MCP server tool calls inside the agent
- **Fallback**: if not set, both fall back to `GITHUB_TOKEN` (the standard Actions token) — sufficient for most cases
- **When to set explicitly**: if the agent needs to access, push to, or create PRs on other repos beyond `sandcastle-game`

---

### `TICK_CRON` / `ENABLE_SCHEDULER`
- **Type**: plain strings
- **How to set**: Azure App Service → Configuration → Application settings
- **Defaults**: `TICK_CRON=0 * * * *` (top of every hour), `ENABLE_SCHEDULER=true`
- **Purpose**: Control the server-side tick scheduler without redeploying. Set `ENABLE_SCHEDULER=false` to pause the game.

---

### `REVIEW_GAME_ISSUES_EVERY_N_TICKS`
- **Type**: integer string
- **How to set**: Azure App Service → Configuration → Application settings
- **Default**: `10`
- **Purpose**: After every N ticks, the server automatically fires the `review-improvements` hook to triage pending improvement suggestions via the agentic workflow

---

## Where each secret needs to be set

### Azure App Service (`sandcastle-wars-api`) — Application Settings
| Setting | Required | Notes |
|---|---|---|
| `TICK_ADMIN_KEY` | ✅ Required | |
| `COPILOT_TOKEN` | ✅ Required | Same PAT as the repo secret |
| `PLAYER1_API_KEY` | ✅ Required | |
| `PLAYER2_API_KEY` | ✅ Required | |
| `SUGGESTIONS_GITHUB_TOKEN` | ✅ Required | Can reuse `COPILOT_TOKEN` value |
| `COSMOS_ENDPOINT` | ⚡ Optional | In-memory fallback if not set |
| `COSMOS_KEY` | ⚡ Optional | |
| `TICK_CRON` | ⚡ Optional | Default: `0 * * * *` |
| `ENABLE_SCHEDULER` | ⚡ Optional | Default: `true` |
| `REVIEW_GAME_ISSUES_EVERY_N_TICKS` | ⚡ Optional | Default: `10` |

### `sandcastle-game` repo → Settings → Secrets → Actions
| Secret | Required | Notes |
|---|---|---|
| `COPILOT_TOKEN` | ✅ Required | Fine-Grained PAT |
| `COPILOT_GITHUB_TOKEN` | ✅ Required | Fine-Grained PAT, "Public repositories" scope + Copilot Requests |
| `AZURE_WEBAPP_PUBLISH_PROFILE` | ✅ Required | XML from Azure portal |
| `GH_AW_GITHUB_TOKEN` | ⚡ Optional | Falls back to `GITHUB_TOKEN` |
| `GH_AW_GITHUB_MCP_SERVER_TOKEN` | ⚡ Optional | Falls back to `GH_AW_GITHUB_TOKEN` |

### `sandcastle-player-one` repo → Settings → Secrets → Actions
| Secret | Required | Notes |
|---|---|---|
| `COPILOT_TOKEN` | ✅ Required | Same Fine-Grained PAT as game repo |

### `sandcastle-player-two` repo → Settings → Secrets → Actions
| Secret | Required | Notes |
|---|---|---|
| `COPILOT_TOKEN` | ✅ Required | Same Fine-Grained PAT as game repo |
