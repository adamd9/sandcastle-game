import {
  ZONES,
  ACTIONS_PER_TICK,
  BLOCK_TYPES,
  VALID_ACTIONS,
  REINFORCE_AMOUNT,
  MAX_HEALTH,
  REPAIR_KIT_COOLDOWN,
  GRID_WIDTH,
  GRID_HEIGHT,
  WATER_ROWS,
  MAX_LEVEL,
  rainDamage,
  windDamage,
  selectWeatherEvent,
  WEATHER_EVENTS,
  FLAG_DAMAGE_REDUCTION,
  MOAT_DAMAGE_REDUCTION,
} from './rules.js';

// ---------------------------------------------------------------------------
// computeStructureScore — live score formula for a player's current structure
// ---------------------------------------------------------------------------

export function computeStructureScore(cells, player) {
  const playerCells = cells.filter(c => c.owner === player);

  // (1) Total block HP remaining (resilience)
  const total_hp = playerCells.reduce((sum, c) => sum + c.health, 0);

  // (2) Max height achieved (highest level + 1; level 0 = height 1)
  const max_height = playerCells.length > 0
    ? Math.max(...playerCells.map(c => c.level)) + 1
    : 0;

  // (3) Footprint: number of distinct (x,y) cells with at least one block
  const occupiedSet = new Set(playerCells.map(c => `${c.x},${c.y}`));
  const footprint = occupiedSet.size;

  // (4) Courtyard bonus: empty cells fully enclosed within the player's structure.
  //     Uses a flood-fill from the zone boundary — any empty cell in the zone that
  //     is NOT reachable from the boundary counts as an enclosed courtyard cell.
  const zone = ZONES[player];
  const DX = [-1, 0, 1, 0];
  const DY = [0, -1, 0, 1];

  const visited = new Set();
  const queue = [];

  // Seed the flood fill with all empty boundary cells of the player's zone
  for (let x = zone.x_min; x <= zone.x_max; x++) {
    for (let y = 0; y < GRID_HEIGHT; y++) {
      if (x === zone.x_min || x === zone.x_max || y === 0 || y === GRID_HEIGHT - 1) {
        const key = `${x},${y}`;
        if (!occupiedSet.has(key) && !visited.has(key)) {
          visited.add(key);
          queue.push([x, y]);
        }
      }
    }
  }

  // BFS through empty cells inside the zone
  let head = 0;
  while (head < queue.length) {
    const [cx, cy] = queue[head++];
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d];
      const ny = cy + DY[d];
      if (nx < zone.x_min || nx > zone.x_max || ny < 0 || ny >= GRID_HEIGHT) continue;
      const key = `${nx},${ny}`;
      if (!occupiedSet.has(key) && !visited.has(key)) {
        visited.add(key);
        queue.push([nx, ny]);
      }
    }
  }

  // Any empty cell in the zone that was not reached = enclosed courtyard
  let courtyard_bonus = 0;
  for (let x = zone.x_min; x <= zone.x_max; x++) {
    for (let y = 0; y < GRID_HEIGHT; y++) {
      const key = `${x},${y}`;
      if (!occupiedSet.has(key) && !visited.has(key)) {
        courtyard_bonus++;
      }
    }
  }

  return { total_hp, max_height, footprint, courtyard_bonus };
}

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
// Flag protection — connected component analysis via union-find
// ---------------------------------------------------------------------------

function buildFlagProtectedSet(cells, flags) {
  if (!flags || flags.length === 0) return new Set();

  // Index cells by owner for per-owner component analysis
  const cellsByOwner = new Map();
  for (const cell of cells) {
    if (!cellsByOwner.has(cell.owner)) cellsByOwner.set(cell.owner, []);
    cellsByOwner.get(cell.owner).push(cell);
  }

  const protectedKeys = new Set();

  for (const [owner, ownerCells] of cellsByOwner) {
    // Build adjacency: cells at same (x,y) different levels are connected;
    // cells at adjacent (x,y) sharing any level are connected.
    const keyToIdx = new Map();
    for (let i = 0; i < ownerCells.length; i++) {
      const c = ownerCells[i];
      keyToIdx.set(`${c.x},${c.y},${c.level}`, i);
    }

    // Union-Find
    const parent = ownerCells.map((_, i) => i);
    const rank = new Array(ownerCells.length).fill(0);
    function find(a) {
      while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
      return a;
    }
    function union(a, b) {
      a = find(a); b = find(b);
      if (a === b) return;
      if (rank[a] < rank[b]) [a, b] = [b, a];
      parent[b] = a;
      if (rank[a] === rank[b]) rank[a]++;
    }

    // Group cells by (x,y) — same position different levels are connected
    const byPos = new Map();
    for (let i = 0; i < ownerCells.length; i++) {
      const c = ownerCells[i];
      const posKey = `${c.x},${c.y}`;
      if (!byPos.has(posKey)) byPos.set(posKey, []);
      byPos.get(posKey).push(i);
    }
    for (const indices of byPos.values()) {
      for (let j = 1; j < indices.length; j++) union(indices[0], indices[j]);
    }

    // Adjacent (x,y) positions sharing any level are connected
    const DX = [-1, 0, 1, 0];
    const DY = [0, -1, 0, 1];
    for (let i = 0; i < ownerCells.length; i++) {
      const c = ownerCells[i];
      for (let d = 0; d < 4; d++) {
        const nk = `${c.x + DX[d]},${c.y + DY[d]},${c.level}`;
        if (keyToIdx.has(nk)) union(i, keyToIdx.get(nk));
      }
    }

    // Find which components have a flag
    const ownerFlags = flags.filter(f => f.owner === owner);
    const flaggedRoots = new Set();
    for (const f of ownerFlags) {
      const idx = keyToIdx.get(`${f.x},${f.y},${f.level}`);
      if (idx !== undefined) flaggedRoots.add(find(idx));
    }

    // Mark all cells in flagged components
    for (let i = 0; i < ownerCells.length; i++) {
      if (flaggedRoots.has(find(i))) {
        const c = ownerCells[i];
        protectedKeys.add(`${c.x},${c.y},${c.level}`);
      }
    }
  }

  return protectedKeys;
}

// ---------------------------------------------------------------------------
// Moat protection — returns Set of "x,y" positions adjacent to a same-owner moat
// ---------------------------------------------------------------------------

function buildMoatProtectedPositions(cells) {
  const moatPositions = new Map(); // "x,y" -> owner
  for (const cell of cells) {
    if (cell.type === 'moat') {
      moatPositions.set(`${cell.x},${cell.y}`, cell.owner);
    }
  }

  const DX = [-1, 0, 1, 0];
  const DY = [0, -1, 0, 1];
  const moatProtected = new Set();

  for (const cell of cells) {
    if (cell.type === 'moat') continue;
    for (let d = 0; d < 4; d++) {
      const nk = `${cell.x + DX[d]},${cell.y + DY[d]}`;
      if (moatPositions.has(nk) && moatPositions.get(nk) === cell.owner) {
        moatProtected.add(`${cell.x},${cell.y}`);
        break;
      }
    }
  }

  return moatProtected;
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
      if (blockType === 'moat' && level > 0) {
        return { valid: false, reason: 'Moat blocks cannot be stacked — they can only be placed at level 0.' };
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
      if (cell.type === 'moat') {
        return { valid: false, reason: 'Moat blocks are permanent and cannot be reinforced.' };
      }
      return { valid: true };
    }

    case 'REPAIR_KIT': {
      if (!cell) {
        return { valid: false, reason: `No block at (${x},${y}).` };
      }
      if (cell.owner !== player) {
        return { valid: false, reason: `Cell (${x},${y}) belongs to ${cell.owner}.` };
      }
      if (cell.type === 'moat') {
        return { valid: false, reason: 'Moat blocks are permanent and cannot be repaired.' };
      }
      const lastUsed = playerState.repairKitLastUsedTick;
      if (lastUsed !== undefined && lastUsed !== null && state.tick - lastUsed < REPAIR_KIT_COOLDOWN) {
        const ticksRemaining = REPAIR_KIT_COOLDOWN - (state.tick - lastUsed);
        return { valid: false, reason: `Repair Kit is on cooldown. Available in ${ticksRemaining} more tick(s).` };
      }
      return { valid: true };
    }

    default:
      return { valid: false, reason: `Unknown action "${type}". Valid actions: ${VALID_ACTIONS.join(', ')}.` };
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
    case 'REPAIR_KIT': {
      const cell = state.cells.find(c => c.x === x && c.y === y && c.level === level);
      cell.health = MAX_HEALTH;
      state.players[player].repairKitLastUsedTick = state.tick;
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
    flags_snapshot: structuredClone(state.flags || []),
  };
  state.history.push(round);
  // No cap — all history is retained. Endpoints slice as needed for consumers.
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

  // Determine which blocks are protected by flags (connected component analysis)
  const protectedSet = buildFlagProtectedSet(state.cells, state.flags || []);

  // Determine which positions are adjacent to a same-owner moat (25% damage reduction)
  const moatProtectedPositions = buildMoatProtectedPositions(state.cells);

  // Moat cells are permanent and immune to all weather — separate them before processing
  const moatCells = state.cells.filter(c => c.type === 'moat');
  const regularCells = state.cells.filter(c => c.type !== 'moat');

  const events = [];
  let survivingCells;

  if (weatherEvent.specialEffect === 'wave_surge') {
    // Build top-block map for "other rows" standard damage
    const topBlocks = new Map();
    for (const cell of regularCells) {
      const key = `${cell.x},${cell.y}`;
      if (!topBlocks.has(key) || cell.level > topBlocks.get(key).level) {
        topBlocks.set(key, cell);
      }
    }

    // Cascade set: positions where ALL levels are destroyed
    const cascadePositions = new Set();
    // Track positions in the wave surge direct-wipe zone (rows 3-5)
    const waveSurgeDirectZone = new Set();

    // Rows WATER_ROWS to WATER_ROWS+2: direct wipe (unless flag-protected)
    for (const cell of regularCells) {
      if (cell.y >= WATER_ROWS && cell.y <= WATER_ROWS + 2) {
        waveSurgeDirectZone.add(`${cell.x},${cell.y}`);
        const cellKey = `${cell.x},${cell.y},${cell.level}`;
        if (!protectedSet.has(cellKey)) {
          cascadePositions.add(`${cell.x},${cell.y}`);
        }
      }
    }

    // Rows WATER_ROWS+3 to WATER_ROWS+5: 40 damage (reduced if protected) to L0; if L0 dies → cascade
    for (const cell of regularCells) {
      if (cell.y >= WATER_ROWS + 3 && cell.y <= WATER_ROWS + 5 && cell.level === 0) {
        const cellKey = `${cell.x},${cell.y},${cell.level}`;
        const isProtected = protectedSet.has(cellKey);
        const isMoatProtected = moatProtectedPositions.has(`${cell.x},${cell.y}`);
        let dmg = isProtected ? Math.floor(40 * FLAG_DAMAGE_REDUCTION) : 40;
        if (isMoatProtected) dmg = Math.floor(dmg * (1 - MOAT_DAMAGE_REDUCTION));
        if (cell.health - dmg <= 0) {
          cascadePositions.add(`${cell.x},${cell.y}`);
        }
      }
    }

    survivingCells = [];
    for (const cell of regularCells) {
      const posKey = `${cell.x},${cell.y}`;
      const cellKey = `${cell.x},${cell.y},${cell.level}`;
      const isProtected = protectedSet.has(cellKey);
      const isMoatProtected = moatProtectedPositions.has(posKey);
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
      } else if (waveSurgeDirectZone.has(posKey) && isProtected) {
        // Flag-protected block in direct wipe zone — heavy damage instead of instant destroy
        let dmg = Math.floor(40 * FLAG_DAMAGE_REDUCTION);
        if (isMoatProtected) dmg = Math.floor(dmg * (1 - MOAT_DAMAGE_REDUCTION));
        const healthAfter = healthBefore - dmg;
        events.push({
          type: healthAfter <= 0 ? 'destroyed' : 'damaged',
          x: cell.x, y: cell.y, level: cell.level, owner: cell.owner, block_type: cell.type,
          rain_damage: dmg, wind_damage: 0, total_damage: dmg,
          health_before: healthBefore, health_after: Math.max(0, healthAfter),
          event: weatherEvent.id,
          flag_protected: true,
          ...(isMoatProtected ? { moat_protected: true } : {}),
        });
        if (healthAfter > 0) survivingCells.push({ ...cell, health: healthAfter });
      } else if (cell.y >= WATER_ROWS + 3 && cell.y <= WATER_ROWS + 5 && cell.level === 0) {
        // L0 survived the damage
        let dmg = isProtected ? Math.floor(40 * FLAG_DAMAGE_REDUCTION) : 40;
        if (isMoatProtected) dmg = Math.floor(dmg * (1 - MOAT_DAMAGE_REDUCTION));
        const healthAfter = cell.health - dmg;
        events.push({
          type: 'damaged',
          x: cell.x, y: cell.y, level: cell.level, owner: cell.owner, block_type: cell.type,
          rain_damage: dmg, wind_damage: 0, total_damage: dmg,
          health_before: healthBefore, health_after: healthAfter,
          event: weatherEvent.id,
          ...(isProtected ? { flag_protected: true } : {}),
          ...(isMoatProtected ? { moat_protected: true } : {}),
        });
        survivingCells.push({ ...cell, health: healthAfter });
      } else if (cell.y >= WATER_ROWS + 3 && cell.y <= WATER_ROWS + 5 && cell.level > 0) {
        // Upper levels sheltered by surviving L0 — no damage
        survivingCells.push(cell);
      } else {
        // Other rows — top block takes standard rain damage; lower levels sheltered
        const isTop = topBlocks.get(posKey) === cell;
        if (isTop) {
          let rainDmg = Math.round(baseRain * mult);
          if (isProtected) rainDmg = Math.floor(rainDmg * FLAG_DAMAGE_REDUCTION);
          if (isMoatProtected) rainDmg = Math.floor(rainDmg * (1 - MOAT_DAMAGE_REDUCTION));
          const healthAfter = healthBefore - rainDmg;
          if (rainDmg > 0) {
            events.push({
              type: healthAfter <= 0 ? 'destroyed' : 'damaged',
              x: cell.x, y: cell.y, level: cell.level, owner: cell.owner, block_type: cell.type,
              rain_damage: rainDmg, wind_damage: 0, total_damage: rainDmg,
              health_before: healthBefore, health_after: healthAfter,
              event: weatherEvent.id,
              ...(isProtected ? { flag_protected: true } : {}),
              ...(isMoatProtected ? { moat_protected: true } : {}),
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
    for (const cell of regularCells) {
      if (!cols.has(cell.x)) {
        const key = `${cell.x},${cell.y}`;
        if (!topBlocks.has(key) || cell.level > topBlocks.get(key).level) {
          topBlocks.set(key, cell);
        }
      }
    }

    survivingCells = [];
    for (const cell of regularCells) {
      const healthBefore = cell.health;
      const cellKey = `${cell.x},${cell.y},${cell.level}`;
      const isProtected = protectedSet.has(cellKey);
      const isMoatProtected = moatProtectedPositions.has(`${cell.x},${cell.y}`);
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
          let rainDmg = Math.round(baseRain * mult);
          if (isProtected) rainDmg = Math.floor(rainDmg * FLAG_DAMAGE_REDUCTION);
          if (isMoatProtected) rainDmg = Math.floor(rainDmg * (1 - MOAT_DAMAGE_REDUCTION));
          const healthAfter = healthBefore - rainDmg;
          if (rainDmg > 0) {
            events.push({
              type: healthAfter <= 0 ? 'destroyed' : 'damaged',
              x: cell.x, y: cell.y, level: cell.level, owner: cell.owner, block_type: cell.type,
              rain_damage: rainDmg, wind_damage: 0, total_damage: rainDmg,
              health_before: healthBefore, health_after: healthAfter,
              event: weatherEvent.id,
              rogue_cols: [...cols],
              ...(isProtected ? { flag_protected: true } : {}),
              ...(isMoatProtected ? { moat_protected: true } : {}),
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
    for (const cell of regularCells) {
      const key = `${cell.x},${cell.y}`;
      if (!topBlocks.has(key) || cell.level > topBlocks.get(key).level) {
        topBlocks.set(key, cell);
      }
    }

    survivingCells = [];
    for (const cell of regularCells) {
      const key = `${cell.x},${cell.y}`;
      const isTop = topBlocks.get(key) === cell;

      if (isTop) {
        const cellKey = `${cell.x},${cell.y},${cell.level}`;
        const isProtected = protectedSet.has(cellKey);
        const isMoatProtected = moatProtectedPositions.has(key);
        const rainDmg = Math.round(baseRain * mult);
        const rawWind = (baseWind > 0 && (weatherEvent.windAffectsAll || isWindwardEdge(cell.x, cell.y, wind_direction)))
          ? baseWind : 0;
        const windDmg = Math.round(rawWind * mult);
        let totalDamage = rainDmg + windDmg;
        if (isProtected) totalDamage = Math.floor(totalDamage * FLAG_DAMAGE_REDUCTION);
        if (isMoatProtected) totalDamage = Math.floor(totalDamage * (1 - MOAT_DAMAGE_REDUCTION));
        const healthBefore = cell.health;
        const healthAfter = cell.health - totalDamage;
        if (totalDamage > 0) {
          events.push({
            type: healthAfter <= 0 ? 'destroyed' : 'damaged',
            x: cell.x, y: cell.y, level: cell.level, owner: cell.owner, block_type: cell.type,
            rain_damage: rainDmg, wind_damage: windDmg, total_damage: totalDamage,
            health_before: healthBefore, health_after: healthAfter,
            event: weatherEvent.id,
            ...(isProtected ? { flag_protected: true } : {}),
            ...(isMoatProtected ? { moat_protected: true } : {}),
          });
        }
        if (healthAfter > 0) survivingCells.push({ ...cell, health: healthAfter });
      } else {
        // Sheltered by block above — no damage
        survivingCells.push(cell);
      }
    }
  }

  // Moat cells are permanent — add them back after weather processing
  state.cells = [...survivingCells, ...moatCells];
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
