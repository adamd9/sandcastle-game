// File-backed store for local development.
// Falls back to a pure in-memory store when running under Vitest so tests
// never touch the filesystem.
// Implements the same getState() / saveState() / getHistory() / getHistoryCount()
// interface as cosmos.js.
//
// History entries are stored separately (in-memory array or separate file) to
// mirror the multi-document Cosmos DB model.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, '..', 'state.json');
const HISTORY_FILE = join(__dirname, '..', 'history-archive.json');

const INITIAL_STATE = () => ({
  id: 'game',
  tick: 0,
  weather: { rain_mm: 0, wind_speed_kph: 0, wind_direction: 'N' },
  cells: [],
  flags: [],
  players: {
    player1: { actionsThisTick: 0, turnCommitted: false },
    player2: { actionsThisTick: 0, turnCommitted: false },
  },
  history: [],
  scores: { player1: 0, player2: 0 },
  judgments: [],
  lastUpdated: new Date().toISOString(),
});

// During tests use a plain in-memory object so the filesystem is never touched.
const IS_TEST = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
let _memState = null;
let _memHistory = [];   // separate history store (mirrors Cosmos multi-doc model)
let _migrationDone = false;

/**
 * Migrate any inline history[] from the main state into the separate history
 * store.  Idempotent — skips if already migrated or no inline history exists.
 */
function migrateInlineHistory(state) {
  if (_migrationDone) return state;
  _migrationDone = true;

  const inline = state.history;
  if (!Array.isArray(inline) || inline.length === 0) return state;

  // Merge into the separate history store (avoid duplicates by tick)
  const existingTicks = new Set(_memHistory.map(h => h.tick));
  for (const entry of inline) {
    if (!existingTicks.has(entry.tick)) {
      _memHistory.push(structuredClone(entry));
    }
  }
  // Sort ascending by tick
  _memHistory.sort((a, b) => a.tick - b.tick);

  // Remove inline history from state
  state.history = [];
  return state;
}

function readFile() {
  if (existsSync(STATE_FILE)) {
    try {
      return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    } catch {
      // Corrupted file — start fresh
    }
  }
  return INITIAL_STATE();
}

function readHistoryFile() {
  if (existsSync(HISTORY_FILE)) {
    try {
      return JSON.parse(readFileSync(HISTORY_FILE, 'utf8'));
    } catch {
      // Corrupted file
    }
  }
  return [];
}

function writeHistoryFile(entries) {
  writeFileSync(HISTORY_FILE, JSON.stringify(entries, null, 2), 'utf8');
}

export function getState() {
  if (IS_TEST) {
    const state = structuredClone(_memState ?? (_memState = INITIAL_STATE()));
    const migrated = migrateInlineHistory(state);
    migrated.history = [];
    return migrated;
  }
  const state = readFile();
  // Load separate history file on first access for file-backed mode
  const needsLoad = !_migrationDone;
  if (needsLoad) {
    _memHistory = readHistoryFile();
  }
  const migrated = migrateInlineHistory(state);
  // Persist if migration changed the state (stripped inline history)
  if (migrated.history !== state.history || needsLoad) {
    writeFileSync(STATE_FILE, JSON.stringify(migrated, null, 2), 'utf8');
  }
  migrated.history = [];
  return migrated;
}

export function saveState(newState) {
  // Extract any new history entries and store them separately
  if (Array.isArray(newState.history) && newState.history.length > 0) {
    const existingTicks = new Set(_memHistory.map(h => h.tick));
    for (const entry of newState.history) {
      if (existingTicks.has(entry.tick)) {
        // Update existing entry
        const idx = _memHistory.findIndex(h => h.tick === entry.tick);
        if (idx >= 0) _memHistory[idx] = structuredClone(entry);
      } else {
        _memHistory.push(structuredClone(entry));
      }
    }
    _memHistory.sort((a, b) => a.tick - b.tick);
    newState.history = [];
  }

  if (IS_TEST) {
    _memState = structuredClone(newState);
    return;
  }
  newState.lastUpdated = new Date().toISOString();
  writeFileSync(STATE_FILE, JSON.stringify(newState, null, 2), 'utf8');
  writeHistoryFile(_memHistory);
}

/**
 * Retrieve the most recent N history entries, ordered by tick ascending.
 * @param {number} limit - max entries to return (0 = all)
 */
export function getHistory(limit = 10) {
  if (limit <= 0) return [..._memHistory];
  return _memHistory.slice(-limit);
}

/**
 * Return the total count of stored history entries.
 */
export function getHistoryCount() {
  return _memHistory.length;
}

/**
 * Directly save (upsert) an array of history entries into the separate store.
 * Useful for backfill operations that only need to update history without
 * loading/saving the entire game state.
 */
export function saveHistoryEntries(entries) {
  const existingTicks = new Set(_memHistory.map(h => h.tick));
  for (const entry of entries) {
    if (existingTicks.has(entry.tick)) {
      const idx = _memHistory.findIndex(h => h.tick === entry.tick);
      if (idx >= 0) _memHistory[idx] = structuredClone(entry);
    } else {
      _memHistory.push(structuredClone(entry));
    }
  }
  _memHistory.sort((a, b) => a.tick - b.tick);

  if (!IS_TEST) {
    writeHistoryFile(_memHistory);
  }
}

/** Reset to initial state — used in tests. */
export function resetState() {
  _memState = INITIAL_STATE();
  _memHistory = [];
  _migrationDone = false;
}
