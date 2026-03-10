import { Router } from 'express';
import { getState, saveState } from '../lib/db.js';
import { applyWeather, recordRound } from '../lib/gameLogic.js';
import { fetchWeather } from '../lib/weather.js';

const router = Router();

// Auth middleware — only the tick admin key may advance the game.
function authenticate(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'Missing X-Api-Key header.' });
  if (key !== process.env.TICK_ADMIN_KEY) {
    return res.status(403).json({ error: 'Invalid API key.' });
  }
  next();
}

/**
 * POST /tick
 * Fetches live weather, applies damage to all cells, increments tick counter,
 * and resets each player's actionsThisTick budget.
 * Header: X-Api-Key (TICK_ADMIN_KEY)
 */
router.post('/', authenticate, async (_req, res) => {
  try {
    let weather;
    try {
      weather = await fetchWeather();
    } catch (err) {
      // Weather fetch failed — use zero-damage weather so the tick still advances.
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

export default router;
