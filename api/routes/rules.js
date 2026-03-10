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
    'GET /rules':    'This document.',
    'GET /state':    'Full game state including turn commitment status and round history.',
    'POST /move':    'Submit an action. Body: { action, x, y, type? }. Header: X-Api-Key.',
    'POST /end-turn':'Commit your turn for this tick. No further moves allowed until next tick. Header: X-Api-Key.',
    'POST /tick':    'Advance the game by one tick (admin only). Header: X-Api-Key.',
    'GET /health':   'Health check.',
  },
};

router.get('/', (_req, res) => {
  res.json(RULES_DOC);
});

export default router;
