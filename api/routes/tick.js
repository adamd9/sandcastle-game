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

    // Merge weather events, post-weather cell snapshot, and event label into the history entry
    if (newState.history && newState.history.length > 0) {
      const lastEntry = newState.history[newState.history.length - 1];
      lastEntry.weatherEvents = newState.weatherEvents || [];
      lastEntry.cells_after_weather = structuredClone(newState.cells);
      // applyWeather sets event/event_label on state.weather — copy into the history entry
      lastEntry.weather = { ...lastEntry.weather, ...newState.weather };
    }
    delete newState.weatherEvents;

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
