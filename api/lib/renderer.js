import { createCanvas } from '@napi-rs/canvas';
import { GRID_WIDTH, GRID_HEIGHT, WATER_ROWS, BLOCK_TYPES, MAX_LEVEL, REINFORCE_AMOUNT } from './rules.js';
import { buildFlagProtectedSet, buildFlagCoverage, computeStructureScore } from './gameLogic.js';

const BLOCK_DRAW_COLORS = {
  packed_sand: { player1: '#8b6914', player2: '#4a7c14' },
  wet_sand:    { player1: '#c49a28', player2: '#6aab28' },
  dry_sand:    { player1: '#e8d5a3', player2: '#a3e8a3' },
  moat:        { player1: '#2a8c80', player2: '#2a8c80' }, // ocean-matching teal water channel
  courtyard:   { player1: '#b5813a', player2: '#7a9e4a' }, // warm terracotta / olive paved floor
  parapet:     { player1: '#6b4226', player2: '#2e5e26' }, // dark stone battlements
};

// Depth-tiered moat colors: shallow (1) = teal, standard (2) = deeper blue-green, deep (3) = dark blue
const MOAT_DEPTH_COLORS = {
  1: '#2a8c80',
  2: '#1a6070',
  3: '#0d3b52',
};

const FLAG_COLORS = { player1: '#4fc3f7', player2: '#ef9a9a', god: '#f5d87a' };

// Health tier thresholds (as a fraction of max HP)
const HEALTH_TIER_HEALTHY  = 0.8;  // > 80 % HP  → green
const HEALTH_TIER_MODERATE = 0.5;  // 50–80 % HP → yellow
const HEALTH_TIER_DAMAGED  = 0.25; // 25–50 % HP → orange  (≤ 25 % → red)

/**
 * Render the game board as a PNG buffer.
 * @param {object} state - Game state with .cells and .flags arrays.
 * @param {object} [options]
 * @param {'full'|'player1'|'player2'} [options.view='full']
 * @param {number} [options.cellSize=30]
 * @param {boolean} [options.show_flags=false] - When true, highlights flag-protected blocks
 *   with a golden tint and border, dims unprotected blocks, and overlays the flag label
 *   on each block in the protected connected component.
 * @returns {Promise<Buffer>} PNG image buffer.
 */
export async function renderBoard(state, options = {}) {
  const { view = 'full', cellSize = 30, show_flags = false } = options;
  const CS = cellSize;

  // Determine visible column range and coordinate offset
  let colMin = 0;
  let colMax = GRID_WIDTH - 1;
  let xOffset = 0;
  if (view === 'player1') { colMax = 9; }
  if (view === 'player2') { colMin = 10; xOffset = -10 * CS; }
  const visibleCols = colMax - colMin + 1;

  const canvasW = visibleCols * CS;
  const canvasH = GRID_HEIGHT * CS;

  const canvas = createCanvas(canvasW, canvasH);
  const ctx = canvas.getContext('2d');

  const GRID_W = GRID_WIDTH;
  const GRID_H = GRID_HEIGHT;

  // Helper: translate grid x to pixel x (accounting for player2 crop offset)
  const px = (gx) => gx * CS + xOffset;

  // --- 1. Background grid (skip water rows) ---
  for (let gy = WATER_ROWS; gy < GRID_H; gy++) {
    for (let gx = colMin; gx <= colMax; gx++) {
      ctx.fillStyle = gx < 10 ? '#1a1200' : '#0d1a00';
      ctx.fillRect(px(gx), gy * CS, CS, CS);
      ctx.strokeStyle = '#2a1f00';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(px(gx) + 0.5, gy * CS + 0.5, CS - 1, CS - 1);
    }
  }

  // --- 2. Water zone (rows 0..WATER_ROWS-1) ---
  const waterGrad = ctx.createLinearGradient(0, 0, 0, WATER_ROWS * CS);
  waterGrad.addColorStop(0, '#0d3b8a');
  waterGrad.addColorStop(0.6, '#1a6dbf');
  waterGrad.addColorStop(1, '#2a9de0');
  ctx.fillStyle = waterGrad;
  ctx.fillRect(0, 0, canvasW, WATER_ROWS * CS);

  // Wave lines
  ctx.strokeStyle = 'rgba(180,230,255,0.25)';
  ctx.lineWidth = 1;
  for (let row = 0; row < WATER_ROWS; row++) {
    const cy = row * CS + CS * 0.55;
    ctx.beginPath();
    for (let wx = 0; wx <= canvasW; wx++) {
      // Use absolute grid x for consistent sine phase across views
      const absWx = wx - xOffset;
      const wy = cy + Math.sin((absWx / 18) + row * 2.1) * 2.5;
      if (wx === 0) ctx.moveTo(wx, wy);
      else ctx.lineTo(wx, wy);
    }
    ctx.stroke();
  }

  // OCEAN label
  ctx.fillStyle = 'rgba(200,235,255,0.55)';
  ctx.font = `bold ${Math.round(11 * CS / 30)}px Courier New`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('~ OCEAN ~', canvasW / 2, (WATER_ROWS * CS) / 2 + 4);

  // --- 3. Shoreline ---
  const shoreY = WATER_ROWS * CS;
  const shoreGrad = ctx.createLinearGradient(0, shoreY - 4, 0, shoreY + 6);
  shoreGrad.addColorStop(0, 'rgba(160,220,255,0.6)');
  shoreGrad.addColorStop(0.5, 'rgba(220,240,255,0.35)');
  shoreGrad.addColorStop(1, 'rgba(220,210,180,0)');
  ctx.fillStyle = shoreGrad;
  ctx.fillRect(0, shoreY - 4, canvasW, 10);

  // --- 4. Zone divider (only visible in full view) ---
  if (view === 'full') {
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(10 * CS, WATER_ROWS * CS);
    ctx.lineTo(10 * CS, GRID_H * CS);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // --- 5. Blocks ---
  const cells = state.cells || [];
  const flags = state.flags || [];
  const levelSizes = [CS, Math.round(CS * 0.73), Math.round(CS * 0.53), Math.round(CS * 0.33)];

  // Compute which cells are in a flag-protected connected component
  const flagProtectedSet = buildFlagProtectedSet(cells, flags);

  // Build block-key → flag-label map for the show_flags overlay
  const flagBlockLabelMap = new Map(); // "x,y,level" -> label string
  if (show_flags) {
    const coverage = buildFlagCoverage(cells, flags);
    for (const { flag, protected_blocks } of coverage) {
      const label = flag.label || '';
      for (const block of protected_blocks) {
        const key = `${block.x},${block.y},${block.level}`;
        if (!flagBlockLabelMap.has(key)) {
          flagBlockLabelMap.set(key, label);
        }
      }
    }
  }

  // --- 4.5. Courtyard overlays ---
  // Highlight empty cells that are fully enclosed within each player's structure
  const COURTYARD_COLORS = {
    player1: 'rgba(255, 195, 50, 0.15)',
    player2: 'rgba(100, 200, 100, 0.15)',
  };
  for (const player of ['player1', 'player2']) {
    const { courtyard_cells } = computeStructureScore(cells, player, flags);
    ctx.fillStyle = COURTYARD_COLORS[player];
    for (const [gx, gy] of courtyard_cells) {
      if (gx < colMin || gx > colMax || gy < WATER_ROWS) continue;
      ctx.fillRect(px(gx), gy * CS, CS, CS);
    }
  }

  // Group by (x,y) and sort by level ascending
  const cellMap = new Map();
  for (const cell of cells) {
    if (cell.x < colMin || cell.x > colMax) continue;
    const key = `${cell.x},${cell.y}`;
    if (!cellMap.has(key)) cellMap.set(key, []);
    cellMap.get(key).push(cell);
  }

  for (const group of cellMap.values()) {
    group.sort((a, b) => a.level - b.level);
    for (const cell of group) {
      const { x: gx, y: gy, type, owner, level, health } = cell;
      const sz = levelSizes[Math.min(level, MAX_LEVEL)];
      const isMoat = type === 'moat';
      // Moats fill the full cell — edges level with ground, center depressed
      const drawSize = isMoat ? CS : sz;
      const ox = isMoat ? px(gx) : px(gx) + (CS - drawSize) / 2;
      const oy = isMoat ? gy * CS : gy * CS + (CS - drawSize) / 2;

      const maxHp = (BLOCK_TYPES[type] && BLOCK_TYPES[type].initial_health) || 25;
      // Moat is permanent (health=0) — render at full opacity to distinguish from damaged blocks
      const hpFrac = type === 'moat' ? 1 : Math.max(0, health / maxHp);
      ctx.globalAlpha = 0.4 + hpFrac * 0.6;

      const colors = BLOCK_DRAW_COLORS[type];
      ctx.fillStyle = isMoat
        ? (MOAT_DEPTH_COLORS[cell.moatDepth || 1] ?? MOAT_DEPTH_COLORS[1])
        : ((colors && colors[owner]) || '#888888');
      ctx.fillRect(ox, oy, drawSize, drawSize);

      ctx.globalAlpha = 1;
      if (isMoat) {
        // Reverse emboss: shadow on top/left (depression), highlight on bottom/right
        const rimW = Math.max(1, Math.round(CS * 0.1));
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(ox, oy, drawSize, rimW);           // top shadow
        ctx.fillRect(ox, oy, rimW, drawSize);           // left shadow
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(ox, oy + drawSize - rimW, drawSize, rimW);  // bottom highlight
        ctx.fillRect(ox + drawSize - rimW, oy, rimW, drawSize);  // right highlight
        // Subtle ripple lines
        ctx.strokeStyle = 'rgba(180,240,255,0.3)';
        ctx.lineWidth = 0.6;
        for (let ri = 0; ri < 3; ri++) {
          const ry = oy + drawSize * (0.3 + ri * 0.2);
          ctx.beginPath();
          ctx.moveTo(ox + rimW, ry);
          ctx.bezierCurveTo(ox + drawSize * 0.33, ry - 1.5, ox + drawSize * 0.66, ry + 1.5, ox + drawSize - rimW, ry);
          ctx.stroke();
        }
      } else {
        ctx.strokeStyle = level === 0 ? '#ffffff22' : '#ffffff44';
        ctx.lineWidth = level === 0 ? 0.5 : 1;
        ctx.strokeRect(ox + 0.5, oy + 0.5, drawSize - 1, drawSize - 1);

        // Height gradient shading: progressively darken higher levels so spires stand out
        if (level > 0) {
          const LEVEL_SHADE = [0, 0.12, 0.24, 0.36];
          ctx.globalAlpha = LEVEL_SHADE[Math.min(level, MAX_LEVEL)];
          ctx.fillStyle = '#000000';
          ctx.fillRect(ox, oy, drawSize, drawSize);
          ctx.globalAlpha = 1;
        }

        // Crenellation rendering for parapet blocks
        if (type === 'parapet') {
          const merlonW = Math.max(2, Math.round(drawSize * 0.18));
          const merlonH = Math.max(2, Math.round(drawSize * 0.22));
          const gap = Math.max(1, Math.round(drawSize * 0.12));
          const merlonColor = (colors && colors[owner]) || '#888888';
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = merlonColor;
          // Draw 3 merlons across the top of the block
          const totalMerlonW = merlonW * 3 + gap * 2;
          const startX = ox + (drawSize - totalMerlonW) / 2;
          for (let m = 0; m < 3; m++) {
            ctx.fillRect(startX + m * (merlonW + gap), oy, merlonW, merlonH);
          }
          ctx.globalAlpha = 1;
        }
      }

      // Flag-protected component overlay: tint matching flag colour.
      // In show_flags mode: strong golden glow + border; otherwise faint tint.
      if (flagProtectedSet.has(`${gx},${gy},${level}`)) {
        if (show_flags) {
          ctx.globalAlpha = 0.40;
          ctx.fillStyle = '#ffd700';
          ctx.fillRect(ox, oy, drawSize, drawSize);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = 'rgba(255,215,0,0.75)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(ox + 0.75, oy + 0.75, drawSize - 1.5, drawSize - 1.5);
        } else {
          const tintColor = FLAG_COLORS[owner] || FLAG_COLORS.god;
          ctx.globalAlpha = 0.18;
          ctx.fillStyle = tintColor;
          ctx.fillRect(ox, oy, drawSize, drawSize);
          ctx.globalAlpha = 1;
        }
      } else if (show_flags) {
        // Dim non-protected blocks so protected ones stand out
        ctx.globalAlpha = 0.40;
        ctx.fillStyle = '#000000';
        ctx.fillRect(ox, oy, drawSize, drawSize);
        ctx.globalAlpha = 1;
      }
    }
  }

  // --- 5b. Critical HP indicators ---
  // Draw a small red warning triangle in the top-left corner of each cell
  // whose topmost block has HP ≤ REINFORCE_AMOUNT (≤15) — signalling urgent need.
  for (const group of cellMap.values()) {
    const topCell = group[group.length - 1]; // sorted ascending by level
    const { x: gx, y: gy, type, health } = topCell;
    if (type !== 'moat' && health <= REINFORCE_AMOUNT) {
      const iconSize = Math.max(5, Math.round(CS * 0.2));
      const iconX = px(gx) + 2;
      const iconY = gy * CS + 2;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#ff4444';
      ctx.beginPath();
      ctx.moveTo(iconX, iconY);
      ctx.lineTo(iconX + iconSize, iconY);
      ctx.lineTo(iconX + iconSize / 2, iconY + iconSize);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // --- 5c. Health bar mini-overlays + HP value text ---
  // Draw a 5px health bar at the bottom of each occupied cell using a 4-tier colour scheme:
  //   Green  > 80 % HP  — healthy
  //   Yellow 50–80 % HP — moderate damage
  //   Orange 25–50 % HP — significant damage
  //   Red    ≤ 25 % HP  — critical
  // Also render the actual HP number inside the cell when there is enough room (cellSize ≥ 20).
  const HEALTH_BAR_H = 5;
  for (const group of cellMap.values()) {
    const topCell = group[group.length - 1]; // already sorted ascending by level
    const { x: gx, y: gy, type: topType, health: topHealth } = topCell;
    if (topType === 'moat') continue; // moats are permanent — no health bar needed
    const maxHp = (BLOCK_TYPES[topType] && BLOCK_TYPES[topType].initial_health) || 25;
    const hpFrac = Math.max(0, Math.min(1, topHealth / maxHp));
    const barW = Math.round(CS * hpFrac);
    const barX = px(gx);
    const barY = gy * CS + CS - HEALTH_BAR_H;
    // Background track
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#222222';
    ctx.fillRect(barX, barY, CS, HEALTH_BAR_H);
    // 4-tier fill colour based on HP percentage
    let barColor;
    if (hpFrac > HEALTH_TIER_HEALTHY) {
      barColor = '#4caf50'; // green  — healthy
    } else if (hpFrac > HEALTH_TIER_MODERATE) {
      barColor = '#ffeb3b'; // yellow — moderate damage
    } else if (hpFrac > HEALTH_TIER_DAMAGED) {
      barColor = '#ff9800'; // orange — significant damage
    } else {
      barColor = '#f44336'; // red    — critical
    }
    ctx.fillStyle = barColor;
    ctx.fillRect(barX, barY, barW, HEALTH_BAR_H);
    ctx.globalAlpha = 1;

    // HP value text — only draw when cell is large enough to be legible
    if (CS >= 20) {
      const fontSize = Math.max(7, Math.round(CS * 0.25));
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tx = px(gx) + CS / 2;
      const ty = gy * CS + CS / 2;
      // Dark shadow for readability over any block colour
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = '#000000';
      ctx.fillText(String(topHealth), tx + 1, ty + 1);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(String(topHealth), tx, ty);
    }
  }

  // --- 5d. Most-damaged block indicator per player zone ---
  // Draw a pulsing diamond outline around the single most-damaged (lowest hpFrac)
  // non-moat block in each player's zone to make the critical block instantly visible.
  for (const player of ['player1', 'player2']) {
    let worstCell = null;
    let worstFrac = Infinity;
    for (const group of cellMap.values()) {
      const topCell = group[group.length - 1];
      if (topCell.owner !== player || topCell.type === 'moat') continue;
      const maxHp = (BLOCK_TYPES[topCell.type] && BLOCK_TYPES[topCell.type].initial_health) || 25;
      const frac = topCell.health / maxHp;
      if (frac < worstFrac) {
        worstFrac = frac;
        worstCell = topCell;
      }
    }
    // Only highlight when the worst block is genuinely damaged (< 100 % HP)
    if (worstCell && worstFrac < 1) {
      const { x: gx, y: gy } = worstCell;
      const cx = px(gx) + CS / 2;
      const cy = gy * CS + CS / 2;
      const r = CS * 0.46;
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = '#ff4444';
      ctx.lineWidth = Math.max(1.5, CS * 0.06);
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);       // top
      ctx.lineTo(cx + r, cy);       // right
      ctx.lineTo(cx, cy + r);       // bottom
      ctx.lineTo(cx - r, cy);       // left
      ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // --- 5e. Flag coverage label overlays (show_flags mode) ---
  // In show_flags mode, render the protecting flag's name as a small text
  // overlay in the centre of each protected block, so players can see at a
  // glance which flag covers which block without cross-referencing the JSON.
  if (show_flags && flagBlockLabelMap.size > 0) {
    const labelFontSize = Math.max(5, Math.round(7 * CS / 30));
    ctx.font = `${labelFontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const group of cellMap.values()) {
      for (const cell of group) {
        const { x: gx, y: gy, level } = cell;
        const label = flagBlockLabelMap.get(`${gx},${gy},${level}`);
        if (!label) continue;
        const sz = levelSizes[Math.min(level, MAX_LEVEL)];
        const isMoat = cell.type === 'moat';
        const drawSize = isMoat ? CS : sz;
        if (drawSize < 14) continue; // too small to fit readable text
        const ox = isMoat ? px(gx) : px(gx) + (CS - drawSize) / 2;
        const oy = isMoat ? gy * CS : gy * CS + (CS - drawSize) / 2;
        const maxChars = Math.max(3, Math.floor(drawSize / (labelFontSize * 0.6)));
        const displayLabel = label.length > maxChars ? label.slice(0, maxChars - 1) + '…' : label;
        const tx = ox + drawSize / 2;
        const ty = oy + drawSize / 2;
        // Shadow
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillText(displayLabel, tx + 0.5, ty + 0.5);
        // Label text in white for contrast on the golden tint
        ctx.fillStyle = '#ffffff';
        ctx.fillText(displayLabel, tx, ty);
        ctx.globalAlpha = 1;
      }
    }
  }

  // --- 6. Flags ---
  // Pick highest-level flag per (x,y)
  const flagMap = new Map();
  for (const f of flags) {
    if (f.x < colMin || f.x > colMax) continue;
    const key = `${f.x},${f.y}`;
    const existing = flagMap.get(key);
    if (!existing || f.level > existing.level) flagMap.set(key, f);
  }

  for (const flag of flagMap.values()) {
    const color = FLAG_COLORS[flag.owner] || FLAG_COLORS.god;
    const fpx = px(flag.x) + CS - 4;
    const fpy = flag.y * CS + 2;

    // Flagpole
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(fpx, fpy);
    ctx.lineTo(fpx, fpy + 8);
    ctx.stroke();

    // Pennant triangle
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(fpx, fpy);
    ctx.lineTo(fpx - 5, fpy + 2);
    ctx.lineTo(fpx, fpy + 4);
    ctx.closePath();
    ctx.fill();

    // Label text (shadow emulation: dark text offset, then colored text)
    if (flag.label) {
      const fontSize = Math.round(11 * CS / 30);
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const tx = px(flag.x) + CS / 2;
      const ty = flag.y * CS + CS - 1;

      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillText(flag.label, tx + 1, ty + 1);
      ctx.fillStyle = color;
      ctx.fillText(flag.label, tx, ty);
    }
  }

  // --- 7. Zone labels ---
  const labelFontSize = Math.round(11 * CS / 30);
  ctx.font = `bold ${labelFontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  const labelY = WATER_ROWS * CS + 12;

  if (view === 'full') {
    ctx.fillText('PLAYER 1', (10 * CS) / 2, labelY);
    ctx.fillText('PLAYER 2', 10 * CS + (10 * CS) / 2, labelY);
  } else if (view === 'player1') {
    ctx.fillText('PLAYER 1', canvasW / 2, labelY);
  } else if (view === 'player2') {
    ctx.fillText('PLAYER 2', canvasW / 2, labelY);
  }

  return canvas.toBuffer('image/png');
}
