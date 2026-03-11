/**
 * One-off script: backfill cells[] snapshots into history entries that lack them.
 *
 * Strategy: work backwards from the current cells through history entries,
 * undoing moves and weather events at each step to reconstruct the grid state
 * that existed at the START of each tick (matching what recordRound now captures).
 *
 * Limitations:
 *   - REMOVE actions: we can't restore the removed cell (type/health unknown), skipped.
 *   - REINFORCE: we subtract REINFORCE_AMOUNT (15hp), clamped to block's base HP.
 *     If multiple reinforces happened in one tick this may be slightly off.
 *
 * Run with: node api/backfill-history.js  (from repo root)
 */

import { getState, saveState } from './lib/db.js';

const REINFORCE_AMOUNT = 15;

function undoWeather(cells, weatherEvents) {
  const cellMap = new Map(cells.map(c => [`${c.x},${c.y}`, { ...c }]));

  for (const ev of weatherEvents) {
    const key = `${ev.x},${ev.y}`;
    if (ev.type === 'destroyed') {
      // Cell was destroyed — add it back with its health_before value
      cellMap.set(key, {
        x: ev.x,
        y: ev.y,
        type: ev.block_type,
        owner: ev.owner,
        health: ev.health_before,
      });
    } else if (ev.type === 'damaged') {
      // Cell was damaged — restore to health_before
      const cell = cellMap.get(key);
      if (cell) {
        cell.health = ev.health_before;
      } else {
        // Shouldn't happen, but restore defensively
        cellMap.set(key, {
          x: ev.x,
          y: ev.y,
          type: ev.block_type,
          owner: ev.owner,
          health: ev.health_before,
        });
      }
    }
  }

  return Array.from(cellMap.values());
}

function undoMoves(cells, moves) {
  const cellMap = new Map(cells.map(c => [`${c.x},${c.y}`, { ...c }]));

  const allMoves = [
    ...(moves.player1 || []),
    ...(moves.player2 || []),
  ];

  // Process in reverse order (last move applied first)
  for (const move of [...allMoves].reverse()) {
    const key = `${move.x},${move.y}`;
    if (move.action === 'PLACE') {
      // Cell was placed this tick — remove it
      cellMap.delete(key);
    } else if (move.action === 'REINFORCE') {
      // Cell was reinforced — subtract the reinforce amount
      const cell = cellMap.get(key);
      if (cell) {
        cell.health = Math.max(1, cell.health - REINFORCE_AMOUNT);
      }
    } else if (move.action === 'REMOVE') {
      // Cell was removed — we can't reconstruct it, skip
    }
  }

  return Array.from(cellMap.values());
}

async function main() {
  const state = await getState();

  if (!state.history || state.history.length === 0) {
    console.log('No history entries found.');
    return;
  }

  const missing = state.history.filter(h => !h.cells).length;
  console.log(`History entries: ${state.history.length}, missing cell snapshots: ${missing}`);

  if (missing === 0) {
    console.log('Nothing to backfill.');
    return;
  }

  // Start from current cells and work backwards
  let cells = structuredClone(state.cells);

  // Process history from newest to oldest
  const historyDesc = [...state.history].reverse();

  for (const round of historyDesc) {
    // Undo weather events from this round (they happened AFTER recordRound captured state)
    cells = undoWeather(cells, round.weatherEvents || []);

    // Undo moves from this round (they happened AFTER recordRound captured state)
    cells = undoMoves(cells, round.moves || {});

    if (!round.cells) {
      round.cells = structuredClone(cells);
      console.log(`  Backfilled tick ${round.tick}: ${cells.length} cells`);
    } else {
      console.log(`  Tick ${round.tick}: already has snapshot (${round.cells.length} cells), skipping undo`);
      // For entries that already have cells, use those as the starting point for further undo
      cells = structuredClone(round.cells);
    }
  }

  await saveState(state);
  console.log(`\nDone. Backfilled ${missing} history entries.`);
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
