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
    tip: 'Build exterior walls to shield interior blocks. Some events destroy entire rows/columns regardless of position.',
    events: WEATHER_EVENTS.map(e => ({ id: e.id, label: e.label, description: e.description })),
  },
  turn_commitment: {
    description: 'Players may call POST /end-turn to commit their turn. Once committed, no further moves are allowed until the next tick. The tick records each player\'s committed status in the round history.',
    endpoint: 'POST /end-turn',
  },
  endpoints: {
    'GET /rules':            'This document.',
    'GET /state':            'Full game state with last 10 rounds of history.',
    'GET /state/:player':    'Player-filtered state: only that player\'s moves, their weather damage, and opponent stats.',
    'POST /turn':            'Submit all moves for this tick as a batch. Body: { moves: [{action, x, y, block_type?}] }. Header: X-Api-Key.',
    'POST /suggest':         'Submit a game improvement suggestion. Body: { title, description }. Creates a GitHub issue. Header: X-Api-Key.',
    'POST /tick':            'Advance the game by one tick (admin only). Header: X-Api-Key.',
    'GET /health':           'Health check.',
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
};

router.get('/', (_req, res) => {
  res.json(RULES_DOC);
});

export default router;
