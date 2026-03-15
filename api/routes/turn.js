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
 * Body: { moves: [{ action, x, y, block_type? }] }
 * Header: X-Api-Key
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

    // Validate and apply moves sequentially so each move sees the updated state
    // from all previous moves in the batch (enables stacking multiple levels in one turn).
    let newState = structuredClone(state);
    for (let i = 0; i < moves.length; i++) {
      const { action, x, y, block_type, level } = moves[i];
      const result = validateMove(newState, req.player, { action, x, y, type: block_type, level });
      if (!result.valid) {
        return res.status(422).json({ error: `Move ${i + 1} rejected: ${result.reason}` });
      }
      newState = applyMove(newState, req.player, { action, x, y, type: block_type, level });
    }

    // Auto-commit the turn
    newState = commitTurn(newState, req.player);
    await saveState(newState);

    res.json({
      ok: true,
      applied: moves.length,
      actionsUsed: newState.players[req.player].actionsThisTick,
      turnCommitted: true,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
