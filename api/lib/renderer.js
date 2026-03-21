import { createCanvas } from '@napi-rs/canvas';
import { GRID_WIDTH, GRID_HEIGHT, WATER_ROWS, BLOCK_TYPES, MAX_LEVEL, REINFORCE_AMOUNT } from './rules.js';
import { buildFlagProtectedSet } from './gameLogic.js';

const BLOCK_DRAW_COLORS = {
  packed_sand: { player1: '#8b6914', player2: '#4a7c14' },
  wet_sand:    { player1: '#c49a28', player2: '#6aab28' },
  dry_sand:    { player1: '#e8d5a3', player2: '#a3e8a3' },
  moat:        { player1: '#1a6dbf', player2: '#1a6dbf' }, // blue water channel
};

const FLAG_COLORS = { player1: '#4fc3f7', player2: '#ef9a9a', god: '#f5d87a' };

/**
 * Render the game board as a PNG buffer.
 * @param {object} state - Game state with .cells and .flags arrays.
 * @param {object} [options]
 * @param {'full'|'player1'|'player2'} [options.view='full']
 * @param {number} [options.cellSize=30]
 * @returns {Promise<Buffer>} PNG image buffer.
 */
export async function renderBoard(state, options = {}) {
  const { view = 'full', cellSize = 30 } = options;
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
      const ox = px(gx) + (CS - sz) / 2;
      const oy = gy * CS + (CS - sz) / 2;

      const maxHp = (BLOCK_TYPES[type] && BLOCK_TYPES[type].initial_health) || 25;
      // Moat is permanent (health=0) — render at full opacity to distinguish from damaged blocks
      const hpFrac = type === 'moat' ? 1 : Math.max(0, health / maxHp);
      ctx.globalAlpha = 0.4 + hpFrac * 0.6;

      const colors = BLOCK_DRAW_COLORS[type];
      ctx.fillStyle = (colors && colors[owner]) || '#888888';
      ctx.fillRect(ox, oy, sz, sz);

      // Moat: add a ripple overlay to suggest water
      if (type === 'moat') {
        ctx.globalAlpha = 0.25;
        ctx.strokeStyle = 'rgba(180,230,255,0.8)';
        ctx.lineWidth = 0.8;
        for (let ri = 0; ri < 3; ri++) {
          const ry = oy + sz * (0.3 + ri * 0.2);
          ctx.beginPath();
          ctx.moveTo(ox, ry);
          ctx.bezierCurveTo(ox + sz * 0.33, ry - 2, ox + sz * 0.66, ry + 2, ox + sz, ry);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      ctx.globalAlpha = 1;
      ctx.strokeStyle = level === 0 ? '#ffffff22' : '#ffffff44';
      ctx.lineWidth = level === 0 ? 0.5 : 1;
      ctx.strokeRect(ox + 0.5, oy + 0.5, sz - 1, sz - 1);

      // Flag-protected component overlay: faint tint matching flag colour
      if (flagProtectedSet.has(`${gx},${gy},${level}`)) {
        const tintColor = FLAG_COLORS[owner] || FLAG_COLORS.god;
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = tintColor;
        ctx.fillRect(ox, oy, sz, sz);
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
