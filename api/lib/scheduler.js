import cron from 'node-cron';
import { getState, saveState } from './db.js';
import { applyWeather, recordRound } from './gameLogic.js';
import { fetchWeather } from './weather.js';

const DEFAULT_CRON = '0 * * * *';
const MIN_TICK_INTERVAL_MS = 50 * 60 * 1000; // 50 minutes

let schedulerTask = null;
let lastTickAt = null;
let cronExpr = DEFAULT_CRON;
let hooksLoaded = false;
let firePostTickHooks = null;

async function loadHooks() {
  if (hooksLoaded) return;
  hooksLoaded = true;
  try {
    const mod = await import('./hooks.js');
    firePostTickHooks = mod.firePostTickHooks ?? null;
  } catch {
    // hooks.js not yet available
  }
}

async function runTick() {
  // Double-fire guard: skip if last tick was less than 50 minutes ago
  if (lastTickAt && (Date.now() - lastTickAt.getTime()) < MIN_TICK_INTERVAL_MS) {
    console.warn(`[scheduler] Skipping tick — last tick was at ${lastTickAt.toISOString()}, less than 50 minutes ago`);
    return;
  }

  try {
    let weather;
    try {
      weather = await fetchWeather();
    } catch (err) {
      console.error('[scheduler] Weather fetch failed, using fallback:', err.message);
      weather = { rain_mm: 0, wind_speed_kph: 0, wind_direction: 'N' };
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
    lastTickAt = new Date();

    console.log(`[scheduler] tick ${newState.tick} fired at ${lastTickAt.toISOString()}`);

    // Fire post-tick hooks if available
    await loadHooks();
    if (firePostTickHooks) {
      try {
        await firePostTickHooks(newState);
      } catch (err) {
        console.error('[scheduler] Post-tick hook error:', err.message);
      }
    }
  } catch (err) {
    console.error('[scheduler] Tick error:', err.message);
  }
}

export function initScheduler(app) {
  cronExpr = process.env.TICK_CRON || DEFAULT_CRON;

  if (!cron.validate(cronExpr)) {
    console.error(`[scheduler] Invalid TICK_CRON expression: "${cronExpr}", using default`);
    cronExpr = DEFAULT_CRON;
  }

  schedulerTask = cron.schedule(cronExpr, runTick, { scheduled: true });
  console.log(`[scheduler] Started with cron: ${cronExpr}`);
}

export function getSchedulerStatus() {
  return {
    running: schedulerTask !== null,
    nextTick: schedulerTask ? 'scheduled' : 'not running',
    lastTickAt: lastTickAt ? lastTickAt.toISOString() : null,
    cronExpr,
  };
}

/**
 * Called by external tick handlers (e.g. POST /god/tick, POST /tick) to inform
 * the scheduler that a tick just ran. This prevents the scheduler from firing
 * another tick too soon and potentially overwriting the external tick's saved state.
 */
export function recordExternalTick() {
  lastTickAt = new Date();
}
