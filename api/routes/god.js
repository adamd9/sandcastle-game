import { Router } from 'express';
import { getState, saveState } from '../lib/db.js';
import { validateMove, applyMove, applyWeather, validateCommit, commitTurn, recordRound } from '../lib/gameLogic.js';
import { fetchWeather } from '../lib/weather.js';
import { getSchedulerStatus } from '../lib/scheduler.js';
import { triggerHookByName } from '../lib/hooks.js';

const router = Router();

function devOnly(req, res, next) {
  if (process.env.COSMOS_ENDPOINT) {
    return res.status(403).json({ error: 'This endpoint is disabled in production.' });
  }
  next();
}

/**
 * POST /god/move
 * Body: { player: "player1"|"player2", action: "PLACE"|"REMOVE"|"REINFORCE", x, y, type? }
 * No auth — local dev only.
 */
router.post('/move', devOnly, async (req, res) => {
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
router.post('/end-turn', devOnly, async (req, res) => {
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
router.post('/turn', devOnly, async (req, res) => {
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


/**
 * POST /god/tick
 * Advances the game by one tick. Available in production (requires TICK_ADMIN_KEY).
 *
 * Optionally accepts custom weather in the body to override live weather fetch:
 * {
 *   rain_mm?: number,        // 0–50. How much rain this tick. Default: live weather.
 *   wind_speed_kph?: number, // 0–120. Wind speed. Default: live weather.
 *   wind_direction?: string  // 'N'|'NE'|'E'|'SE'|'S'|'SW'|'W'|'NW'. Default: live weather.
 *   use_live_weather?: boolean // true = ignore body overrides, fetch live. Default: false if any override provided, true if none.
 * }
 * Header: X-Api-Key (TICK_ADMIN_KEY)
 */
router.post('/tick', async (req, res) => {
  // Auth check — required in all environments
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.TICK_ADMIN_KEY) {
    return res.status(401).json({ error: 'Invalid or missing X-Api-Key header.' });
  }

  try {
    const { rain_mm, wind_speed_kph, wind_direction, use_live_weather } = req.body ?? {};
    const hasOverrides = rain_mm !== undefined || wind_speed_kph !== undefined || wind_direction !== undefined;

    let weather;
    if (!hasOverrides || use_live_weather) {
      // Fetch live weather, fall back to safe defaults
      try {
        weather = await fetchWeather();
        // Apply any partial overrides on top of live weather
        if (rain_mm !== undefined)        weather.rain_mm        = Number(rain_mm);
        if (wind_speed_kph !== undefined) weather.wind_speed_kph = Number(wind_speed_kph);
        if (wind_direction !== undefined) weather.wind_direction = wind_direction;
      } catch (err) {
        console.error('Weather fetch failed, using fallback:', err.message);
        weather = {
          rain_mm:        rain_mm        !== undefined ? Number(rain_mm)        : 0,
          wind_speed_kph: wind_speed_kph !== undefined ? Number(wind_speed_kph) : 0,
          wind_direction: wind_direction !== undefined ? wind_direction          : 'N',
        };
      }
    } else {
      // Full manual override — skip live fetch entirely
      weather = {
        rain_mm:        Number(rain_mm        ?? 0),
        wind_speed_kph: Number(wind_speed_kph ?? 0),
        wind_direction: wind_direction ?? 'N',
      };
    }

    const state = await getState();
    state.weather = weather;

    const withHistory = recordRound(structuredClone(state));
    const newState = applyWeather(withHistory);

    if (newState.history?.length > 0) {
      const lastEntry = newState.history[newState.history.length - 1];
      lastEntry.weatherEvents = newState.weatherEvents || [];
      lastEntry.cells_after_weather = structuredClone(newState.cells);
      lastEntry.weather = { ...(lastEntry.weather || {}), ...(newState.weather || {}) };
    }
    delete newState.weatherEvents;

    await saveState(newState);

    res.json({
      ok: true,
      tick: newState.tick,
      weather: newState.weather,
      cellsRemaining: newState.cells.length,
      weatherSource: hasOverrides && !use_live_weather ? 'manual' : 'live',
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
router.post('/erase', devOnly, async (req, res) => {
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

/**
 * POST /god/backfill-history
 * One-off: reconstruct cell snapshots for history entries that lack them.
 * Works backwards from current cells undoing moves + weather events.
 * Safe to call multiple times (skips entries that already have cells).
 * Header: X-Api-Key (TICK_ADMIN_KEY)
 */
router.post('/backfill-history', async (req, res) => {
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.TICK_ADMIN_KEY) {
    return res.status(401).json({ error: 'Invalid or missing X-Api-Key header.' });
  }

  const REINFORCE_AMOUNT = 15;

  function undoWeather(cells, weatherEvents) {
    const cellMap = new Map(cells.map(c => [`${c.x},${c.y}`, { ...c }]));
    for (const ev of (weatherEvents || [])) {
      const key = `${ev.x},${ev.y}`;
      if (ev.type === 'destroyed') {
        cellMap.set(key, { x: ev.x, y: ev.y, type: ev.block_type, owner: ev.owner, health: ev.health_before });
      } else if (ev.type === 'damaged') {
        const cell = cellMap.get(key);
        if (cell) cell.health = ev.health_before;
        else cellMap.set(key, { x: ev.x, y: ev.y, type: ev.block_type, owner: ev.owner, health: ev.health_before });
      }
    }
    return Array.from(cellMap.values());
  }

  function undoMoves(cells, moves) {
    const cellMap = new Map(cells.map(c => [`${c.x},${c.y}`, { ...c }]));
    const allMoves = [...(moves.player1 || []), ...(moves.player2 || [])].reverse();
    for (const move of allMoves) {
      const key = `${move.x},${move.y}`;
      if (move.action === 'PLACE') {
        cellMap.delete(key);
      } else if (move.action === 'REINFORCE') {
        const cell = cellMap.get(key);
        if (cell) cell.health = Math.max(1, cell.health - REINFORCE_AMOUNT);
      }
      // REMOVE: can't restore — skip
    }
    return Array.from(cellMap.values());
  }

  try {
    const state = await getState();
    const history = state.history || [];
    const missing = history.filter(h => !h.cells).length;

    if (missing === 0) return res.json({ ok: true, message: 'Nothing to backfill.', backfilled: 0 });

    let cells = structuredClone(state.cells);
    const log = [];

    for (const round of [...history].reverse()) {
      cells = undoWeather(cells, round.weatherEvents);
      cells = undoMoves(cells, round.moves || {});
      if (!round.cells) {
        round.cells = structuredClone(cells);
        log.push(`tick ${round.tick}: backfilled (${cells.length} cells)`);
      } else {
        cells = structuredClone(round.cells);
        log.push(`tick ${round.tick}: already had snapshot`);
      }
    }

    await saveState(state);
    res.json({ ok: true, backfilled: missing, log });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /god/scheduler-status
 * Returns current scheduler status. No auth required (read-only, non-sensitive).
 */
router.get('/scheduler-status', (_req, res) => {
  res.json(getSchedulerStatus());
});

/**
 * POST /god/trigger-hook
 * Manually fires a named post-tick hook. Requires TICK_ADMIN_KEY auth.
 * Body: { hook: 'notify-players' | 'notify-player1' | 'notify-player2' | 'review-improvements' }
 * Header: X-Api-Key or X-God-Key (TICK_ADMIN_KEY)
 */
router.post('/trigger-hook', async (req, res) => {
  const key = req.headers['x-api-key'] || req.headers['x-god-key'];
  if (!key || key !== process.env.TICK_ADMIN_KEY) {
    return res.status(401).json({ error: 'Invalid or missing X-Api-Key header.' });
  }

  const { hook } = req.body ?? {};
  const validHooks = ['notify-players', 'notify-player1', 'notify-player2', 'review-improvements'];
  if (!hook || !validHooks.includes(hook)) {
    return res.status(400).json({ error: `hook must be one of: ${validHooks.join(', ')}` });
  }

  try {
    const state = await getState();
    const results = await triggerHookByName(hook, state);
    res.json({ ok: true, hook, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
