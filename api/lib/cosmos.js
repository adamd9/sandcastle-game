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
  // Trim history to avoid exceeding Cosmos DB's 2 MB document size limit.
  // Each history entry contains two full cell snapshots, so unbounded growth
  // quickly causes 413 "Request size is too large" errors from the SDK.
  if (Array.isArray(newState.history) && newState.history.length > MAX_HISTORY_IN_STORE) {
    newState.history = newState.history.slice(-MAX_HISTORY_IN_STORE);
  }
  await container.items.upsert(newState);
}
