// Cosmos DB persistence layer.
// Used in production (NODE_ENV=production).
// Implements the same getState() / saveState() interface as store.js.

import { CosmosClient } from '@azure/cosmos';
import { MAX_HISTORY_IN_STORE } from './rules.js';

const client = new CosmosClient({
  endpoint: process.env.COSMOS_ENDPOINT,
  key: process.env.COSMOS_KEY,
});

const container = client
  .database('sandcastle')
  .container('game');

// Separate container that stores every history entry ever recorded.
// Each document has id = `tick-${entry.tick}` and a `gameId` field used as
// the partition key (configure the container with partition key path /gameId).
// This container must be pre-provisioned in Cosmos DB; the game container
// cap (MAX_HISTORY_IN_STORE) keeps the main document within the 2 MB limit
// while full history is preserved here for auditing / replay.
const historyContainer = client
  .database('sandcastle')
  .container('history');

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

export async function getState() {
  try {
    const { resource } = await container.item(ITEM_ID, PARTITION_KEY).read();
    return resource ?? structuredClone(INITIAL_STATE);
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
  // Archive entries that would be trimmed to the dedicated history container
  // so no tick data is lost, even though the main document only keeps the
  // most recent MAX_HISTORY_IN_STORE entries (to stay within the 2 MB limit).
  if (Array.isArray(newState.history) && newState.history.length > MAX_HISTORY_IN_STORE) {
    const toArchive = newState.history.slice(0, newState.history.length - MAX_HISTORY_IN_STORE);
    try {
      await Promise.all(
        toArchive.map(entry =>
          historyContainer.items.upsert({ id: `tick-${entry.tick}`, gameId: 'game', ...entry })
        )
      );
    } catch (archiveErr) {
      // Archive failures must not block the main state write.
      const failedTicks = toArchive.map(e => e.tick).join(', ');
      console.error(`[cosmos] history archive failed for ticks [${failedTicks}]:`, archiveErr.message ?? archiveErr);
    }
    newState.history = newState.history.slice(-MAX_HISTORY_IN_STORE);
  }
  await container.items.upsert(newState);
}
