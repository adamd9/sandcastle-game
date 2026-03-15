import { describe, it, expect, beforeEach } from 'vitest';
import { validateMove, applyMove, applyWeather } from '../lib/gameLogic.js';

const freshState = () => ({
  id: 'game',
  tick: 0,
  weather: { rain_mm: 0, wind_speed_kph: 0, wind_direction: 'N' },
  cells: [],
  players: {
    player1: { actionsThisTick: 0 },
    player2: { actionsThisTick: 0 },
  },
  lastUpdated: new Date().toISOString(),
});

describe('validateMove', () => {
  it('allows a valid PLACE in own zone', () => {
    const r = validateMove(freshState(), 'player1', { action: 'PLACE', x: 5, y: 5, type: 'dry_sand' });
    expect(r.valid).toBe(true);
  });

  it('rejects PLACE outside own zone', () => {
    const r = validateMove(freshState(), 'player1', { action: 'PLACE', x: 15, y: 5, type: 'dry_sand' });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/zone/i);
  });

  it('rejects PLACE on occupied cell', () => {
    const state = freshState();
    state.cells.push({ x: 3, y: 3, type: 'dry_sand', health: 40, owner: 'player1', level: 0 });
    const r = validateMove(state, 'player1', { action: 'PLACE', x: 3, y: 3, type: 'dry_sand' });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/occupied/i);
  });

  it('rejects PLACE off-grid', () => {
    const r = validateMove(freshState(), 'player1', { action: 'PLACE', x: 25, y: 5, type: 'dry_sand' });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/outside the grid/i);
  });

  it('rejects PLACE with unknown block type', () => {
    const r = validateMove(freshState(), 'player1', { action: 'PLACE', x: 5, y: 5, type: 'magic_sand' });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/unknown block type/i);
  });

  it('rejects placement in water zone', () => {
    const r = validateMove(freshState(), 'player1', { action: 'PLACE', x: 5, y: 1, type: 'dry_sand' });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/water zone/i);
  });

  it('rejects level 1 placement without foundation', () => {
    const r = validateMove(freshState(), 'player1', { action: 'PLACE', x: 5, y: 5, type: 'dry_sand', level: 1 });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/foundation/i);
  });

  it('allows level 1 placement with foundation', () => {
    const state = freshState();
    state.cells.push({ x: 5, y: 5, type: 'dry_sand', health: 25, owner: 'player1', level: 0 });
    const r = validateMove(state, 'player1', { action: 'PLACE', x: 5, y: 5, type: 'dry_sand', level: 1 });
    expect(r.valid).toBe(true);
  });

  it('allows REMOVE own cell', () => {
    const state = freshState();
    state.cells.push({ x: 3, y: 3, type: 'dry_sand', health: 40, owner: 'player1', level: 0 });
    const r = validateMove(state, 'player1', { action: 'REMOVE', x: 3, y: 3 });
    expect(r.valid).toBe(true);
  });

  it("rejects REMOVE of opponent's cell", () => {
    const state = freshState();
    state.cells.push({ x: 3, y: 3, type: 'dry_sand', health: 40, owner: 'player2', level: 0 });
    const r = validateMove(state, 'player1', { action: 'REMOVE', x: 3, y: 3 });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/belongs to/i);
  });

  it('rejects REMOVE on empty cell', () => {
    const r = validateMove(freshState(), 'player1', { action: 'REMOVE', x: 3, y: 3 });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/no block/i);
  });

  it('allows REINFORCE own cell', () => {
    const state = freshState();
    state.cells.push({ x: 3, y: 3, type: 'dry_sand', health: 40, owner: 'player1', level: 0 });
    const r = validateMove(state, 'player1', { action: 'REINFORCE', x: 3, y: 3 });
    expect(r.valid).toBe(true);
  });

  it('rejects REINFORCE on empty cell', () => {
    const r = validateMove(freshState(), 'player1', { action: 'REINFORCE', x: 3, y: 3 });
    expect(r.valid).toBe(false);
  });

  it('rejects when action budget exhausted', () => {
    const state = freshState();
    state.players.player1.actionsThisTick = 20;
    const r = validateMove(state, 'player1', { action: 'PLACE', x: 5, y: 5, type: 'dry_sand' });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/budget/i);
  });

  it('rejects unknown action type', () => {
    const r = validateMove(freshState(), 'player1', { action: 'NUKE', x: 5, y: 5 });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/unknown action/i);
  });
});

describe('applyMove', () => {
  it('PLACE adds a cell with correct health', () => {
    const state = freshState();
    const next = applyMove(structuredClone(state), 'player1', { action: 'PLACE', x: 5, y: 5, type: 'packed_sand' });
    expect(next.cells).toHaveLength(1);
    expect(next.cells[0]).toMatchObject({ x: 5, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
    expect(next.players.player1.actionsThisTick).toBe(1);
  });

  it('REMOVE deletes the cell', () => {
    const state = freshState();
    state.cells.push({ x: 5, y: 5, type: 'dry_sand', health: 40, owner: 'player1', level: 0 });
    const next = applyMove(structuredClone(state), 'player1', { action: 'REMOVE', x: 5, y: 5 });
    expect(next.cells).toHaveLength(0);
  });

  it('REINFORCE increases health up to MAX_HEALTH', () => {
    const state = freshState();
    state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 50, owner: 'player1', level: 0 });
    const next = applyMove(structuredClone(state), 'player1', { action: 'REINFORCE', x: 5, y: 5 });
    expect(next.cells[0].health).toBe(60); // 50 + 15 capped at 60
  });

  it('cascade removes levels above when lower level removed', () => {
    const state = freshState();
    state.cells.push({ x: 5, y: 5, type: 'dry_sand', health: 40, owner: 'player1', level: 0 });
    state.cells.push({ x: 5, y: 5, type: 'dry_sand', health: 40, owner: 'player1', level: 1 });
    state.cells.push({ x: 5, y: 5, type: 'dry_sand', health: 40, owner: 'player1', level: 2 });
    const next = applyMove(structuredClone(state), 'player1', { action: 'REMOVE', x: 5, y: 5, level: 0 });
    expect(next.cells).toHaveLength(0);
  });

  it('cascade only removes from the target level upward', () => {
    const state = freshState();
    state.cells.push({ x: 5, y: 5, type: 'dry_sand', health: 40, owner: 'player1', level: 0 });
    state.cells.push({ x: 5, y: 5, type: 'dry_sand', health: 40, owner: 'player1', level: 1 });
    state.cells.push({ x: 5, y: 5, type: 'dry_sand', health: 40, owner: 'player1', level: 2 });
    const next = applyMove(structuredClone(state), 'player1', { action: 'REMOVE', x: 5, y: 5, level: 1 });
    expect(next.cells).toHaveLength(1);
    expect(next.cells[0].level).toBe(0);
  });
});

describe('applyWeather', () => {
  it('applies rain damage to all cells', () => {
    const state = freshState();
    state.cells.push({ x: 5, y: 5, type: 'dry_sand', health: 40, owner: 'player1', level: 0 });
    state.weather = { rain_mm: 1, wind_speed_kph: 0, wind_direction: 'N', event: 'normal' };
    const next = applyWeather(structuredClone(state));
    // rainDamage(1) = BASE_DAMAGE(3) + floor(1*10) = 13
    expect(next.cells[0].health).toBe(27);
  });

  it('removes cells reduced to 0 health', () => {
    const state = freshState();
    state.cells.push({ x: 5, y: 5, type: 'dry_sand', health: 10, owner: 'player1', level: 0 });
    state.weather = { rain_mm: 10, wind_speed_kph: 0, wind_direction: 'N', event: 'normal' };
    const next = applyWeather(structuredClone(state));
    // rainDamage(10) = BASE_DAMAGE(3) + floor(10*10) = 103 > 10 → cell destroyed
    expect(next.cells).toHaveLength(0);
  });

  it('applies wind damage to windward-edge cells', () => {
    const state = freshState();
    // y=19 is the S edge — wind from S hits it
    state.cells.push({ x: 5, y: 19, type: 'dry_sand', health: 40, owner: 'player1', level: 0 });
    state.weather = { rain_mm: 0, wind_speed_kph: 50, wind_direction: 'S', event: 'normal' };
    const next = applyWeather(structuredClone(state));
    // rainDamage(0) = BASE_DAMAGE(3) + 0 = 3; windDamage(50) = floor(50/3) = 16; total = 19
    expect(next.cells[0].health).toBe(21);
  });

  it('does not apply wind damage to sheltered cells', () => {
    const state = freshState();
    state.cells.push({ x: 5, y: 10, type: 'dry_sand', health: 40, owner: 'player1', level: 0 });
    state.weather = { rain_mm: 0, wind_speed_kph: 50, wind_direction: 'N', event: 'normal' };
    const next = applyWeather(structuredClone(state));
    // sheltered from wind but still takes BASE_DAMAGE(3)
    expect(next.cells[0].health).toBe(37);
  });

  it('only damages top level block (sheltered levels survive)', () => {
    const state = freshState();
    state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
    state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 1 });
    state.weather = { rain_mm: 1, wind_speed_kph: 0, wind_direction: 'N', event: 'normal' };
    const next = applyWeather(structuredClone(state));
    // rainDamage(1) = 13; only L1 (top) takes damage; L0 sheltered
    const l0 = next.cells.find(c => c.level === 0);
    const l1 = next.cells.find(c => c.level === 1);
    expect(l0.health).toBe(60);
    expect(l1.health).toBe(47);
  });

  it('increments tick and resets actionsThisTick', () => {
    const state = freshState();
    state.players.player1.actionsThisTick = 5;
    state.players.player2.actionsThisTick = 3;
    state.weather = { rain_mm: 0, wind_speed_kph: 0, wind_direction: 'N', event: 'normal' };
    const next = applyWeather(structuredClone(state));
    expect(next.tick).toBe(1);
    expect(next.players.player1.actionsThisTick).toBe(0);
    expect(next.players.player2.actionsThisTick).toBe(0);
  });

  describe('flag damage reduction', () => {
    it('a block in a flagged component takes 50% damage', () => {
      const state = freshState();
      state.cells.push({ x: 5, y: 10, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
      state.flags = [{ x: 5, y: 10, level: 0, owner: 'player1', label: 'Keep' }];
      state.weather = { rain_mm: 1, wind_speed_kph: 0, wind_direction: 'N', event: 'normal' };
      const next = applyWeather(structuredClone(state));
      // rainDamage(1) = 13, with 50% reduction → floor(13 * 0.5) = 6
      expect(next.cells[0].health).toBe(54);
    });

    it('a block NOT in a flagged component takes full damage', () => {
      const state = freshState();
      state.cells.push({ x: 5, y: 10, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
      state.flags = [];
      state.weather = { rain_mm: 1, wind_speed_kph: 0, wind_direction: 'N', event: 'normal' };
      const next = applyWeather(structuredClone(state));
      // rainDamage(1) = 13, no reduction
      expect(next.cells[0].health).toBe(47);
    });

    it('two separate structures: only flagged one gets reduction', () => {
      const state = freshState();
      // Flagged structure at (3,10)
      state.cells.push({ x: 3, y: 10, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
      // Unflagged structure at (8,10) — not adjacent to (3,10)
      state.cells.push({ x: 8, y: 10, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
      state.flags = [{ x: 3, y: 10, level: 0, owner: 'player1', label: 'Tower' }];
      state.weather = { rain_mm: 1, wind_speed_kph: 0, wind_direction: 'N', event: 'normal' };
      const next = applyWeather(structuredClone(state));
      const flagged = next.cells.find(c => c.x === 3);
      const unflagged = next.cells.find(c => c.x === 8);
      // flagged: 60 - floor(13 * 0.5) = 60 - 6 = 54
      expect(flagged.health).toBe(54);
      // unflagged: 60 - 13 = 47
      expect(unflagged.health).toBe(47);
    });

    it('a flagged structure spanning multiple cells — all cells get reduction', () => {
      const state = freshState();
      // Three adjacent cells forming a connected structure
      state.cells.push({ x: 5, y: 10, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
      state.cells.push({ x: 6, y: 10, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
      state.cells.push({ x: 7, y: 10, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
      // Flag only on the middle cell — entire component should be protected
      state.flags = [{ x: 6, y: 10, level: 0, owner: 'player1', label: 'Wall' }];
      state.weather = { rain_mm: 1, wind_speed_kph: 0, wind_direction: 'N', event: 'normal' };
      const next = applyWeather(structuredClone(state));
      for (const cell of next.cells) {
        expect(cell.health).toBe(54);
      }
    });

    it('wave surge on flagged structure in rows 3-5: takes damage instead of instant destroy', () => {
      const state = freshState();
      // Block at y=4 (in wave surge instant-destroy zone rows 3-5)
      state.cells.push({ x: 5, y: 4, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
      state.flags = [{ x: 5, y: 4, level: 0, owner: 'player1', label: 'Breakwater' }];
      state.weather = { rain_mm: 0, wind_speed_kph: 0, wind_direction: 'N', event: 'wave_surge' };
      const next = applyWeather(structuredClone(state));
      // Flag-protected: takes floor(40 * 0.5) = 20 damage instead of instant destroy
      expect(next.cells).toHaveLength(1);
      expect(next.cells[0].health).toBe(40);
    });
  });
});
