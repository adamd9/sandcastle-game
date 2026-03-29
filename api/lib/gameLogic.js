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
  COURTYARD_TOWER_BONUS,
  PRESTIGE_LEVEL_MULTIPLIERS,
  STRUCTURAL_DEPTH_BONUS,
} from './rules.js';

// ---------------------------------------------------------------------------
// computeStructureScore — live score formula for a player's current structure
// ---------------------------------------------------------------------------

export function computeStructureScore(cells, player, flags = []) {
  const playerCells = cells.filter(c => c.owner === player);

  // (1) Total block count
  const total_blocks = playerCells.length;

  // (2) Total block HP remaining (resilience)
  const total_hp = playerCells.reduce((sum, c) => sum + c.health, 0);

  // (3) Average health per block, rounded to 1 decimal place (0 if no blocks)
  const avg_health = total_blocks > 0
    ? Math.round((total_hp / total_blocks) * 10) / 10
    : 0;

  // (4) Max height achieved (highest level + 1; level 0 = height 1)
  const max_height = total_blocks > 0
    ? Math.max(...playerCells.map(c => c.level)) + 1
    : 0;

  // (5) Footprint: number of distinct (x,y) cells with at least one block
  const occupiedSet = new Set(playerCells.map(c => `${c.x},${c.y}`));
  const footprint = occupiedSet.size;

  // (6) Perimeter: number of exposed outer edges of the 2D footprint.
  //     A wider, more spread-out castle scores higher than a simple column.
  const DX = [-1, 0, 1, 0];
  const DY = [0, -1, 0, 1];
  let perimeter = 0;
  for (const key of occupiedSet) {
    const [px, py] = key.split(',').map(Number);
    for (let d = 0; d < 4; d++) {
      if (!occupiedSet.has(`${px + DX[d]},${py + DY[d]}`)) {
        perimeter++;
      }
    }
  }

  // (7) Height variety: number of distinct building levels in use.
  //     Having blocks at L0 walls + L2 towers + L3 spires scores more than
  //     uniform stacking.
  const height_variety = new Set(playerCells.map(c => c.level)).size;

  // (8) Architectural complexity: number of (x,y) positions with 2+ stacked blocks.
  //     Rewards multi-level towers over single-level spreading.
  const byPos = new Map();
  for (const c of playerCells) {
    const posKey = `${c.x},${c.y}`;
    byPos.set(posKey, (byPos.get(posKey) || 0) + 1);
  }
  const architectural_complexity = [...byPos.values()].filter(count => count > 1).length;

  // (9) Perimeter integrity: percentage (0–100, 1 decimal) of the buildable zone
  //     boundary positions that have at least one block.
  const zone = ZONES[player];
  const buildableYMin = WATER_ROWS;
  const buildableYMax = GRID_HEIGHT - 1;
  const perimeterSet = new Set();
  for (let x = zone.x_min; x <= zone.x_max; x++) {
    perimeterSet.add(`${x},${buildableYMin}`);
    perimeterSet.add(`${x},${buildableYMax}`);
  }
  for (let y = buildableYMin + 1; y < buildableYMax; y++) {
    perimeterSet.add(`${zone.x_min},${y}`);
    perimeterSet.add(`${zone.x_max},${y}`);
  }
  let occupiedPerimeterCount = 0;
  for (const key of perimeterSet) {
    if (occupiedSet.has(key)) occupiedPerimeterCount++;
  }
  const perimeter_integrity = perimeterSet.size > 0
    ? Math.round((occupiedPerimeterCount / perimeterSet.size) * 1000) / 10
    : 0;

  // (10) Flag diversity: number of distinct named structures (flags).
  //      Each flag must be spatially separated (enforced by FLAG_MIN_SPACING),
  //      so more flags indicate a richer, multi-part castle design.
  const flag_diversity = flags.filter(f => f.owner === player).length;

  // (11) Courtyard bonus: empty cells fully enclosed within the player's structure.
  //      Uses a flood-fill from the zone boundary — any empty cell in the zone that
  //      is NOT reachable from the boundary counts as an enclosed courtyard cell.

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
  const courtyard_cells = [];
  for (let x = zone.x_min; x <= zone.x_max; x++) {
    for (let y = 0; y < GRID_HEIGHT; y++) {
      const key = `${x},${y}`;
      if (!occupiedSet.has(key) && !visited.has(key)) {
        courtyard_bonus++;
        courtyard_cells.push([x, y]);
      }
    }
  }

  // (12) Prestige score: height-weighted health sum, with a structural depth bonus
  //      for complete columns (blocks at all four levels L0–L3).
  //      Level multipliers: L0=1×, L1=1.5×, L2=2×, L3=3×.
  //      Columns with all 4 levels receive an additional 25% bonus.
  //      Tower blocks (L2+) adjacent to same-owner courtyard tiles receive a
  //      25% courtyard prestige bonus on top of their normal contribution.
  const nonMoatCells = playerCells.filter(c => c.type !== 'moat');
  // Collect courtyard positions owned by the player for adjacency lookup
  const courtyardXYSet = new Set(
    playerCells.filter(c => c.type === 'courtyard').map(c => `${c.x},${c.y}`)
  );
  // Build a per-column map of level sets once to avoid repeated filtering
  const columnLevels = new Map(); // posKey → Set<level>
  const columnPrestige = new Map(); // posKey → raw prestige for that column
  for (const cell of nonMoatCells) {
    const posKey = `${cell.x},${cell.y}`;
    let contrib = cell.health * PRESTIGE_LEVEL_MULTIPLIERS[cell.level];
    // Tower blocks (L2+) adjacent to a same-owner courtyard get 25% prestige bonus
    if (cell.level >= 2 && (
      courtyardXYSet.has(`${cell.x - 1},${cell.y}`) ||
      courtyardXYSet.has(`${cell.x + 1},${cell.y}`) ||
      courtyardXYSet.has(`${cell.x},${cell.y - 1}`) ||
      courtyardXYSet.has(`${cell.x},${cell.y + 1}`)
    )) {
      contrib *= (1 + COURTYARD_TOWER_BONUS);
    }
    columnPrestige.set(posKey, (columnPrestige.get(posKey) || 0) + contrib);
    if (!columnLevels.has(posKey)) columnLevels.set(posKey, new Set());
    columnLevels.get(posKey).add(cell.level);
  }
  // Apply 25% depth bonus to fully-stacked columns
  for (const [posKey, levelsHere] of columnLevels) {
    const isFullColumn = levelsHere.has(0) && levelsHere.has(1) && levelsHere.has(2) && levelsHere.has(3);
    if (isFullColumn) {
      columnPrestige.set(posKey, columnPrestige.get(posKey) * (1 + STRUCTURAL_DEPTH_BONUS));
    }
  }
  const prestige_score = Math.round([...columnPrestige.values()].reduce((sum, s) => sum + s, 0));

  // (13) Moat courtyard bonus: non-moat blocks owned by the player that are fully
  //      enclosed within the moat perimeter — i.e., unreachable from the zone
  //      boundary without crossing a same-owner moat cell.
  const moatXYSet = new Set(playerCells.filter(c => c.type === 'moat').map(c => `${c.x},${c.y}`));
  const visitedOutside = new Set();
  const moatBfsQueue = [];

  for (let x = zone.x_min; x <= zone.x_max; x++) {
    for (let y = 0; y < GRID_HEIGHT; y++) {
      if (x === zone.x_min || x === zone.x_max || y === 0 || y === GRID_HEIGHT - 1) {
        const key = `${x},${y}`;
        if (!moatXYSet.has(key) && !visitedOutside.has(key)) {
          visitedOutside.add(key);
          moatBfsQueue.push([x, y]);
        }
      }
    }
  }
  let moatHead = 0;
  while (moatHead < moatBfsQueue.length) {
    const [cx, cy] = moatBfsQueue[moatHead++];
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d];
      const ny = cy + DY[d];
      if (nx < zone.x_min || nx > zone.x_max || ny < 0 || ny >= GRID_HEIGHT) continue;
      const key = `${nx},${ny}`;
      if (!moatXYSet.has(key) && !visitedOutside.has(key)) {
        visitedOutside.add(key);
        moatBfsQueue.push([nx, ny]);
      }
    }
  }
  let moat_courtyard_bonus = 0;
  for (const cell of nonMoatCells) {
    if (!visitedOutside.has(`${cell.x},${cell.y}`)) {
      moat_courtyard_bonus++;
    }
  }

  // (14) Longevity bonus: total ticks that L2/L3 blocks have survived at height.
  //      Each such block accumulates survivedTicks (+1 per tick) in applyWeather.
  const longevity_bonus = nonMoatCells
    .filter(c => c.level >= 2)
    .reduce((sum, c) => sum + (c.survivedTicks || 0), 0);

  return {
    total_blocks, total_hp, avg_health, max_height,
    footprint, perimeter, perimeter_integrity,
    height_variety, architectural_complexity,
    flag_diversity, courtyard_bonus, courtyard_cells,
    prestige_score, moat_courtyard_bonus, longevity_bonus,
  };
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

export function buildFlagProtectedSet(cells, flags) {
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
// buildFlagCoverage — per-flag connected component info for get_state
// Returns [{ flag, protected_blocks: [{ x, y, level, type, health }] }]
// ---------------------------------------------------------------------------

export function buildFlagCoverage(cells, flags) {
  if (!flags || flags.length === 0) return [];

  const cellsByOwner = new Map();
  for (const cell of cells) {
    if (!cellsByOwner.has(cell.owner)) cellsByOwner.set(cell.owner, []);
    cellsByOwner.get(cell.owner).push(cell);
  }

  const result = [];

  for (const [owner, ownerCells] of cellsByOwner) {
    const ownerFlags = flags.filter(f => f.owner === owner);
    if (ownerFlags.length === 0) continue;

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

    // Same (x,y) different levels are connected
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

    // Orthogonally adjacent (x,y) positions sharing any level are connected
    const DX = [-1, 0, 1, 0];
    const DY = [0, -1, 0, 1];
    for (let i = 0; i < ownerCells.length; i++) {
      const c = ownerCells[i];
      for (let d = 0; d < 4; d++) {
        const nk = `${c.x + DX[d]},${c.y + DY[d]},${c.level}`;
        if (keyToIdx.has(nk)) union(i, keyToIdx.get(nk));
      }
    }

    // Build component map: root -> [cell indices]
    const componentMap = new Map();
    for (let i = 0; i < ownerCells.length; i++) {
      const root = find(i);
      if (!componentMap.has(root)) componentMap.set(root, []);
      componentMap.get(root).push(i);
    }

    // For each flag, find its component and list protected blocks
    for (const flag of ownerFlags) {
      const flagIdx = keyToIdx.get(`${flag.x},${flag.y},${flag.level}`);
      if (flagIdx === undefined) {
        result.push({ flag, protected_blocks: [] });
        continue;
      }
      const root = find(flagIdx);
      const componentIndices = componentMap.get(root) || [];
      const protected_blocks = componentIndices.map(i => {
        const c = ownerCells[i];
        return { x: c.x, y: c.y, level: c.level, type: c.type, health: c.health };
      });
      result.push({ flag, protected_blocks });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// computeDamagePreview — expected damage for each top-level block this tick
// Returns { weather_assumption, damage_per_top_block, blocks_at_risk }
// ---------------------------------------------------------------------------

export function computeDamagePreview(state) {
  const { rain_mm, wind_speed_kph, wind_direction } = state.weather;

  // Use current event if pre-set (e.g. god mode), otherwise assume normal for preview
  const currentEventId = state.weather.event;
  const weatherEvent = currentEventId
    ? (WEATHER_EVENTS.find(e => e.id === currentEventId) ?? WEATHER_EVENTS.find(e => e.id === 'normal'))
    : WEATHER_EVENTS.find(e => e.id === 'normal');

  const baseRain = rainDamage(rain_mm);
  const baseWind = windDamage(wind_speed_kph);
  const mult = weatherEvent.damageMultiplier;

  const protectedSet = buildFlagProtectedSet(state.cells, state.flags || []);
  const moatProtectedPositions = buildMoatProtectedPositions(state.cells);

  const regularCells = state.cells.filter(c => c.type !== 'moat');

  // Build top-block map: (x,y) -> highest-level block
  const topBlocks = new Map();
  for (const cell of regularCells) {
    const key = `${cell.x},${cell.y}`;
    if (!topBlocks.has(key) || cell.level > topBlocks.get(key).level) {
      topBlocks.set(key, cell);
    }
  }

  const weatherAssumption = currentEventId
    ? `${weatherEvent.id} (multiplier: ${mult}${weatherEvent.specialEffect ? ', special: ' + weatherEvent.specialEffect : ''})`
    : `normal (multiplier: 1) — actual event is randomly selected each tick`;

  const damage_per_top_block = [];

  for (const cell of topBlocks.values()) {
    const cellKey = `${cell.x},${cell.y},${cell.level}`;
    const posKey = `${cell.x},${cell.y}`;
    const isProtected = protectedSet.has(cellKey);
    const isMoatProtected = moatProtectedPositions.has(posKey);

    let expectedDamage;
    let note;

    if (weatherEvent.specialEffect === 'wave_surge') {
      if (cell.y >= WATER_ROWS && cell.y <= WATER_ROWS + 2) {
        // Rows 3–5: instant destroy unless flag-protected (→ heavy damage instead)
        if (isProtected) {
          let dmg = Math.floor(40 * FLAG_DAMAGE_REDUCTION);
          if (isMoatProtected) dmg = Math.floor(dmg * (1 - MOAT_DAMAGE_REDUCTION));
          expectedDamage = dmg;
          note = 'wave_surge: flag-protected — heavy damage instead of instant destroy';
        } else {
          expectedDamage = cell.health; // instant destroy
          note = 'wave_surge: instant destroy';
        }
      } else if (cell.y >= WATER_ROWS + 3 && cell.y <= WATER_ROWS + 5) {
        if (cell.level === 0) {
          // L0 in rows 6–8: 40 damage with reductions
          let dmg = isProtected ? Math.floor(40 * FLAG_DAMAGE_REDUCTION) : 40;
          if (isMoatProtected) dmg = Math.floor(dmg * (1 - MOAT_DAMAGE_REDUCTION));
          expectedDamage = dmg;
        } else {
          // Upper levels in rows 6–8 are sheltered if L0 survives; risk of cascade if L0 dies
          expectedDamage = 0;
          note = 'wave_surge: upper level sheltered — but L0 below may take heavy damage (cascade risk)';
        }
      } else {
        // Other rows: standard rain damage (no wind in wave_surge)
        let dmg = Math.round(baseRain * mult);
        if (isProtected) dmg = Math.floor(dmg * FLAG_DAMAGE_REDUCTION);
        if (isMoatProtected) dmg = Math.floor(dmg * (1 - MOAT_DAMAGE_REDUCTION));
        expectedDamage = dmg;
      }
    } else if (weatherEvent.specialEffect === 'rogue_wave') {
      // Columns are random — rain damage shown as minimum; actual may be total destruction
      let dmg = Math.round(baseRain * mult);
      if (isProtected) dmg = Math.floor(dmg * FLAG_DAMAGE_REDUCTION);
      if (isMoatProtected) dmg = Math.floor(dmg * (1 - MOAT_DAMAGE_REDUCTION));
      expectedDamage = dmg;
      note = 'rogue_wave: random column(s) may be completely destroyed; rain damage shown as minimum estimate';
    } else {
      // Normal / calm / storm — rain + wind to top block
      const rainDmg = Math.round(baseRain * mult);
      const rawWind = (baseWind > 0 && (weatherEvent.windAffectsAll || isWindwardEdge(cell.x, cell.y, wind_direction)))
        ? baseWind : 0;
      const windDmg = Math.round(rawWind * mult);
      let totalDamage = rainDmg + windDmg;
      if (isProtected) totalDamage = Math.floor(totalDamage * FLAG_DAMAGE_REDUCTION);
      if (isMoatProtected) totalDamage = Math.floor(totalDamage * (1 - MOAT_DAMAGE_REDUCTION));
      expectedDamage = totalDamage;
    }

    const entry = {
      x: cell.x,
      y: cell.y,
      level: cell.level,
      owner: cell.owner,
      type: cell.type,
      health: cell.health,
      expected_damage: expectedDamage,
      flag_protected: isProtected,
      moat_protected: isMoatProtected,
    };
    if (note !== undefined) entry.note = note;
    damage_per_top_block.push(entry);
  }

  const blocks_at_risk = damage_per_top_block.filter(b => b.health <= b.expected_damage);

  return {
    weather_assumption: weatherAssumption,
    damage_per_top_block,
    blocks_at_risk,
  };
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
      if (blockType === 'courtyard' && level > 0) {
        return { valid: false, reason: 'Courtyard blocks cannot be stacked — they can only be placed at level 0.' };
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
  // In-memory history is unbounded; cosmos.js trims to MAX_HISTORY_IN_STORE on every save.
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

  // Increment survivedTicks for L2/L3 non-moat blocks that survived this tick
  for (const cell of state.cells) {
    if (cell.level >= 2 && cell.type !== 'moat') {
      cell.survivedTicks = (cell.survivedTicks || 0) + 1;
    }
  }

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
