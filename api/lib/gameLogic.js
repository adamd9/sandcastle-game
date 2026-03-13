import {
  ZONES,
  ACTIONS_PER_TICK,
  BLOCK_TYPES,
  REINFORCE_AMOUNT,
  MAX_HEALTH,
  GRID_WIDTH,
  GRID_HEIGHT,
  WATER_ROWS,
  MAX_LEVEL,
  rainDamage,
  windDamage,
  selectWeatherEvent,
  WEATHER_EVENTS,
} from './rules.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findCell(cells, x, y, level = 0) {
  return cells.find(c => c.x === x && c.y === y && c.level === level) ?? null;
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
  const level = action.level ?? 0;

  if (!inGrid(x, y)) {
    return { valid: false, reason: `Coordinates (${x},${y}) are outside the grid.` };
  }

  if (y < WATER_ROWS) {
    return { valid: false, reason: `Row y=${y} is in the water zone (rows 0–${WATER_ROWS - 1}). Build further from the ocean.` };
  }

  if (!Number.isInteger(level) || level < 0 || level > MAX_LEVEL) {
    return { valid: false, reason: `level must be 0–${MAX_LEVEL}.` };
  }

  const playerState = state.players[player];
  if (playerState.turnCommitted) {
    return { valid: false, reason: 'Turn already committed. Wait for the next tick.' };
  }
  if (playerState.actionsThisTick >= ACTIONS_PER_TICK) {
    return { valid: false, reason: `Action budget exhausted (${ACTIONS_PER_TICK} actions per tick).` };
  }

  const cell = findCell(state.cells, x, y, level);

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
      if (level > 0) {
        const foundation = state.cells.find(c => c.x === x && c.y === y && c.level === level - 1);
        if (!foundation) {
          return { valid: false, reason: `Cannot place at level ${level} — foundation missing: no block at level ${level - 1} at (${x},${y}).` };
        }
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
  const { action: type, x, y, type: blockType, level = 0 } = action;

  state.players[player].actionsThisTick += 1;

  if (!state.currentTurnMoves) state.currentTurnMoves = { player1: [], player2: [] };
  state.currentTurnMoves[player].push({ action: type, x, y, level, block_type: blockType });

  switch (type) {
    case 'PLACE': {
      state.cells.push({
        x,
        y,
        level,
        type: blockType,
        health: BLOCK_TYPES[blockType].initial_health,
        owner: player,
      });
      break;
    }
    case 'REMOVE': {
      // Remove target level and all levels above (cascade)
      state.cells = state.cells.filter(c => !(c.x === x && c.y === y && c.level >= level));
      state.flags = (state.flags || []).filter(f => !(f.x === x && f.y === y && f.level >= level));
      break;
    }
    case 'REINFORCE': {
      const cell = state.cells.find(c => c.x === x && c.y === y && c.level === level);
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
    timestamp: new Date().toISOString(),
    weather: { ...state.weather },
    moves: structuredClone(state.currentTurnMoves || { player1: [], player2: [] }),
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
    weatherEvents: [],
    cells: structuredClone(state.cells),
  };
  state.history.push(round);
  if (state.history.length > 20) state.history = state.history.slice(-20);
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

  // Use pre-set event (god mode / tests) or pick randomly
  const weatherEvent = state.weather.event
    ? (WEATHER_EVENTS.find(e => e.id === state.weather.event) ?? selectWeatherEvent())
    : selectWeatherEvent();
  state.weather.event = weatherEvent.id;
  state.weather.event_label = weatherEvent.label;

  const baseRain = rainDamage(rain_mm);
  const baseWind = windDamage(wind_speed_kph);
  const mult = weatherEvent.damageMultiplier;

  const events = [];
  let survivingCells;

  if (weatherEvent.specialEffect === 'wave_surge') {
    // Build top-block map for "other rows" standard damage
    const topBlocks = new Map();
    for (const cell of state.cells) {
      const key = `${cell.x},${cell.y}`;
      if (!topBlocks.has(key) || cell.level > topBlocks.get(key).level) {
        topBlocks.set(key, cell);
      }
    }

    // Cascade set: positions where ALL levels are destroyed
    const cascadePositions = new Set();

    // Rows WATER_ROWS to WATER_ROWS+2: direct wipe
    for (const cell of state.cells) {
      if (cell.y >= WATER_ROWS && cell.y <= WATER_ROWS + 2) {
        cascadePositions.add(`${cell.x},${cell.y}`);
      }
    }

    // Rows WATER_ROWS+3 to WATER_ROWS+5: 40 damage to L0; if L0 dies → cascade
    for (const cell of state.cells) {
      if (cell.y >= WATER_ROWS + 3 && cell.y <= WATER_ROWS + 5 && cell.level === 0) {
        if (cell.health - 40 <= 0) {
          cascadePositions.add(`${cell.x},${cell.y}`);
        }
      }
    }

    survivingCells = [];
    for (const cell of state.cells) {
      const posKey = `${cell.x},${cell.y}`;
      const healthBefore = cell.health;

      if (cascadePositions.has(posKey)) {
        events.push({
          type: 'destroyed',
          cascade: cell.y >= WATER_ROWS + 3,
          x: cell.x, y: cell.y, level: cell.level, owner: cell.owner, block_type: cell.type,
          rain_damage: healthBefore, wind_damage: 0, total_damage: healthBefore,
          health_before: healthBefore, health_after: 0,
          event: weatherEvent.id,
        });
      } else if (cell.y >= WATER_ROWS + 3 && cell.y <= WATER_ROWS + 5 && cell.level === 0) {
        // L0 survived the 40 damage
        const healthAfter = cell.health - 40;
        events.push({
          type: 'damaged',
          x: cell.x, y: cell.y, level: cell.level, owner: cell.owner, block_type: cell.type,
          rain_damage: 40, wind_damage: 0, total_damage: 40,
          health_before: healthBefore, health_after: healthAfter,
          event: weatherEvent.id,
        });
        survivingCells.push({ ...cell, health: healthAfter });
      } else if (cell.y >= WATER_ROWS + 3 && cell.y <= WATER_ROWS + 5 && cell.level > 0) {
        // Upper levels sheltered by surviving L0 — no damage
        survivingCells.push(cell);
      } else {
        // Other rows — top block takes standard rain damage; lower levels sheltered
        const isTop = topBlocks.get(posKey) === cell;
        if (isTop) {
          const rainDmg = Math.round(baseRain * mult);
          const healthAfter = healthBefore - rainDmg;
          if (rainDmg > 0) {
            events.push({
              type: healthAfter <= 0 ? 'destroyed' : 'damaged',
              x: cell.x, y: cell.y, level: cell.level, owner: cell.owner, block_type: cell.type,
              rain_damage: rainDmg, wind_damage: 0, total_damage: rainDmg,
              health_before: healthBefore, health_after: healthAfter,
              event: weatherEvent.id,
            });
          }
          if (healthAfter > 0) survivingCells.push({ ...cell, health: healthAfter });
        } else {
          survivingCells.push(cell);
        }
      }
    }

  } else if (weatherEvent.specialEffect === 'rogue_wave') {
    // Pick 1–2 random columns and obliterate all levels in them
    const numCols = Math.random() < 0.5 ? 1 : 2;
    const cols = new Set();
    while (cols.size < numCols) cols.add(Math.floor(Math.random() * GRID_WIDTH));

    // Top-block map for unaffected columns
    const topBlocks = new Map();
    for (const cell of state.cells) {
      if (!cols.has(cell.x)) {
        const key = `${cell.x},${cell.y}`;
        if (!topBlocks.has(key) || cell.level > topBlocks.get(key).level) {
          topBlocks.set(key, cell);
        }
      }
    }

    survivingCells = [];
    for (const cell of state.cells) {
      const healthBefore = cell.health;
      if (cols.has(cell.x)) {
        events.push({
          type: 'destroyed',
          x: cell.x, y: cell.y, level: cell.level, owner: cell.owner, block_type: cell.type,
          rain_damage: healthBefore, wind_damage: 0, total_damage: healthBefore,
          health_before: healthBefore, health_after: 0,
          event: weatherEvent.id,
          rogue_cols: [...cols],
        });
      } else {
        const key = `${cell.x},${cell.y}`;
        const isTop = topBlocks.get(key) === cell;
        if (isTop) {
          const rainDmg = Math.round(baseRain * mult);
          const healthAfter = healthBefore - rainDmg;
          if (rainDmg > 0) {
            events.push({
              type: healthAfter <= 0 ? 'destroyed' : 'damaged',
              x: cell.x, y: cell.y, level: cell.level, owner: cell.owner, block_type: cell.type,
              rain_damage: rainDmg, wind_damage: 0, total_damage: rainDmg,
              health_before: healthBefore, health_after: healthAfter,
              event: weatherEvent.id,
              rogue_cols: [...cols],
            });
          }
          if (healthAfter > 0) survivingCells.push({ ...cell, health: healthAfter });
        } else {
          survivingCells.push(cell);
        }
      }
    }

  } else {
    // Normal / calm / storm — only the TOP block per (x,y) is exposed to weather
    const topBlocks = new Map();
    for (const cell of state.cells) {
      const key = `${cell.x},${cell.y}`;
      if (!topBlocks.has(key) || cell.level > topBlocks.get(key).level) {
        topBlocks.set(key, cell);
      }
    }

    survivingCells = [];
    for (const cell of state.cells) {
      const key = `${cell.x},${cell.y}`;
      const isTop = topBlocks.get(key) === cell;

      if (isTop) {
        const rainDmg = Math.round(baseRain * mult);
        const rawWind = (baseWind > 0 && (weatherEvent.windAffectsAll || isWindwardEdge(cell.x, cell.y, wind_direction)))
          ? baseWind : 0;
        const windDmg = Math.round(rawWind * mult);
        const totalDamage = rainDmg + windDmg;
        const healthBefore = cell.health;
        const healthAfter = cell.health - totalDamage;
        if (totalDamage > 0) {
          events.push({
            type: healthAfter <= 0 ? 'destroyed' : 'damaged',
            x: cell.x, y: cell.y, level: cell.level, owner: cell.owner, block_type: cell.type,
            rain_damage: rainDmg, wind_damage: windDmg, total_damage: totalDamage,
            health_before: healthBefore, health_after: healthAfter,
            event: weatherEvent.id,
          });
        }
        if (healthAfter > 0) survivingCells.push({ ...cell, health: healthAfter });
      } else {
        // Sheltered by block above — no damage
        survivingCells.push(cell);
      }
    }
  }

  state.cells = survivingCells;
  state.weatherEvents = events;

  // Remove flags whose host block was destroyed this tick
  const destroyedSet = new Set(
    events.filter(e => e.type === 'destroyed').map(e => `${e.x},${e.y},${e.level}`)
  );
  state.flags = (state.flags || []).filter(
    f => !destroyedSet.has(`${f.x},${f.y},${f.level}`)
  );

  // Reset action counters and move tracking
  for (const player of Object.keys(state.players)) {
    state.players[player].actionsThisTick = 0;
    state.players[player].turnCommitted = false;
  }
  state.currentTurnMoves = { player1: [], player2: [] };

  state.tick += 1;
  state.lastUpdated = new Date().toISOString();
  return state;
}
