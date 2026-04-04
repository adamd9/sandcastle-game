// Cosmos DB persistence layer.
// Used in production (NODE_ENV=production).
// Implements the same getState() / saveState() interface as store.js.
//
// History entries are stored as separate documents (one per tick) in the same
// container, keyed by id="history_tick_{N}" with the same partition key "game".
// This avoids the 2 MB document size limit and allows unlimited history.
// On first startup, any existing inline history[] on the main game document is
// migrated into separate documents automatically.

import { CosmosClient } from '@azure/cosmos';

const client = new CosmosClient({
  endpoint: process.env.COSMOS_ENDPOINT,
  key: process.env.COSMOS_KEY,
});

const container = client
  .database('sandcastle')
  .container('game');

const ITEM_ID = 'game';
const PARTITION_KEY = 'game';

const INITIAL_STATE = {
  id: ITEM_ID,
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
};

let migrationDone = false;

/**
 * Migrate inline history[] from the legacy single-document model into separate
 * per-tick documents.  Safe to call multiple times — skips if already migrated.
 */
async function migrateInlineHistory(state) {
  if (migrationDone) return state;
  migrationDone = true;

  const inline = state.history;
  if (!Array.isArray(inline) || inline.length === 0) return state;

  // Write each history entry as a separate document (upsert is idempotent)
  for (const entry of inline) {
    const doc = {
      id: `history_tick_${entry.tick}`,
      partitionKey: PARTITION_KEY,
      docType: 'history',
      tick: entry.tick,
      ...entry,
    };
    await container.items.upsert(doc);
  }

  // Remove inline history from the main document and persist
  state.history = [];
  state.lastUpdated = new Date().toISOString();
  await container.items.upsert(state);

  console.log(`[cosmos] Migrated ${inline.length} inline history entries to separate documents.`);
  return state;
}

export async function getState() {
  try {
    const { resource } = await container.item(ITEM_ID, PARTITION_KEY).read();
    if (!resource) return structuredClone(INITIAL_STATE);
    const state = await migrateInlineHistory(resource);
    // Always return history as empty — callers use getHistory() for history data
    state.history = [];
    return state;
  } catch (err) {
    if (err.code === 404) {
      // First run — seed initial state
      const { resource } = await container.items.upsert(structuredClone(INITIAL_STATE));
      return resource;
    }
    throw err;
  }
}

export async function saveState(newState) {
  newState.lastUpdated = new Date().toISOString();

  // Extract any new history entries and write them as separate documents
  if (Array.isArray(newState.history) && newState.history.length > 0) {
    for (const entry of newState.history) {
      const doc = {
        id: `history_tick_${entry.tick}`,
        partitionKey: PARTITION_KEY,
        docType: 'history',
        tick: entry.tick,
        ...entry,
      };
      await container.items.upsert(doc);
    }
    // Clear inline history — it now lives in separate documents
    newState.history = [];
  }

  await container.items.upsert(newState);
}

/**
 * Retrieve the most recent N history entries, ordered by tick descending.
 * Returns them in ascending tick order (oldest first) for compatibility.
 * @param {number} limit - max entries to return (0 = all)
 */
export async function getHistory(limit = 10) {
  const top = limit > 0 ? `TOP ${limit}` : '';
  const query = {
    query: `SELECT ${top} * FROM c WHERE c.docType = "history" ORDER BY c.tick DESC`,
  };
  const { resources } = await container.items.query(query, { partitionKey: PARTITION_KEY }).fetchAll();
  // Return in ascending order (oldest first)
  return resources.sort((a, b) => a.tick - b.tick);
}

/**
 * Return the total count of history documents.
 */
export async function getHistoryCount() {
  const query = {
    query: 'SELECT VALUE COUNT(1) FROM c WHERE c.docType = "history"',
  };
  const { resources } = await container.items.query(query, { partitionKey: PARTITION_KEY }).fetchAll();
  return resources[0] ?? 0;
}
