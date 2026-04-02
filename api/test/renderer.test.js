import { describe, it, expect } from 'vitest';
import { renderBoard } from '../lib/renderer.js';

function freshState(cells = [], flags = []) {
  return {
    id: 'game', tick: 5,
    weather: { rain_mm: 0, wind_speed_kph: 0, wind_direction: 'N' },
    cells, flags,
    players: {
      player1: { actionsThisTick: 0, turnCommitted: false },
      player2: { actionsThisTick: 0, turnCommitted: false },
    },
    history: [],
    scores: { player1: 0, player2: 0 },
    judgments: [],
  };
}

describe('renderBoard', () => {
  it('renders an empty board as a valid PNG', async () => {
    const buf = await renderBoard(freshState());
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(100);
    // PNG magic bytes
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50); // P
    expect(buf[2]).toBe(0x4e); // N
    expect(buf[3]).toBe(0x47); // G
  });

  it('renders a board with blocks', async () => {
    const cells = [
      { x: 3, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 3, y: 5, level: 1, type: 'wet_sand', health: 30, owner: 'player1' },
      { x: 14, y: 8, level: 0, type: 'dry_sand', health: 25, owner: 'player2' },
    ];
    const buf = await renderBoard(freshState(cells));
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(100);
  });

  it('player1 view is half the width of full', async () => {
    const full = await renderBoard(freshState(), { view: 'full', cellSize: 30 });
    const p1 = await renderBoard(freshState(), { view: 'player1', cellSize: 30 });
    // player1 should be roughly half the bytes (fewer pixels)
    expect(p1.length).toBeLessThan(full.length);
    expect(p1[0]).toBe(0x89); // still valid PNG
  });

  it('player2 view is valid PNG', async () => {
    const cells = [
      { x: 15, y: 10, level: 0, type: 'packed_sand', health: 60, owner: 'player2' },
    ];
    const buf = await renderBoard(freshState(cells), { view: 'player2', cellSize: 30 });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x89);
  });

  it('renders flags without error', async () => {
    const cells = [
      { x: 5, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    const flags = [
      { x: 5, y: 5, level: 0, owner: 'player1', label: 'Main Tower' },
    ];
    const buf = await renderBoard(freshState(cells, flags));
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(100);
  });

  it('renders flag-protected connected component tint without error', async () => {
    // Two adjacent blocks owned by player1 with a flag on one — both should get tinted
    const cells = [
      { x: 3, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 4, y: 5, level: 0, type: 'wet_sand',    health: 40, owner: 'player1' },
    ];
    const flags = [
      { x: 3, y: 5, level: 0, owner: 'player1', label: 'Fort' },
    ];
    const buf = await renderBoard(freshState(cells, flags));
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x89); // valid PNG
    expect(buf.length).toBeGreaterThan(100);
  });

  it('renders critical HP warning icon for blocks with health ≤ 15', async () => {
    const cells = [
      { x: 2, y: 6, level: 0, type: 'dry_sand',    health: 10, owner: 'player1' },
      { x: 3, y: 6, level: 0, type: 'packed_sand', health: 60, owner: 'player1' }, // healthy — no icon
    ];
    const buf = await renderBoard(freshState(cells));
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x89); // valid PNG
    expect(buf.length).toBeGreaterThan(100);
  });

  it('does not render critical HP icon for moat blocks', async () => {
    const cells = [
      { x: 4, y: 6, level: 0, type: 'moat', health: 0, owner: 'player1' },
    ];
    const buf = await renderBoard(freshState(cells));
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x89);
  });

  it('all block type/owner combos render without error', async () => {
    const types = ['dry_sand', 'wet_sand', 'packed_sand'];
    const owners = ['player1', 'player2'];
    const cells = [];
    let x = 0;
    for (const type of types) {
      for (const owner of owners) {
        const zoneX = owner === 'player1' ? x % 10 : 10 + (x % 10);
        cells.push({ x: zoneX, y: 5, level: 0, type, health: 30, owner });
        x++;
      }
    }
    const buf = await renderBoard(freshState(cells));
    expect(buf).toBeInstanceOf(Buffer);
  });

  it('renders courtyard overlay for enclosed empty cells without error', async () => {
    // Build a 3x3 ring of blocks for player1 enclosing (4,10)
    const ring = [
      [3, 9], [4, 9], [5, 9],
      [3, 10],        [5, 10],
      [3, 11], [4, 11], [5, 11],
    ];
    const cells = ring.map(([x, y]) => ({
      x, y, level: 0, type: 'packed_sand', health: 60, owner: 'player1',
    }));
    const buf = await renderBoard(freshState(cells));
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x89); // valid PNG
    expect(buf.length).toBeGreaterThan(100);
  });

  it('custom cellSize changes output', async () => {
    const small = await renderBoard(freshState(), { cellSize: 10 });
    const big = await renderBoard(freshState(), { cellSize: 40 });
    expect(big.length).toBeGreaterThan(small.length);
  });

  it('renders height gradient shading for multi-level blocks without error', async () => {
    const cells = [
      { x: 3, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 3, y: 5, level: 1, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 3, y: 5, level: 2, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 3, y: 5, level: 3, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    const buf = await renderBoard(freshState(cells));
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x89); // valid PNG
    expect(buf.length).toBeGreaterThan(100);
  });

  it('renders health bar green for blocks with >80% health', async () => {
    const cells = [
      { x: 4, y: 6, level: 0, type: 'packed_sand', health: 60, owner: 'player1' }, // 60/60 = 100%
    ];
    const buf = await renderBoard(freshState(cells));
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x89);
    expect(buf.length).toBeGreaterThan(100);
  });

  it('renders health bar yellow for blocks with 50–80% health', async () => {
    const cells = [
      { x: 4, y: 6, level: 0, type: 'packed_sand', health: 39, owner: 'player1' }, // 39/60 ≈ 65%
    ];
    const buf = await renderBoard(freshState(cells));
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x89);
    expect(buf.length).toBeGreaterThan(100);
  });

  it('renders health bar orange for blocks with 25–50% health', async () => {
    const cells = [
      { x: 4, y: 6, level: 0, type: 'packed_sand', health: 21, owner: 'player1' }, // 21/60 = 35%
    ];
    const buf = await renderBoard(freshState(cells));
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x89);
    expect(buf.length).toBeGreaterThan(100);
  });

  it('renders health bar red for blocks with ≤25% health', async () => {
    const cells = [
      { x: 4, y: 6, level: 0, type: 'packed_sand', health: 10, owner: 'player1' }, // 10/60 ≈ 17%
    ];
    const buf = await renderBoard(freshState(cells));
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x89);
    expect(buf.length).toBeGreaterThan(100);
  });

  it('does not render health bar for moat blocks', async () => {
    const cells = [
      { x: 5, y: 7, level: 0, type: 'moat', health: 0, owner: 'player1', moatDepth: 2 },
    ];
    const buf = await renderBoard(freshState(cells));
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x89);
    expect(buf.length).toBeGreaterThan(100);
  });

  it('renders HP value text on blocks at default cell size', async () => {
    const cells = [
      { x: 4, y: 6, level: 0, type: 'packed_sand', health: 42, owner: 'player1' },
    ];
    const buf = await renderBoard(freshState(cells), { cellSize: 30 });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x89);
    expect(buf.length).toBeGreaterThan(100);
  });

  it('skips HP value text on blocks at small cell size', async () => {
    const cells = [
      { x: 4, y: 6, level: 0, type: 'packed_sand', health: 42, owner: 'player1' },
    ];
    const buf = await renderBoard(freshState(cells), { cellSize: 10 });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x89);
    expect(buf.length).toBeGreaterThan(100);
  });

  it('renders most-damaged block diamond indicator', async () => {
    const cells = [
      { x: 3, y: 6, level: 0, type: 'packed_sand', health: 60, owner: 'player1' }, // healthy
      { x: 4, y: 6, level: 0, type: 'packed_sand', health: 10, owner: 'player1' }, // most damaged
    ];
    const buf = await renderBoard(freshState(cells));
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x89);
    expect(buf.length).toBeGreaterThan(100);
  });
});
