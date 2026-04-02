// File-backed store for local development.
// Falls back to a pure in-memory store when running under Vitest so tests
// never touch the filesystem.
// Implements the same getState() / saveState() interface as cosmos.js.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MAX_HISTORY_IN_STORE } from './rules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, '..', 'state.json');
const HISTORY_ARCHIVE_FILE = join(__dirname, '..', 'history-archive.json');

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
let _memArchive = [];

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

function readArchiveFile() {
  if (existsSync(HISTORY_ARCHIVE_FILE)) {
    try {
      return JSON.parse(readFileSync(HISTORY_ARCHIVE_FILE, 'utf8'));
    } catch {
      return [];
    }
  }
  return [];
}

export function getState() {
  if (IS_TEST) {
    return structuredClone(_memState ?? (_memState = INITIAL_STATE()));
  }
  return readFile();
}

export function saveState(newState) {
  // Trim history to avoid unbounded document growth (mirrors cosmos.js behaviour).
  if (Array.isArray(newState.history) && newState.history.length > MAX_HISTORY_IN_STORE) {
    newState.history = newState.history.slice(-MAX_HISTORY_IN_STORE);
  }
  if (IS_TEST) {
    _memState = structuredClone(newState);
    return;
  }
  newState.lastUpdated = new Date().toISOString();
  writeFileSync(STATE_FILE, JSON.stringify(newState, null, 2), 'utf8');
}

/**
 * Save a history entry to the separate archive.
 * Each entry is stored individually, keyed by tick number, so history is not
 * constrained by the main document's size limit.
 */
export function saveHistoryEntry(entry) {
  if (IS_TEST) {
    const idx = _memArchive.findIndex(e => e.tick === entry.tick);
    if (idx >= 0) _memArchive[idx] = structuredClone(entry);
    else _memArchive.push(structuredClone(entry));
    return;
  }
  const archive = readArchiveFile();
  const idx = archive.findIndex(e => e.tick === entry.tick);
  if (idx >= 0) archive[idx] = entry;
  else archive.push(entry);
  archive.sort((a, b) => a.tick - b.tick);
  writeFileSync(HISTORY_ARCHIVE_FILE, JSON.stringify(archive), 'utf8');
}

/**
 * Retrieve history entries from the archive.
 * @param {object} opts
 * @param {number} [opts.limit=0]   - Max entries to return (0 = all).
 * @param {number} [opts.offset=0]  - Skip this many entries from the start.
 * @returns {{ entries: Array, total: number }}
 */
export function getHistoryArchive({ limit = 0, offset = 0 } = {}) {
  let archive;
  if (IS_TEST) {
    archive = _memArchive;
  } else {
    archive = readArchiveFile();
  }
  const total = archive.length;
  let entries = offset > 0 ? archive.slice(offset) : archive;
  if (limit > 0) entries = entries.slice(-limit);
  return { entries: structuredClone(entries), total };
}

/** Reset to initial state — used in tests. */
export function resetState() {
  _memState = INITIAL_STATE();
  _memArchive = [];
}
