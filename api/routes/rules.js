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
