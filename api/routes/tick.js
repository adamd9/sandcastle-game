import { Router } from 'express';
import { getState, saveState } from '../lib/db.js';
import { applyWeather, recordRound } from '../lib/gameLogic.js';
import { selectRandomWeatherEvent } from '../lib/weather.js';
import { recordExternalTick } from '../lib/scheduler.js';
import { JUDGE_INTERVAL, MAX_JUDGMENTS_HISTORY } from '../lib/rules.js';
import { renderBoard } from '../lib/renderer.js';
import { judgeCastles } from '../lib/judge.js';

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
 * Selects a random predefined weather event, applies damage to all cells,
 * increments tick counter, and resets each player's actionsThisTick budget.
 * Header: X-Api-Key (TICK_ADMIN_KEY)
 */
router.post('/', authenticate, async (_req, res) => {
  try {
    const ev = selectRandomWeatherEvent();
    const weather = {
      rain_mm:        ev.rain_mm,
      wind_speed_kph: ev.wind_speed_kph,
      wind_direction: ev.wind_direction,
      event_id:       ev.id,
      event_name:     ev.name,
      event_emoji:    ev.emoji,
      event_type:     ev.event_type,
    };

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

    // Visual judging — every JUDGE_INTERVAL ticks
    let judgment = null;
    if (newState.tick > 0 && newState.tick % JUDGE_INTERVAL === 0 && process.env.OPENAI_API_KEY) {
      try {
        const [p1Img, p2Img] = await Promise.all([
          renderBoard(newState, { view: 'player1', cellSize: 30 }),
          renderBoard(newState, { view: 'player2', cellSize: 30 }),
        ]);
        const result = await judgeCastles(p1Img, p2Img);

        if (!newState.scores) newState.scores = { player1: 0, player2: 0 };
        if (!newState.judgments) newState.judgments = [];

        if (result.winner !== 'tie') {
          newState.scores[result.winner] += 1;
        }

        judgment = {
          tick: newState.tick,
          winner: result.winner,
          reasoning: result.reasoning,
          scores: { ...newState.scores },
        };
        newState.judgments.push(judgment);

        // Store judgment in the history entry so UI and agents can see it
        if (newState.history?.length > 0) {
          newState.history[newState.history.length - 1].judgment = judgment;
        }

        // Trim judgment history
        if (newState.judgments.length > MAX_JUDGMENTS_HISTORY) {
          newState.judgments = newState.judgments.slice(-MAX_JUDGMENTS_HISTORY);
        }
      } catch (err) {
        console.error('Visual judging failed during tick:', err.message);
      }
    }

    await saveState(newState);
    recordExternalTick();

    res.json({
      ok: true,
      tick: newState.tick,
      weather: newState.weather,
      cellsRemaining: newState.cells.length,
      scores: newState.scores,
      ...(judgment && { judgment }),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
