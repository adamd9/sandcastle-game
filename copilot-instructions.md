# SandCastle Wars — Copilot Instructions

This is the game server for **SandCastle Wars**, a turn-based 20×20 grid game where two AI agents build and defend sandcastles against hourly weather erosion.

## Project Structure

- `server.js` — Express server entry point
- `routes/` — REST API route handlers
- `lib/gameLogic.js` — Core game logic (tick processing, weather, history)
- `public/index.html` — Browser-based game UI
- `.github/workflows/` — GitHub Actions workflows
- `.github/aw/` — Additional workflow definitions

## Core Game Concepts

- The grid is 20×20. Player 1 owns columns 0–9, Player 2 owns columns 10–19.
- Each tick, weather applies damage to all blocks (rain + wind).
- Players submit up to 12 actions per tick: `PLACE`, `REMOVE`, `REINFORCE`.
- Block types: `packed_sand` (100 HP), `wet_sand` (60 HP), `dry_sand` (40 HP).
- Weather damage: `floor(rain_mm × 2)` per tick; windward-edge blocks take extra `floor(wind_speed_kph / 5)`.
- Blocks at 0 HP are destroyed permanently.

## Turn History & Weather Events

Each tick, a history entry is appended with the following shape:

```json
{
  "tick": 42,
  "weather": { "rain_mm": 3, "wind_speed_kph": 20, "wind_direction": "N" },
  "moves": {
    "player1": [{ "action": "PLACE", "x": 3, "y": 7, "block_type": "packed_sand" }],
    "player2": [{ "action": "REINFORCE", "x": 14, "y": 5 }]
  },
  "weatherEvents": [
    {
      "type": "damaged",
      "x": 3, "y": 7,
      "owner": "player1",
      "block_type": "packed_sand",
      "rain_damage": 6,
      "wind_damage": 4,
      "total_damage": 10,
      "health_before": 80,
      "health_after": 70
    },
    {
      "type": "destroyed",
      "x": 5, "y": 2,
      "owner": "player1",
      "block_type": "dry_sand",
      "rain_damage": 6,
      "wind_damage": 4,
      "total_damage": 10,
      "health_before": 8,
      "health_after": 0
    }
  ]
}
```

- `weatherEvents[].type` is `"damaged"` (HP reduced but block survives) or `"destroyed"` (block removed).
- History is trimmed to the last **20 entries** in memory.
- `GET /state` returns the last **10 history entries**.
- `GET /state/:player` returns the last **5 entries** as `recentHistory` from that player's perspective.

## REST API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/state` | Full game state + last 10 history entries |
| `GET` | `/state/:player` | Player-perspective state + `recentHistory` (last 5 ticks) |
| `POST` | `/turn/:player` | Submit moves for a player (API key required) |
| `GET` | `/rules` | Return current game rules/constraints |
| `POST` | `/suggest` | Submit a game improvement suggestion |

### Player-perspective state (`GET /state/:player`)

```json
{
  "current_state": {
    "tick": 42,
    "weather": { ... },
    "my_player": "player1",
    "my_actions_used": 5,
    "my_actions_remaining": 7,
    "my_turn_committed": false,
    "opponent_turn_committed": true,
    "my_blocks": [{ "x": 3, "y": 7, "block_type": "packed_sand", "health": 70 }],
    "opponent_blocks": [{ "x": 14, "y": 5, "block_type": "wet_sand", "health": 55 }]
  },
  "recentHistory": [ ... ]
}
```

## Player Suggestion System

Players (or their agents) can submit ideas for improving the game.

### MCP Tool

```
suggest_improvement(title, description)
```

- `title` — short summary of the suggestion
- `description` — detailed explanation of the proposed change, why it would improve the game

### REST Endpoint

```
POST /suggest
Authorization: Bearer <player-api-key>
Content-Type: application/json

{ "title": "...", "description": "..." }
```

### How it works

- Submissions create a GitHub issue in `adamd9/sandcastle-game` with the label `game-improvement`.
- Requires `SUGGESTIONS_GITHUB_TOKEN` environment variable on the server — a Personal Access Token with `repo` scope.
- Issues are created on behalf of the game server, not the individual player.

## Issue Review Workflow

A scheduled GitHub Actions workflow (`.github/workflows/review-improvements.yml` or `.github/aw/`) runs **daily at 09:00 UTC** to triage all open `game-improvement` issues.

### What it does

1. Fetches all open issues with the `game-improvement` label.
2. Reviews them holistically (considers game balance, feasibility, overlap).
3. For **approved** suggestions:
   - Adds the `approved-for-work` label
   - Assigns the `copilot-swe-agent` for implementation
4. For **rejected** suggestions:
   - Posts an explanatory comment with the reasoning
   - Closes the issue

### Labels

| Label | Meaning |
|-------|---------|
| `game-improvement` | Player-submitted suggestion (input) |
| `approved-for-work` | Approved and queued for implementation (output) |

## MCP Server

The MCP server is defined in `.github/agents/`. Tools exposed:

- `get_rules` — current game rules
- `get_state` — player-perspective state with `current_state` and `recent_history`
- `submit_turn` — submit an array of moves
- `suggest_improvement` — create a GitHub issue with a game suggestion

## Authentication

Player API keys are set via environment variables `PLAYER1_API_KEY` and `PLAYER2_API_KEY`. All mutating endpoints require `Authorization: Bearer <key>`.
