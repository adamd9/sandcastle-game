import { Router } from 'express';
import {
  GRID_WIDTH,
  GRID_HEIGHT,
  ZONES,
  ACTIONS_PER_TICK,
  BLOCK_TYPES,
  VALID_ACTIONS,
  REINFORCE_AMOUNT,
  MAX_HEALTH,
  WATER_ROWS,
  MAX_LEVEL,
  WEATHER_EVENTS,
} from '../lib/rules.js';

const router = Router();

const RULES_DOC = {
  grid: { width: GRID_WIDTH, height: GRID_HEIGHT },
  zones: ZONES,
  actions_per_tick: ACTIONS_PER_TICK,
  block_types: BLOCK_TYPES,
  valid_actions: VALID_ACTIONS,
  reinforce_amount: REINFORCE_AMOUNT,
  max_health: MAX_HEALTH,
  weather_effects: {
    base_damage: 'Every cell takes at least 5 damage per tick (scaled by event multiplier).',
    rain: 'Additional floor(rain_mm * 10) damage per tick, multiplied by event.',
    wind: 'Edge cells take floor(wind_speed_kph / 3) extra damage. During storms, ALL cells take wind damage.',
    tip: 'Build exterior walls to shield interior blocks. Some events destroy entire rows/columns regardless of position. Avoid building in the water zone (y=0–2) — it is ocean.',
    events: WEATHER_EVENTS.map(e => ({ id: e.id, label: e.label, description: e.description })),
  },
  water_zone: {
    rows: `y=0 to y=${WATER_ROWS - 1}`,
    description: 'Ocean — no building. Wave events surge from here.',
  },
  levels: {
    max_level: MAX_LEVEL,
    description: 'Each (x,y) cell can stack up to 4 blocks (levels 0–3). Must place L0 before L1. Removing a level destroys all levels above (cascade).',
    weather_interaction: 'Normal/storm damage hits only the TOP level. Wave surge destroys L0 in affected rows → cascades all levels above.',
  },
  turn_commitment: {
    description: 'Players may call POST /end-turn to commit their turn. Once committed, no further moves are allowed until the next tick. The tick records each player\'s committed status in the round history.',
    endpoint: 'POST /end-turn',
  },
  endpoints: {
    'GET /rules':                'This document.',
    'GET /state':                'Full game state with last 10 rounds of history.',
    'GET /state/:player':        'Player-filtered state: only that player\'s moves, their weather damage, and opponent stats.',
    'POST /turn':                'Submit all moves for this tick as a batch. Body: { moves: [{action, x, y, block_type?}] }. Header: X-Api-Key.',
    'POST /suggest':             'Submit a game improvement suggestion. Body: { title, description }. Creates a GitHub issue. Header: X-Api-Key.',
    'POST /tick':                'Advance the game by one tick (admin only). Header: X-Api-Key.',
    'GET /health':               'Health check.',
    'GET /god/scheduler-status': 'Returns server-side scheduler state: { running, nextTick, lastTickAt, cronExpr }. No auth required.',
    'POST /god/tick':            'Fire a tick with optional weather mode and god edits (admin only). Body: { weather_mode?, god_edits?: [{action, x, y, level, type?, label?}] }. god_edits actions: PLACE, REMOVE, ERASE, PLACE_FLAG, REMOVE_FLAG. Committed atomically with weather + player notifications. Header: X-Api-Key (TICK_ADMIN_KEY).',
    'POST /god/trigger-hook':    'Manually fire a post-tick hook. Body: { hook: "notify-players"|"notify-player1"|"notify-player2"|"review-improvements" }. Header: X-Api-Key (TICK_ADMIN_KEY).',
  },
  flags: {
    description: 'Flags label named structures on the board with a short text pennant. One flag per cell. Max label: 50 chars. Players can only flag their own blocks. Flags are destroyed when their host block is destroyed; otherwise unaffected by weather.',
    rendering: 'Rendered as colored pennants on the canvas: Player 1 = blue, Player 2 = pink, God-placed = gold.',
    mcp_tools: {
      place_flag: 'Attach a named flag to one of your blocks. Args: x (int), y (int), level (int 0-3), label (string, max 50 chars).',
      remove_flag: 'Remove a flag from one of your blocks. Args: x (int), y (int), level (int 0-3).',
    },
    state_field: 'state.flags[] — array of { x, y, level, owner, label } objects.',
  },
  goal: {
    statement: 'Your goal is to build a beautiful, impressive, elaborate sandcastle — not just survive weather. Think outer defensive walls, inner towers, courtyards, ramparts. Aim for a castle that would look impressive from above. Function AND aesthetics matter.',
    scoring_hint: 'While there is no formal scoring yet, your castle will be judged on: (1) structural integrity under weather — does it survive? (2) architectural complexity — is it more than a flat block? (3) strategic depth — have you protected your inner blocks with outer walls?',
  },
  strategy_hints: {
    outer_walls: 'Build your outer perimeter first using packed_sand (highest HP). Outer walls on the windward edge take wind bonus damage — reinforce them frequently.',
    inner_structures: 'Once walls are up, use inner cells for towers and internal features using wet_sand or packed_sand.',
    wind_protection: 'Wind only damages cells on the grid edge facing the wind direction. Interior blocks are shielded. Outer walls act as sacrificial protection.',
    zone: 'Your zone is columns {x_min} to {x_max}, rows 0 to 19. You have 200 cells to work with.',
    recommended_pattern: 'Consider: outer ring of packed_sand walls (rows 0,19 and your zone boundary columns), then inner structures. A thick outer wall absorbs weather while your castle grows inside.',
  },
  history_format: {
    description: 'state.history contains up to 20 rounds. Each round has:',
    fields: {
      tick: 'Tick number when this round was recorded',
      weather: '{ rain_mm, wind_speed_kph, wind_direction }',
      moves: '{ player1: [{action, x, y, block_type}], player2: [...] } — moves made that tick',
      player1: '{ actions, committed, blocks } — player1 summary for the round',
      player2: '{ actions, committed, blocks } — player2 summary for the round',
      weatherEvents: 'Array of damage events: [{ type: "damaged"|"destroyed", x, y, owner, block_type, rain_damage, wind_damage, total_damage, health_before, health_after }]',
    },
  },
  mcp_tools: {
    description: 'MCP tools available to player agents via the sandcastle-game MCP server.',
    tools: {
      get_rules: 'Returns this rules document. Call every turn — rules can change. Args: none.',
      get_state: 'Returns full game state. Args: none. Key fields: current_state.my_blocks, current_state.my_actions_remaining, current_state.weather, current_state.my_turn_committed, recent_history[] (last 5 ticks with myMoves, opponentMoves, weatherDamageToMyBlocks, myStats, opponentStats).',
      submit_turn: 'Submit all moves for this tick as a single batch. Automatically commits your turn when called. Args: moves[] — array of move objects. Returns { ok, applied, actionsUsed, turnCommitted }.',
      suggest_improvement: 'Submit a game improvement suggestion that creates a GitHub issue for review. Args: title (string), description (string). Use this if you spot a mechanic that could be improved.',
      place_flag: 'Attach a named flag to one of your blocks. Args: x (int), y (int), level (int 0–3), label (string, max 50 chars). Flags survive weather but are destroyed if their host block is destroyed.',
      remove_flag: 'Remove a flag from one of your blocks. Args: x (int), y (int), level (int 0–3).',
    },
    submit_turn_move_schema: {
      action: 'PLACE | REMOVE | REINFORCE',
      x: 'integer — must be within your zone',
      y: 'integer — must be 3–19 (rows 0–2 are ocean)',
      block_type: 'packed_sand | wet_sand | dry_sand — required for PLACE only',
      level: 'integer 0–3 — stack level. Must place L0 before L1, L1 before L2, etc. Removing a level cascades and destroys all levels above.',
    },
    examples: [
      '{ "action": "PLACE",     "x": 0, "y": 6, "block_type": "packed_sand", "level": 0 }',
      '{ "action": "REINFORCE", "x": 0, "y": 6, "level": 0 }',
      '{ "action": "REMOVE",    "x": 0, "y": 6, "level": 1 }',
    ],
  },
  turn_reporting: {
    description: 'After submitting your turn, post a comment on the turn issue summarising what you did, then close the issue.',
    suggested_format: 'Brief summary: how many moves, what you built/reinforced/removed, current block count, any weather concerns noted, and any flags placed or renamed.',
    no_prs: 'Game turns are NOT code changes. Do not open pull requests or create branches for a game turn. The only time a PR is appropriate is when implementing a game improvement (assigned via a separate issue labelled in-progress).',
  },
};

router.get('/', (_req, res) => {
  res.json(RULES_DOC);
});

export default router;
