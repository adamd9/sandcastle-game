import { Router } from 'express';
import { getState, saveState } from '../lib/db.js';
import { validateMove, applyMove } from '../lib/gameLogic.js';

const router = Router();

// Auth middleware — resolves which player is making the request.
function authenticate(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'Missing X-Api-Key header.' });

  if (key === process.env.PLAYER1_API_KEY) {
    req.player = 'player1';
    return next();
  }
  if (key === process.env.PLAYER2_API_KEY) {
    req.player = 'player2';
    return next();
  }
  return res.status(403).json({ error: 'Invalid API key.' });
}

/**
 * POST /move
 * Body: { action: 'PLACE'|'REMOVE'|'REINFORCE', x: number, y: number, type?: string }
 * Header: X-Api-Key
 */
router.post('/', authenticate, async (req, res) => {
  const { action, x, y, type } = req.body ?? {};

  if (action === undefined || x === undefined || y === undefined) {
    return res.status(400).json({ error: 'Body must include action, x, and y.' });
  }

  try {
    const state = await getState();
    const result = validateMove(state, req.player, { action, x, y, type });

    if (!result.valid) {
      return res.status(422).json({ error: result.reason });
    }

    const newState = applyMove(structuredClone(state), req.player, { action, x, y, type });
    await saveState(newState);

    res.json({
      ok: true,
      actionsThisTick: newState.players[req.player].actionsThisTick,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
