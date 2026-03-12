// File-backed store for local development.
// Falls back to a pure in-memory store when running under Vitest so tests
// never touch the filesystem.
// Implements the same getState() / saveState() interface as cosmos.js.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, '..', 'state.json');

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
  lastUpdated: new Date().toISOString(),
});

// During tests use a plain in-memory object so the filesystem is never touched.
const IS_TEST = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
let _memState = null;

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

export function getState() {
  if (IS_TEST) {
    return structuredClone(_memState ?? (_memState = INITIAL_STATE()));
  }
  return readFile();
}

export function saveState(newState) {
  if (IS_TEST) {
    _memState = structuredClone(newState);
    return;
  }
  newState.lastUpdated = new Date().toISOString();
  writeFileSync(STATE_FILE, JSON.stringify(newState, null, 2), 'utf8');
}

/** Reset to initial state — used in tests. */
export function resetState() {
  _memState = INITIAL_STATE();
}
