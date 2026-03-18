# SandCastle Wars — DB Schema & Stability Contract

> **⚠️ IMPORTANT — READ BEFORE MODIFYING STATE STRUCTURE**
>
> This game is an experiment with long-running history. All tick history is retained indefinitely.
> The state schema — especially the `history` array — **must remain backwards-compatible**.
> Never rename, remove, or change the type of an existing field. Only add new optional fields.
> Breaking changes require a migration that back-fills all existing history records.

---

## Top-Level State Object

```json
{
  "tick": 127,
  "weather": { "rain_mm": 2.1, "wind_speed_kph": 18, "wind_direction": "NW" },
  "cells": [ /* array of Cell */ ],
  "flags": [ /* array of Flag */ ],
  "players": {
    "player1": { "actionsThisTick": 18, "turnCommitted": true },
    "player2": { "actionsThisTick": 20, "turnCommitted": true }
  },
  "scores": { "player1": 3, "player2": 2 },
  "judgments": [ /* array of Judgment (trimmed to MAX_JUDGMENTS_HISTORY) */ ],
  "history": [ /* array of RoundRecord — NEVER TRIMMED */ ],
  "currentTurnMoves": { "player1": [], "player2": [] },
  "lastUpdated": "2026-03-18T20:00:00.000Z"
}
```

---

## Cell

```json
{ "x": 5, "y": 10, "level": 2, "type": "sand", "health": 80, "owner": "player1" }
```

| Field    | Type   | Stable | Notes                        |
|----------|--------|--------|------------------------------|
| `x`      | int    | ✅     | grid column (0-based)        |
| `y`      | int    | ✅     | grid row (0-based)           |
| `level`  | int    | ✅     | vertical layer (0 = ground)  |
| `type`   | string | ✅     | block type key               |
| `health` | int    | ✅     | 0–100                        |
| `owner`  | string | ✅     | `"player1"` or `"player2"`  |

---

## Flag

```json
{ "x": 7, "y": 12, "owner": "player1", "label": "Tower A" }
```

| Field   | Type   | Stable | Notes                       |
|---------|--------|--------|-----------------------------|
| `x`     | int    | ✅     |                             |
| `y`     | int    | ✅     |                             |
| `owner` | string | ✅     | `"player1"` or `"player2"` |
| `label` | string | ✅     | player-defined name         |

---

## RoundRecord (history entry)

> **Stability guarantee**: fields in this record are written once at tick time and never mutated.
> New optional fields may be added. Existing fields must not be renamed or removed.

```json
{
  "tick": 124,
  "timestamp": "2026-03-18T19:00:00.000Z",
  "weather": { "rain_mm": 1.0, "wind_speed_kph": 12, "wind_direction": "S", "event_name": "Rain", "event_emoji": "🌧" },
  "moves": {
    "player1": [ /* array of move objects */ ],
    "player2": [ /* array of move objects */ ]
  },
  "player1": {
    "actions": 20,
    "committed": true,
    "blocks": 48,
    "blocks_after": 44
  },
  "player2": {
    "actions": 18,
    "committed": true,
    "blocks": 61,
    "blocks_after": 58
  },
  "weatherEvents": [ /* array of WeatherEvent */ ],
  "cells": [ /* Cell[] snapshot BEFORE weather */ ],
  "cells_after_weather": [ /* Cell[] snapshot AFTER weather */ ],
  "flags_snapshot": [ /* Flag[] at the time of this tick */ ],
  "judgment": { /* Judgment | null — present only on judged ticks */ }
}
```

| Field                 | Type        | Stable | Notes                                              |
|-----------------------|-------------|--------|----------------------------------------------------|
| `tick`                | int         | ✅     | tick number at time of record                      |
| `timestamp`           | ISO string  | ✅     |                                                    |
| `weather`             | object      | ✅     | raw weather + resolved event fields                |
| `moves`               | object      | ✅     | `{ player1: Move[], player2: Move[] }`            |
| `player1`             | object      | ✅     | stats for p1; `blocks_after` added later in tick  |
| `player2`             | object      | ✅     | stats for p2; `blocks_after` added later in tick  |
| `weatherEvents`       | array       | ✅     | individual damage events                           |
| `cells`               | Cell[]      | ✅     | board state **before** weather                    |
| `cells_after_weather` | Cell[]      | ✅     | board state **after** weather                     |
| `flags_snapshot`      | Flag[]      | ✅     | flags at tick time                                 |
| `judgment`            | Judgment?   | ✅     | only present on `tick % JUDGE_INTERVAL === 0`     |

---

## Judgment

```json
{
  "tick": 124,
  "winner": "player1",
  "reasoning": "...",
  "p1_feedback": "...",
  "p2_feedback": "...",
  "scores": { "player1": 3, "player2": 2 }
}
```

| Field        | Type   | Stable | Notes                              |
|--------------|--------|--------|------------------------------------|
| `tick`       | int    | ✅     |                                    |
| `winner`     | string | ✅     | `"player1"`, `"player2"`, `"tie"` |
| `reasoning`  | string | ✅     | judge rationale (capped at 1500c)  |
| `p1_feedback`| string | ✅     | per-player feedback                |
| `p2_feedback`| string | ✅     | per-player feedback                |
| `scores`     | object | ✅     | cumulative at time of judgment     |

---

## History Retention Policy

- **All history is retained indefinitely** — `recordRound()` does not cap the array.
- The `/state/history` endpoint returns the **last 20 by default**; use `?limit=N` for more, or `?limit=0` for all.
- The `/:player/history` MCP endpoint returns the last 10 (sufficient for agent turn context).
- The top-level `judgments` array is trimmed to `MAX_JUDGMENTS_HISTORY` (separate from history).

---

## Adding New Fields

✅ Safe: add a new optional field to `RoundRecord` — old records simply won't have it.  
✅ Safe: add a new optional field to `Cell`, `Flag`, or `Judgment`.  
❌ Unsafe: rename an existing field — breaks replay of old records.  
❌ Unsafe: change the type of an existing field.  
❌ Unsafe: remove a field — breaks any consumer that depends on it.  
⚠️  Requires migration: changing the semantics of an existing field.
