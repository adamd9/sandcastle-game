import { Router } from 'express';
import { getState, saveState } from '../lib/db.js';
import { validateCommit, commitTurn } from '../lib/gameLogic.js';

const router = Router();

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
 * POST /end-turn
 * Commits the current player's turn for this tick.
 * Header: X-Api-Key
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const state = await getState();
    const result = validateCommit(state, req.player);

    if (!result.valid) {
      return res.status(422).json({ error: result.reason });
    }

    const newState = commitTurn(structuredClone(state), req.player);
    await saveState(newState);

    res.json({
      ok: true,
      player: req.player,
      turnCommitted: true,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
