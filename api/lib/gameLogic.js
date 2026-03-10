import {
  ZONES,
  ACTIONS_PER_TICK,
  BLOCK_TYPES,
  REINFORCE_AMOUNT,
  MAX_HEALTH,
  GRID_WIDTH,
  GRID_HEIGHT,
  rainDamage,
  windDamage,
} from './rules.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findCell(cells, x, y) {
  return cells.find(c => c.x === x && c.y === y) ?? null;
}

function playerZone(player) {
  return ZONES[player];
}

function inZone(player, x) {
  const z = playerZone(player);
  return x >= z.x_min && x <= z.x_max;
}

function inGrid(x, y) {
  return x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT;
}

// ---------------------------------------------------------------------------
// validateMove — returns { valid: true } or { valid: false, reason: string }
// ---------------------------------------------------------------------------

export function validateMove(state, player, action) {
  const { action: type, x, y, type: blockType } = action;

  if (!inGrid(x, y)) {
    return { valid: false, reason: `Coordinates (${x},${y}) are outside the grid.` };
  }

  const playerState = state.players[player];
  if (playerState.turnCommitted) {
    return { valid: false, reason: 'Turn already committed. Wait for the next tick.' };
  }
  if (playerState.actionsThisTick >= ACTIONS_PER_TICK) {
    return { valid: false, reason: `Action budget exhausted (${ACTIONS_PER_TICK} actions per tick).` };
  }

  const cell = findCell(state.cells, x, y);

  switch (type) {
    case 'PLACE': {
      if (!inZone(player, x)) {
        return { valid: false, reason: `(${x},${y}) is outside your zone.` };
      }
      if (cell) {
        return { valid: false, reason: `Cell (${x},${y}) is already occupied.` };
      }
      if (!BLOCK_TYPES[blockType]) {
        return {
          valid: false,
          reason: `Unknown block type "${blockType}". Valid types: ${Object.keys(BLOCK_TYPES).join(', ')}.`,
        };
      }
      return { valid: true };
    }

    case 'REMOVE': {
      if (!cell) {
        return { valid: false, reason: `No block at (${x},${y}).` };
      }
      if (cell.owner !== player) {
        return { valid: false, reason: `Cell (${x},${y}) belongs to ${cell.owner}.` };
      }
      return { valid: true };
    }

    case 'REINFORCE': {
      if (!cell) {
        return { valid: false, reason: `No block at (${x},${y}).` };
      }
      if (cell.owner !== player) {
        return { valid: false, reason: `Cell (${x},${y}) belongs to ${cell.owner}.` };
      }
      return { valid: true };
    }

    default:
      return { valid: false, reason: `Unknown action "${type}". Valid actions: PLACE, REMOVE, REINFORCE.` };
  }
}

// ---------------------------------------------------------------------------
// applyMove — mutates a cloned state, returns it
// ---------------------------------------------------------------------------

export function applyMove(state, player, action) {
  const { action: type, x, y, type: blockType } = action;

  state.players[player].actionsThisTick += 1;

  switch (type) {
    case 'PLACE': {
      state.cells.push({
        x,
        y,
        type: blockType,
        health: BLOCK_TYPES[blockType].initial_health,
        owner: player,
      });
      break;
    }
    case 'REMOVE': {
      state.cells = state.cells.filter(c => !(c.x === x && c.y === y));
      break;
    }
    case 'REINFORCE': {
      const cell = state.cells.find(c => c.x === x && c.y === y);
      cell.health = Math.min(cell.health + REINFORCE_AMOUNT, MAX_HEALTH);
      break;
    }
  }

  state.lastUpdated = new Date().toISOString();
  return state;
}

// ---------------------------------------------------------------------------
// validateCommit / commitTurn — player signals their turn is done
// ---------------------------------------------------------------------------

export function validateCommit(state, player) {
  const playerState = state.players[player];
  if (playerState.turnCommitted) {
    return { valid: false, reason: 'Turn already committed this tick.' };
  }
  return { valid: true };
}

export function commitTurn(state, player) {
  state.players[player].turnCommitted = true;
  state.lastUpdated = new Date().toISOString();
  return state;
}

// ---------------------------------------------------------------------------
// recordRound — snapshots the current tick into history before advancing
// ---------------------------------------------------------------------------

export function recordRound(state) {
  if (!state.history) state.history = [];
  const round = {
    tick: state.tick,
    weather: { ...state.weather },
    player1: {
      actions: state.players.player1.actionsThisTick,
      committed: state.players.player1.turnCommitted ?? false,
      blocks: state.cells.filter(c => c.owner === 'player1').length,
    },
    player2: {
      actions: state.players.player2.actionsThisTick,
      committed: state.players.player2.turnCommitted ?? false,
      blocks: state.cells.filter(c => c.owner === 'player2').length,
    },
  };
  state.history.push(round);
  return state;
}

const WIND_DIRECTION_VECTORS = {
  N:  { axis: 'y', edge: 0,               comparator: (_x, y) => y === 0 },
  S:  { axis: 'y', edge: GRID_HEIGHT - 1, comparator: (_x, y) => y === GRID_HEIGHT - 1 },
  E:  { axis: 'x', edge: GRID_WIDTH - 1,  comparator: (x) => x === GRID_WIDTH - 1 },
  W:  { axis: 'x', edge: 0,               comparator: (x) => x === 0 },
  NE: { axis: 'both', comparator: (x, y) => y === 0 || x === GRID_WIDTH - 1 },
  NW: { axis: 'both', comparator: (x, y) => y === 0 || x === 0 },
  SE: { axis: 'both', comparator: (x, y) => y === GRID_HEIGHT - 1 || x === GRID_WIDTH - 1 },
  SW: { axis: 'both', comparator: (x, y) => y === GRID_HEIGHT - 1 || x === 0 },
};

function isWindwardEdge(x, y, direction) {
  const vec = WIND_DIRECTION_VECTORS[direction];
  if (!vec) return false;
  return vec.comparator(x, y);
}

export function applyWeather(state) {
  const { rain_mm, wind_speed_kph, wind_direction } = state.weather;
  const rain  = rainDamage(rain_mm);
  const wind  = windDamage(wind_speed_kph);

  state.cells = state.cells
    .map(cell => {
      let damage = rain;
      if (wind > 0 && isWindwardEdge(cell.x, cell.y, wind_direction)) {
        damage += wind;
      }
      return { ...cell, health: cell.health - damage };
    })
    .filter(cell => cell.health > 0);

  // Reset action counters
  for (const player of Object.keys(state.players)) {
    state.players[player].actionsThisTick = 0;
    state.players[player].turnCommitted = false;
  }

  state.tick += 1;
  state.lastUpdated = new Date().toISOString();
  return state;
}
