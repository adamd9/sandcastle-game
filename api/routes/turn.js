import { Router } from 'express';
import { getState, saveState } from '../lib/db.js';
import { validateMove, applyMove, commitTurn } from '../lib/gameLogic.js';
import { ACTIONS_PER_TICK } from '../lib/rules.js';

const router = Router();

function authenticate(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'Missing X-Api-Key header.' });
  if (key === process.env.PLAYER1_API_KEY) { req.player = 'player1'; return next(); }
  if (key === process.env.PLAYER2_API_KEY) { req.player = 'player2'; return next(); }
  return res.status(403).json({ error: 'Invalid API key.' });
}

/**
 * POST /turn
 * Submit all moves for this tick in one call. Auto-commits turn on completion.
 * Valid moves are applied; invalid moves are skipped and logged (non-atomic / partial execution).
 * Body: { moves: [{ action, x, y, block_type? }] }
 * Header: X-Api-Key
 * Response includes a per-move `results` array with status 'applied' or 'skipped'.
 */
router.post('/', authenticate, async (req, res) => {
  const { moves } = req.body ?? {};

  if (!Array.isArray(moves) || moves.length === 0) {
    return res.status(400).json({ error: 'Body must include a non-empty moves array.' });
  }
  if (moves.length > ACTIONS_PER_TICK) {
    return res.status(400).json({ error: `Cannot submit more than ${ACTIONS_PER_TICK} moves per tick.` });
  }

  try {
    let state = await getState();

    if (state.players[req.player].turnCommitted) {
      return res.status(422).json({ error: 'Turn already committed this tick.' });
    }

    // Apply valid moves; skip and log invalid ones (partial / non-atomic execution)
    let newState = structuredClone(state);
    const results = [];
    for (let i = 0; i < moves.length; i++) {
      const { action, x, y, block_type } = moves[i];
      const result = validateMove(newState, req.player, { action, x, y, type: block_type });
      if (!result.valid) {
        results.push({ index: i, action, x, y, status: 'skipped', reason: result.reason });
      } else {
        newState = applyMove(newState, req.player, { action, x, y, type: block_type });
        results.push({ index: i, action, x, y, status: 'applied' });
      }
    }

    // Auto-commit the turn
    newState = commitTurn(newState, req.player);
    await saveState(newState);

    res.json({
      ok: true,
      applied: results.filter(r => r.status === 'applied').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      actionsUsed: newState.players[req.player].actionsThisTick,
      turnCommitted: true,
      results,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
