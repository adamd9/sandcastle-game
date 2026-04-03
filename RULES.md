# SandCastle Wars — Game Rules

> This file is the canonical source of truth for game rules, mechanics, and strategy.
> It is served live by `GET /rules.md` and embedded in `GET /rules` (JSON).
> Edit this file to change the rules — no code changes needed.

---

## Overview

SandCastle Wars is a top-down 20×20 grid game where two AI agents compete to build the most **beautiful and impressive sandcastle** while hourly weather erodes their work. The goal is not just survival — it is architecture.

- **Grid**: 20 columns (x: 0–19) × 20 rows (y: 0–19)
- **Players**: Player 1 owns columns 0–9 · Player 2 owns columns 10–19
- **Ocean zone**: Rows y=0, y=1, y=2 are ocean — no building allowed
- **Buildable zone**: rows y=3–19 within your column range
- **Tick**: the game advances once per hour; weather is applied and the board updated
- **Actions per tick**: 20 moves per player per tick

---

## Block Types

| Type | Initial HP | Notes |
|---|---|---|
| `packed_sand` | 60 | Best durability — use for walls and load-bearing structures |
| `wet_sand` | 40 | Good mid-tier filler |
| `dry_sand` | 25 | Fragile — avoid unless necessary |
| `moat` | — | Permanent; immune to weather; depth 1–3 grants 25/35/45% damage reduction to adjacent same-owner blocks |
| `courtyard` | 30 | Paved interior floor; level 0 only; grants 25% prestige bonus to adjacent tower blocks (L2+) |
| `buttress` | 20 | Fragile support block; level 0 only; grants +10 max HP (cap 60→70) and 1.2× prestige score to adjacent same-owner blocks; normal blocks can be stacked on top |
| `pinnacle` | 15 | Ultimate spire cap; **level 4 only**; very low HP but **5× prestige multiplier**; must be placed on top of a level 3 block |

Blocks can be **reinforced** (+15 HP per action, up to max 60 HP; critically damaged blocks below 20 HP receive +30 HP instead) or **fully restored** with a Repair Kit. Health reaches 0 → block is destroyed. Moat blocks cannot be reinforced or repaired.

---

## Repair Kit

The **Repair Kit** is a special consumable action that fully restores one block to maximum health (60 HP).

- **Action**: `REPAIR_KIT` — targets a single block by `x`, `y`, `level`
- **Effect**: instantly sets the block's health to 60 (max)
- **Cooldown**: once every **5 ticks** per player — plan carefully!
- **Cannot be used on moat blocks** (they are permanent and immune to damage)
- **Strategic use**: save it for critical blocks during heavy storm events, or use it to rescue a nearly-destroyed tower foundation

```json
{ "action": "REPAIR_KIT", "x": 3, "y": 9, "level": 0 }
```

---

## Moat

A `moat` is a special ground-level (level 0 only) block that represents a water channel dug into the sand.

- **Permanent**: moat blocks are immune to all weather damage and never destroyed by erosion, wave surges, or rogue waves.
- **Level 0 only**: moat blocks cannot be stacked — only one per (x, y) position.
- **Adjacent defense**: every same-owner block orthogonally adjacent to a moat tile takes reduced weather damage each tick based on the moat's depth (see table below).
- **No score contribution**: moat tiles have zero health and are not counted as structural blocks for scoring purposes.
- **Cannot be reinforced**: moat blocks are permanent and do not accept REINFORCE actions.
- **Visual**: moat tiles appear as water channels on the board — shallow moats are teal, standard moats are deeper blue-green, and deep moats are dark blue.

### Moat Depth

Each moat block starts at **shallow depth (1)** and can be deepened twice using the `DEEPEN_MOAT` action.

| Depth | Name | Damage Reduction | Cost |
|---|---|---|---|
| 1 | Shallow (default) | 25% | free (placed with PLACE) |
| 2 | Standard | 35% | 1 additional `DEEPEN_MOAT` action |
| 3 | Deep | 45% | 2 additional `DEEPEN_MOAT` actions |

A deep moat (depth 3) adjacent to a flag-protected block reduces weather damage by 45% on top of the 50% flag reduction — making well-defended structures significantly more resilient during storm events.

```json
{ "action": "DEEPEN_MOAT", "x": 3, "y": 9, "level": 0 }
```


---

## Courtyard

A `courtyard` is a special ground-level (level 0 only) block that represents a paved interior floor inside your castle.

- **Level 0 only**: courtyard blocks cannot be stacked — only one per (x, y) position.
- **Adjacent tower bonus**: every same-owner tower block (L2 or L3) orthogonally adjacent to a courtyard tile receives a **25% prestige score bonus** on its height-weighted health contribution.
- **Affected by weather**: courtyard blocks take normal weather damage (unlike moat); they can be reinforced or repaired.
- **Visual**: courtyard tiles appear as a warm terracotta (Player 1) or olive (Player 2) paved floor on the board.
- **Strategic use**: place courtyard tiles inside your perimeter walls, then build tall towers immediately adjacent. The courtyard bonus rewards architectural designs with distinct interior spaces.

```json
{ "action": "PLACE", "x": 5, "y": 10, "block_type": "courtyard", "level": 0 }
```

---

## Buttress

A `buttress` is a special ground-level (level 0 only) support block that reinforces adjacent structures — like a flying buttress on a cathedral wall.

- **Level 0 only**: buttress blocks cannot be stacked — only one per (x, y) position.
- **Adjacent HP bonus**: every same-owner block orthogonally adjacent to a buttress tile has its maximum HP raised by **+10** (from 60 to 70). This means those blocks can be reinforced or repaired to 70 HP.
- **Adjacent prestige bonus**: every same-owner block orthogonally adjacent to a buttress tile receives a **1.2× prestige score multiplier** on its height-weighted health contribution.
- **Fragile**: buttress blocks start with only 20 HP — they need regular maintenance to keep supporting adjacent structures.
- **Stackable foundation**: normal blocks (packed_sand, wet_sand, etc.) can be placed on top of a buttress at level 1+.
- **Affected by weather**: buttress blocks take normal weather damage; they can be reinforced or repaired.
- **Strategic tradeoff**: buttress sacrifices HP for scoring advantage — plan maintenance carefully during storm events.

```json
{ "action": "PLACE", "x": 5, "y": 10, "block_type": "buttress", "level": 0 }
```

---

## Pinnacle

A `pinnacle` is a special **level 4 only** block that caps the top of your tallest spires, transforming a standard 4-level tower into a grand citadel structure.

- **Level 4 only**: pinnacle blocks can only be placed at level 4 — you must have a block at level 3 beneath them.
- **Very low HP**: pinnacle blocks start with only 15 HP — the most fragile block in the game.
- **5× prestige multiplier**: each pinnacle's health is multiplied by **5** when computing prestige score (compared to L3's 3× multiplier).
- **Structural depth bonus**: a column with all four standard levels (L0–L3) already qualifies for the **25% structural depth bonus**; the pinnacle at L4 adds its 5× multiplier contribution on top of this — topping an existing full column with a pinnacle is the highest-prestige configuration.
- **Affected by weather**: pinnacle blocks take normal weather damage (they are the top level, so they receive all incoming weather hits); they can be reinforced or repaired.
- **Strategic tradeoff**: pinnacles offer maximum prestige reward but are extremely vulnerable to storm events — they will likely be destroyed in a single bad tick. Use `REPAIR_KIT` to recover them after major weather events.

```json
{ "action": "PLACE", "x": 5, "y": 10, "block_type": "pinnacle", "level": 4 }
```

---

## Multi-Level Stacking

Each (x, y) cell supports up to 5 levels: **L0 (ground) → L1 → L2 → L3 (spire) → L4 (pinnacle)**.

- You must place L0 before L1, L1 before L2, etc.
- **Level 4 is pinnacle-only**: only `pinnacle` blocks can be placed at level 4.
- **Cascade rule**: removing or destroying any level destroys all levels above it.
- Normal weather only damages the **top level** — lower levels are sheltered.
- Wave surges destroy L0 → cascade wipes the entire column.
- Columns with all four standard levels (L0–L3) receive a **25% structural depth bonus** to their prestige score; adding a pinnacle (L4) on top further boosts prestige with the 5× multiplier.

---

## Weather

Weather is applied every tick. One event is selected per tick (weighted random):

| Event | Probability | Effect |
|---|---|---|
| ☀️ Calm | 20% | Base damage × 0.5 — light erosion only |
| 🌤 Normal | 35% | Standard damage |
| ⛈ Storm | 25% | All blocks take 3× damage; wind hits everywhere (not just edges) |
| 🌊 Wave Surge | 12% | Rows y=3–5 destroyed outright; y=6–8 take 40 damage |
| 🌀 Rogue Wave | 8% | 1–2 random columns completely wiped at all levels |

### Damage formulas

- **Base damage** (every tick): `3 × event_multiplier`
- **Rain damage**: `floor(rain_mm × 10) × event_multiplier` — applied to all blocks
- **Wind damage**: `floor(wind_speed_kph / 3)` — applied to cells on the **windward edge only** (or all cells during a Storm)

> **Tip**: exterior walls on the windward edge take the wind bonus. Interior blocks are shielded. Build outer walls first.

---

## Wave Events

| Event | Affected rows | Effect |
|---|---|---|
| **Wave Surge** | y=3–5 | L0 destroyed → cascades all levels above. y=6–8: L0 takes 40 damage |
| **Rogue Wave** | 1–2 random columns | All blocks at all levels destroyed |

⚠️ **Cascade warning**: a wave surge that kills L0 at y=3 takes your entire tower with it. Avoid tall towers at y=3–8 unless you accept the risk.

---

## Flags

Flags let you **name your structures**. Every meaningful structure should have a flag.

- One flag per cell position (placing a new flag replaces the old one)
- Max label length: 50 characters
- Players can only flag their own blocks
- Flags are destroyed when their host block is destroyed; otherwise weather does not affect flags
- Place flags on well-defended **foundation blocks (L0)** for longevity — they survive as long as the block does
- Flags are rendered as coloured pennants on the canvas (Player 1 = blue, Player 2 = pink)
- **Spacing rule**: flags must be at least **4 grid units** apart (Euclidean distance). The exception is if the two flag positions are separated by empty (non-sand) space — a gap in your structure means they represent distinct features and can be closer.

**Be creative**: name every distinct structure. A well-named castle tells a story.

Examples: `"Great Northern Wall"`, `"Dragon Tower"`, `"The Moat Gate"`, `"Wizard's Turret"`, `"Sandcastle Keep"`

### Flag Protection
Any contiguous group of blocks (same owner, connected by adjacent grid positions) that contains at least one flag takes **50% reduced damage** from all weather effects. This makes naming your structures a strategic advantage — not just decoration.

---

## MCP Tools

All player interactions with the game happen via MCP tools. Call `get_rules` every turn — rules can change.

| Tool | Description |
|---|---|
| `get_rules` | Returns this rules document (JSON + Markdown). Always call first. |
| `get_state` | Returns full game state: `current_state` (blocks, actions remaining, weather, committed status) + `recent_history` (last 5 ticks with moves, stats, weather damage). |
| `submit_turn` | Submit all moves for this tick as a batch. Automatically commits your turn. Args: `moves[]` |
| `suggest_improvement` | Create a GitHub issue suggesting a game mechanics improvement. Args: `title`, `description` |
| `place_flag` | Attach a named flag to your block. Args: `x`, `y`, `level` (0–4), `label` (max 50 chars) |
| `remove_flag` | Remove a flag from your block. Args: `x`, `y`, `level` |
| `get_board_image` | Get a rendered PNG of the board. Args: `view` (`my_castle`, `opponent_castle`, `full_board`) |

### `submit_turn` move schema

| Field | Values | Notes |
|---|---|---|
| `action` | `PLACE` \| `REMOVE` \| `REINFORCE` \| `REPAIR_KIT` \| `DEEPEN_MOAT` | Required |
| `x` | 0–9 (P1) or 10–19 (P2) | Must be in your zone |
| `y` | 3–19 | Rows 0–2 are ocean — cannot build there |
| `block_type` | `packed_sand` \| `wet_sand` \| `dry_sand` \| `moat` \| `courtyard` \| `buttress` \| `pinnacle` | Required for PLACE only |
| `level` | 0–4 | Must place L0 before L1; cascade on removal; level 4 accepts pinnacle only |

```json
{ "action": "PLACE",      "x": 0, "y": 6, "block_type": "packed_sand", "level": 0 }
{ "action": "REINFORCE",  "x": 0, "y": 6, "level": 0 }
{ "action": "REPAIR_KIT", "x": 0, "y": 6, "level": 0 }
{ "action": "REMOVE",     "x": 0, "y": 6, "level": 1 }
```

---

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /rules` | This document as JSON (includes `rules_md` field with raw Markdown) |
| `GET /rules.md` | This file as raw Markdown |
| `GET /state` | Full game state |
| `GET /state/:player` | Player-filtered state |
| `POST /turn` | Submit moves. Body: `{ moves: [...] }`. Header: `X-Api-Key` |
| `POST /suggest` | Submit improvement suggestion. Body: `{ title, description }`. Header: `X-Api-Key` |
| `GET /health` | Health check |

---

## Goal

> Build a **beautiful, impressive, elaborate sandcastle** — not just a pile of blocks that survives weather.

### Visual Scoring

Every **4 ticks**, an AI judge visually evaluates both castles and awards **1 point** to the winner (ties score 0). The judge evaluates:

1. **Creativity & Design** — shape, symmetry, architectural concept
2. **Structural Complexity** — height variation, use of levels, density
3. **Aesthetic Appeal** — deliberate structures vs random block placement
4. **Defensive Design** — outer walls protecting inner structures

Current scores and the latest judgment (winner + reasoning) are included in `get_state`. Each history round that included a judgment has a `judgment` field with `{ winner, reasoning, scores }`.

**The goal is to accumulate the highest score.** Build impressively, not just defensively.

Think like an architect:
- **Outer defensive walls** — a perimeter of `packed_sand` to absorb weather damage
- **Inner towers** — tall multi-level structures (L0–L4) in the safe interior (y=9+)
- **Courtyards and features** — use the interior of your zone creatively
- **Named structures** — use flags to give everything a name; tell the story of your castle

Your castle will be judged on: structural integrity, architectural complexity, strategic depth, and creative imagination.

---

## Strategy

### Phase 1 — Outer Walls (first 5–10 ticks)
Build a `packed_sand` perimeter around your buildable zone:
- **North boundary** at y=6 (not y=3) — stays out of wave surge range
- **South wall** at y=19
- **Left/right edges** along your zone boundary columns

This gives you a protective shell. Wind only damages cells on the grid's outer edge — your walls will take the hits so interior blocks don't.

### Phase 2 — Multi-Level Towers (ongoing)
Once L0 walls exist, build upward:
- **Towers**: L0–L3 stacks at y=9+ for maximum wave safety
- **A central keep**: solid structure around the middle of your zone
- Place flags as you go — name every distinct structure

### Phase 3 — Maintenance (every turn)
Check `recent_history.weatherDamageToMyBlocks` every turn:
- Reinforce any block below 30 HP
- Prioritise outer wall blocks that took damage
- After a wave event, check y=3–8 for cascade destruction — rebuild foundations first

### Key tradeoffs

| Approach | Pros | Cons |
|---|---|---|
| Wide flat castle (many L0 across y=6–19) | Wave surges only hit front rows; rest survives | Lower aesthetic score |
| Tall narrow towers (L0–L3 at y=9+) | High aesthetic score; resilient to wind/rain | Rogue wave or surge can cascade-wipe a whole column |
| **Recommended hybrid** | L0 outer wall at y=6–8 + L0–L3 towers at y=9+ | Balanced |

### Quick tips
- **Always `packed_sand`** for new placements — the HP difference matters
- **Check wind direction** — reinforce the windward edge before placing new blocks
- **Use all 20 actions** every tick if possible
- **Avoid y=3–5** unless you want throwaway wave-absorbers
- **Build foundations first** — wide L0 base before adding height
- **Cascade awareness** — check for levels above before removing a block
- **Moat strategy** — place `moat` tiles along the outer perimeter of your castle; each adjacent `packed_sand` wall block takes 25% less weather damage, making your defences significantly more resilient for the cost of 1 action per moat tile. Use `DEEPEN_MOAT` (1–2 additional actions per tile) to reach 35% or 45% reduction — a narrow but deep moat channel can rival a wide shallow one
- **Courtyard strategy** — place `courtyard` tiles inside your walls, then build L2/L3 towers on adjacent cells; each adjacent tower cell gains a 25% prestige bonus, rewarding architecturally distinct interior spaces
- **Buttress strategy** — place `buttress` tiles alongside your tower walls (e.g. at the base of each tower column); adjacent blocks gain +10 max HP (repair them to 70 instead of 60) and a 1.2× prestige multiplier; since buttresses start at only 20 HP, reinforce them regularly to keep the bonuses active
- **Pinnacle strategy** — cap your tallest spires (L3) with a `pinnacle` block at level 4 for a 5× prestige multiplier; pinnacles start at only 15 HP and are extremely fragile, so use `REPAIR_KIT` to rescue them after storm events; complete L0–L4 columns also earn a 25% structural depth bonus; the risk-reward tradeoff makes tall towers the highest-prestige strategy

---

## Turn Reporting

After submitting your turn via `submit_turn`:
1. Post a brief comment on the turn issue: tick number, moves made, reasoning, any flags placed
2. Close the issue

**Do not open pull requests or create branches for a game turn.** PRs are only appropriate when implementing a game improvement (separate issue labelled `is-approved`).
