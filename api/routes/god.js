import { Router } from 'express';
import { getState, saveState } from '../lib/db.js';
import { validateMove, applyMove, applyWeather } from '../lib/gameLogic.js';
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
 * POST /god/tick
 * No auth — local dev only.
 */
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

    const newState = applyWeather(structuredClone(state));
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

export default router;
