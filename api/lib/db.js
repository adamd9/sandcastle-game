// db.js — dynamically imports the right store.
//
// Uses Cosmos DB when COSMOS_ENDPOINT is set; otherwise falls back to the
// file-backed local store so the @azure/cosmos package is never instantiated
// (and its peer-dep errors never triggered) during local development or tests.

const mod = process.env.COSMOS_ENDPOINT
  ? await import('./cosmos.js')
  : await import('./store.js');

export const getState  = mod.getState;
export const saveState = mod.saveState;
