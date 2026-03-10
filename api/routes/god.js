import { Router } from 'express';
import { getState, saveState } from '../lib/db.js';
import { validateMove, applyMove, applyWeather, validateCommit, commitTurn, recordRound } from '../lib/gameLogic.js';
import { fetchWeather } from '../lib/weather.js';

const router = Router();

// Block all routes in production (when COSMOS_ENDPOINT is set)
router.use((_req, res, next) => {
  if (process.env.COSMOS_ENDPOINT) {
    return res.status(403).json({ error: 'God Mode is disabled in production.' });
  }
  next();
});

/**
 * POST /god/move
 * Body: { player: "player1"|"player2", action: "PLACE"|"REMOVE"|"REINFORCE", x, y, type? }
 * No auth — local dev only.
 */
router.post('/move', async (req, res) => {
  const { player, action, x, y, type } = req.body ?? {};

  if (!player || !['player1', 'player2'].includes(player)) {
    return res.status(400).json({ error: 'player must be "player1" or "player2".' });
  }
  if (action === undefined || x === undefined || y === undefined) {
    return res.status(400).json({ error: 'Body must include action, x, and y.' });
  }

  try {
    const state = await getState();
    const result = validateMove(state, player, { action, x, y, type });

    if (!result.valid) {
      return res.status(422).json({ error: result.reason });
    }

    const newState = applyMove(structuredClone(state), player, { action, x, y, type });
    await saveState(newState);

    res.json({
      ok: true,
      actionsThisTick: newState.players[player].actionsThisTick,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /god/end-turn
 * Body: { player: "player1"|"player2" }
 * No auth — local dev only.
 */
router.post('/end-turn', async (req, res) => {
  const { player } = req.body ?? {};

  if (!player || !['player1', 'player2'].includes(player)) {
    return res.status(400).json({ error: 'player must be "player1" or "player2".' });
  }

  try {
    const state = await getState();
    const result = validateCommit(state, player);

    if (!result.valid) {
      return res.status(422).json({ error: result.reason });
    }

    const newState = commitTurn(structuredClone(state), player);
    await saveState(newState);

    res.json({ ok: true, player, turnCommitted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /god/turn
 * Body: { player: "player1"|"player2", moves: [{action, x, y, type?}] }
 * Applies all moves atomically and auto-commits. No auth — local dev only.
 */
router.post('/turn', async (req, res) => {
  const { player, moves } = req.body ?? {};

  if (!player || !['player1', 'player2'].includes(player)) {
    return res.status(400).json({ error: 'player must be "player1" or "player2".' });
  }
  if (!Array.isArray(moves) || moves.length === 0) {
    return res.status(400).json({ error: 'moves must be a non-empty array.' });
  }

  try {
    const state = await getState();

    // Validate all moves up-front
    for (let i = 0; i < moves.length; i++) {
      const { action, x, y, type } = moves[i];
      const result = validateMove(state, player, { action, x, y, type });
      if (!result.valid) {
        return res.status(422).json({ error: `Move ${i + 1}: ${result.reason}` });
      }
    }

    // Apply all then commit
    let newState = structuredClone(state);
    for (const { action, x, y, type } of moves) {
      newState = applyMove(newState, player, { action, x, y, type });
    }
    newState = commitTurn(newState, player);
    await saveState(newState);

    res.json({
      ok: true,
      applied: moves.length,
      actionsUsed: newState.players[player].actionsThisTick,
      turnCommitted: true,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.post('/tick', async (_req, res) => {
  try {
    let weather;
    try {
      weather = await fetchWeather();
    } catch (err) {
      console.error('Weather fetch failed, using fallback:', err.message);
      weather = { rain_mm: 0, wind_speed_kph: 0, wind_direction: 'N' };
    }

    const state = await getState();
    state.weather = weather;

    const withHistory = recordRound(structuredClone(state));
    const newState = applyWeather(withHistory);
    await saveState(newState);

    res.json({
      ok: true,
      tick: newState.tick,
      weather: newState.weather,
      cellsRemaining: newState.cells.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /god/erase
 * Body: { x, y }
 * Removes a cell from the grid without costing a game action.
 * No auth — local dev only.
 */
router.post('/erase', async (req, res) => {
  const { x, y } = req.body ?? {};

  if (x === undefined || y === undefined) {
    return res.status(400).json({ error: 'Body must include x and y.' });
  }

  try {
    const state = await getState();
    const clone = structuredClone(state);
    const idx = clone.cells.findIndex(c => c.x === x && c.y === y);

    if (idx === -1) {
      return res.status(422).json({ error: `No block at (${x},${y}).` });
    }

    clone.cells.splice(idx, 1);
    clone.lastUpdated = new Date().toISOString();
    await saveState(clone);

    res.json({ ok: true, removed: { x, y } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
