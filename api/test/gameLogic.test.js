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

  describe('moat validation', () => {
    it('allows PLACE moat at level 0', () => {
      const r = validateMove(freshState(), 'player1', { action: 'PLACE', x: 5, y: 5, type: 'moat' });
      expect(r.valid).toBe(true);
    });

    it('rejects PLACE moat at level > 0', () => {
      const state = freshState();
      state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
      const r = validateMove(state, 'player1', { action: 'PLACE', x: 5, y: 5, type: 'moat', level: 1 });
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/moat/i);
    });

    it('rejects REINFORCE on a moat block', () => {
      const state = freshState();
      state.cells.push({ x: 5, y: 5, type: 'moat', health: 0, owner: 'player1', level: 0 });
      const r = validateMove(state, 'player1', { action: 'REINFORCE', x: 5, y: 5 });
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/moat/i);
    });
  });

  describe('courtyard validation', () => {
    it('allows PLACE courtyard at level 0', () => {
      const r = validateMove(freshState(), 'player1', { action: 'PLACE', x: 5, y: 5, type: 'courtyard' });
      expect(r.valid).toBe(true);
    });

    it('rejects PLACE courtyard at level > 0', () => {
      const state = freshState();
      state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
      const r = validateMove(state, 'player1', { action: 'PLACE', x: 5, y: 6, type: 'courtyard', level: 1 });
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/courtyard/i);
    });

    it('allows REINFORCE on a courtyard block', () => {
      const state = freshState();
      state.cells.push({ x: 5, y: 5, type: 'courtyard', health: 20, owner: 'player1', level: 0 });
      const r = validateMove(state, 'player1', { action: 'REINFORCE', x: 5, y: 5 });
      expect(r.valid).toBe(true);
    });

    it('allows REPAIR_KIT on a courtyard block', () => {
      const state = freshState();
      state.cells.push({ x: 5, y: 5, type: 'courtyard', health: 10, owner: 'player1', level: 0 });
      const r = validateMove(state, 'player1', { action: 'REPAIR_KIT', x: 5, y: 5 });
      expect(r.valid).toBe(true);
    });
  });

  describe('DEEPEN_MOAT validation', () => {
    it('allows DEEPEN_MOAT on own moat block at default depth', () => {
      const state = freshState();
      state.cells.push({ x: 5, y: 5, type: 'moat', health: 0, owner: 'player1', level: 0 });
      const r = validateMove(state, 'player1', { action: 'DEEPEN_MOAT', x: 5, y: 5 });
      expect(r.valid).toBe(true);
    });

    it('allows DEEPEN_MOAT on moat at depth 2', () => {
      const state = freshState();
      state.cells.push({ x: 5, y: 5, type: 'moat', health: 0, owner: 'player1', level: 0, moatDepth: 2 });
      const r = validateMove(state, 'player1', { action: 'DEEPEN_MOAT', x: 5, y: 5 });
      expect(r.valid).toBe(true);
    });

    it('rejects DEEPEN_MOAT on moat already at max depth (3)', () => {
      const state = freshState();
      state.cells.push({ x: 5, y: 5, type: 'moat', health: 0, owner: 'player1', level: 0, moatDepth: 3 });
      const r = validateMove(state, 'player1', { action: 'DEEPEN_MOAT', x: 5, y: 5 });
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/maximum depth/i);
    });

    it('rejects DEEPEN_MOAT on a non-moat block', () => {
      const state = freshState();
      state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
      const r = validateMove(state, 'player1', { action: 'DEEPEN_MOAT', x: 5, y: 5 });
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/moat/i);
    });

    it("rejects DEEPEN_MOAT on opponent's moat block", () => {
      const state = freshState();
      state.cells.push({ x: 15, y: 5, type: 'moat', health: 0, owner: 'player2', level: 0 });
      const r = validateMove(state, 'player1', { action: 'DEEPEN_MOAT', x: 15, y: 5 });
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/belongs to/i);
    });

    it('rejects DEEPEN_MOAT on empty cell', () => {
      const r = validateMove(freshState(), 'player1', { action: 'DEEPEN_MOAT', x: 5, y: 5 });
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/no block/i);
    });
  });

  describe('REPAIR_KIT validation', () => {
    it('allows REPAIR_KIT on own cell when no cooldown', () => {
      const state = freshState();
      state.cells.push({ x: 3, y: 5, type: 'packed_sand', health: 10, owner: 'player1', level: 0 });
      const r = validateMove(state, 'player1', { action: 'REPAIR_KIT', x: 3, y: 5 });
      expect(r.valid).toBe(true);
    });

    it('rejects REPAIR_KIT on empty cell', () => {
      const r = validateMove(freshState(), 'player1', { action: 'REPAIR_KIT', x: 3, y: 5 });
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/no block/i);
    });

    it("rejects REPAIR_KIT on opponent's cell", () => {
      const state = freshState();
      state.cells.push({ x: 3, y: 5, type: 'packed_sand', health: 10, owner: 'player2', level: 0 });
      const r = validateMove(state, 'player1', { action: 'REPAIR_KIT', x: 3, y: 5 });
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/belongs to/i);
    });

    it('rejects REPAIR_KIT on a moat block', () => {
      const state = freshState();
      state.cells.push({ x: 3, y: 5, type: 'moat', health: 0, owner: 'player1', level: 0 });
      const r = validateMove(state, 'player1', { action: 'REPAIR_KIT', x: 3, y: 5 });
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/moat/i);
    });

    it('rejects REPAIR_KIT when on cooldown (used 2 ticks ago)', () => {
      const state = freshState();
      state.tick = 5;
      state.players.player1.repairKitLastUsedTick = 3; // 5 - 3 = 2 < 5 cooldown
      state.cells.push({ x: 3, y: 5, type: 'packed_sand', health: 10, owner: 'player1', level: 0 });
      const r = validateMove(state, 'player1', { action: 'REPAIR_KIT', x: 3, y: 5 });
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/cooldown/i);
    });

    it('allows REPAIR_KIT exactly when cooldown expires (5 ticks later)', () => {
      const state = freshState();
      state.tick = 8;
      state.players.player1.repairKitLastUsedTick = 3; // 8 - 3 = 5 >= 5 cooldown
      state.cells.push({ x: 3, y: 5, type: 'packed_sand', health: 10, owner: 'player1', level: 0 });
      const r = validateMove(state, 'player1', { action: 'REPAIR_KIT', x: 3, y: 5 });
      expect(r.valid).toBe(true);
    });

    it('cooldown is per-player: player2 can use while player1 is on cooldown', () => {
      const state = freshState();
      state.tick = 5;
      state.players.player1.repairKitLastUsedTick = 3; // on cooldown
      state.cells.push({ x: 15, y: 5, type: 'packed_sand', health: 10, owner: 'player2', level: 0 });
      const r = validateMove(state, 'player2', { action: 'REPAIR_KIT', x: 15, y: 5 });
      expect(r.valid).toBe(true);
    });
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

  describe('REPAIR_KIT', () => {
    it('REPAIR_KIT restores block to MAX_HEALTH', () => {
      const state = freshState();
      state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 10, owner: 'player1', level: 0 });
      const next = applyMove(structuredClone(state), 'player1', { action: 'REPAIR_KIT', x: 5, y: 5 });
      expect(next.cells[0].health).toBe(60);
    });

    it('REPAIR_KIT records repairKitLastUsedTick on player state', () => {
      const state = freshState();
      state.tick = 3;
      state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 10, owner: 'player1', level: 0 });
      const next = applyMove(structuredClone(state), 'player1', { action: 'REPAIR_KIT', x: 5, y: 5 });
      expect(next.players.player1.repairKitLastUsedTick).toBe(3);
    });

    it('REPAIR_KIT increments actionsThisTick', () => {
      const state = freshState();
      state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 30, owner: 'player1', level: 0 });
      const next = applyMove(structuredClone(state), 'player1', { action: 'REPAIR_KIT', x: 5, y: 5 });
      expect(next.players.player1.actionsThisTick).toBe(1);
    });
  });

  describe('DEEPEN_MOAT', () => {
    it('DEEPEN_MOAT increments moatDepth from default (1) to 2', () => {
      const state = freshState();
      state.cells.push({ x: 5, y: 5, type: 'moat', health: 0, owner: 'player1', level: 0 });
      const next = applyMove(structuredClone(state), 'player1', { action: 'DEEPEN_MOAT', x: 5, y: 5 });
      expect(next.cells[0].moatDepth).toBe(2);
    });

    it('DEEPEN_MOAT increments moatDepth from 2 to 3', () => {
      const state = freshState();
      state.cells.push({ x: 5, y: 5, type: 'moat', health: 0, owner: 'player1', level: 0, moatDepth: 2 });
      const next = applyMove(structuredClone(state), 'player1', { action: 'DEEPEN_MOAT', x: 5, y: 5 });
      expect(next.cells[0].moatDepth).toBe(3);
    });

    it('DEEPEN_MOAT increments actionsThisTick', () => {
      const state = freshState();
      state.cells.push({ x: 5, y: 5, type: 'moat', health: 0, owner: 'player1', level: 0 });
      const next = applyMove(structuredClone(state), 'player1', { action: 'DEEPEN_MOAT', x: 5, y: 5 });
      expect(next.players.player1.actionsThisTick).toBe(1);
    });
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

  describe('moat mechanic', () => {
    it('moat block is immune to weather damage', () => {
      const state = freshState();
      state.cells.push({ x: 5, y: 10, type: 'moat', health: 0, owner: 'player1', level: 0 });
      state.weather = { rain_mm: 10, wind_speed_kph: 0, wind_direction: 'N', event: 'normal' };
      const next = applyWeather(structuredClone(state));
      // Moat block survives with health 0 (permanent)
      const moat = next.cells.find(c => c.type === 'moat');
      expect(moat).toBeDefined();
      expect(moat.health).toBe(0);
    });

    it('moat block survives wave_surge event', () => {
      const state = freshState();
      state.cells.push({ x: 5, y: 4, type: 'moat', health: 0, owner: 'player1', level: 0 });
      state.weather = { rain_mm: 0, wind_speed_kph: 0, wind_direction: 'N', event: 'wave_surge' };
      const next = applyWeather(structuredClone(state));
      const moat = next.cells.find(c => c.type === 'moat');
      expect(moat).toBeDefined();
    });

    it('adjacent same-owner block gets 25% damage reduction from moat', () => {
      const state = freshState();
      // Moat at (4, 10), castle block at (5, 10) — adjacent, same owner
      state.cells.push({ x: 4, y: 10, type: 'moat', health: 0, owner: 'player1', level: 0 });
      state.cells.push({ x: 5, y: 10, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
      state.weather = { rain_mm: 1, wind_speed_kph: 0, wind_direction: 'N', event: 'normal' };
      const next = applyWeather(structuredClone(state));
      // rainDamage(1) = 13, with 25% moat reduction → floor(13 * 0.75) = 9
      const castle = next.cells.find(c => c.type === 'packed_sand');
      expect(castle.health).toBe(51); // 60 - 9 = 51
    });

    it('non-adjacent block does not get moat reduction', () => {
      const state = freshState();
      // Moat at (4, 10), castle block at (7, 10) — not adjacent
      state.cells.push({ x: 4, y: 10, type: 'moat', health: 0, owner: 'player1', level: 0 });
      state.cells.push({ x: 7, y: 10, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
      state.weather = { rain_mm: 1, wind_speed_kph: 0, wind_direction: 'N', event: 'normal' };
      const next = applyWeather(structuredClone(state));
      // rainDamage(1) = 13, no moat reduction
      const castle = next.cells.find(c => c.type === 'packed_sand');
      expect(castle.health).toBe(47); // 60 - 13 = 47
    });

    it('moat does not protect blocks owned by a different player', () => {
      const state = freshState();
      // Player1 moat at (9, 10), player2 castle block at (10, 10) — adjacent but different owner
      state.cells.push({ x: 9, y: 10, type: 'moat', health: 0, owner: 'player1', level: 0 });
      state.cells.push({ x: 10, y: 10, type: 'packed_sand', health: 60, owner: 'player2', level: 0 });
      state.weather = { rain_mm: 1, wind_speed_kph: 0, wind_direction: 'N', event: 'normal' };
      const next = applyWeather(structuredClone(state));
      // rainDamage(1) = 13, no moat reduction (different owner)
      const castle = next.cells.find(c => c.type === 'packed_sand');
      expect(castle.health).toBe(47); // 60 - 13 = 47
    });

    it('moat and flag protection stack multiplicatively', () => {
      const state = freshState();
      // Moat at (4, 10), flagged castle block at (5, 10)
      state.cells.push({ x: 4, y: 10, type: 'moat', health: 0, owner: 'player1', level: 0 });
      state.cells.push({ x: 5, y: 10, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
      state.flags = [{ x: 5, y: 10, level: 0, owner: 'player1', label: 'Keep' }];
      state.weather = { rain_mm: 1, wind_speed_kph: 0, wind_direction: 'N', event: 'normal' };
      const next = applyWeather(structuredClone(state));
      // rainDamage(1) = 13, flag: floor(13 * 0.5) = 6, moat: floor(6 * 0.75) = 4
      const castle = next.cells.find(c => c.type === 'packed_sand');
      expect(castle.health).toBe(56); // 60 - 4 = 56
    });

    it('standard moat (depth 2) gives 35% damage reduction', () => {
      const state = freshState();
      // Standard moat at (4, 10), castle block at (5, 10)
      state.cells.push({ x: 4, y: 10, type: 'moat', health: 0, owner: 'player1', level: 0, moatDepth: 2 });
      state.cells.push({ x: 5, y: 10, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
      state.weather = { rain_mm: 1, wind_speed_kph: 0, wind_direction: 'N', event: 'normal' };
      const next = applyWeather(structuredClone(state));
      // rainDamage(1) = 13, with 35% moat reduction → floor(13 * 0.65) = 8
      const castle = next.cells.find(c => c.type === 'packed_sand');
      expect(castle.health).toBe(52); // 60 - 8 = 52
    });

    it('deep moat (depth 3) gives 45% damage reduction', () => {
      const state = freshState();
      // Deep moat at (4, 10), castle block at (5, 10)
      state.cells.push({ x: 4, y: 10, type: 'moat', health: 0, owner: 'player1', level: 0, moatDepth: 3 });
      state.cells.push({ x: 5, y: 10, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
      state.weather = { rain_mm: 1, wind_speed_kph: 0, wind_direction: 'N', event: 'normal' };
      const next = applyWeather(structuredClone(state));
      // rainDamage(1) = 13, with 45% moat reduction → floor(13 * 0.55) = 7
      const castle = next.cells.find(c => c.type === 'packed_sand');
      expect(castle.health).toBe(53); // 60 - 7 = 53
    });

    it('block adjacent to two moats uses the deeper one', () => {
      const state = freshState();
      // Shallow moat at (4, 10), deep moat at (6, 10), castle block at (5, 10) — adjacent to both
      state.cells.push({ x: 4, y: 10, type: 'moat', health: 0, owner: 'player1', level: 0, moatDepth: 1 });
      state.cells.push({ x: 6, y: 10, type: 'moat', health: 0, owner: 'player1', level: 0, moatDepth: 3 });
      state.cells.push({ x: 5, y: 10, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
      state.weather = { rain_mm: 1, wind_speed_kph: 0, wind_direction: 'N', event: 'normal' };
      const next = applyWeather(structuredClone(state));
      // rainDamage(1) = 13, with 45% deep moat reduction → floor(13 * 0.55) = 7
      const castle = next.cells.find(c => c.type === 'packed_sand');
      expect(castle.health).toBe(53); // 60 - 7 = 53 (uses deeper moat's 45%)
    });
  });
});

// ---------------------------------------------------------------------------
// computeStructureScore
// ---------------------------------------------------------------------------

import { computeStructureScore } from '../lib/gameLogic.js';

describe('computeStructureScore', () => {
  it('returns all zeros for empty board', () => {
    const score = computeStructureScore([], 'player1');
    expect(score).toMatchObject({
      total_blocks: 0, total_hp: 0, avg_health: 0, max_height: 0,
      footprint: 0, perimeter: 0, perimeter_integrity: 0,
      height_variety: 0, architectural_complexity: 0,
      flag_diversity: 0, courtyard_bonus: 0, courtyard_cells: [],
      prestige_score: 0, moat_courtyard_bonus: 0, longevity_bonus: 0,
    });
    expect(Array.isArray(score.perimeter_gaps)).toBe(true);
  });

  it('calculates total_hp as sum of all block health', () => {
    const cells = [
      { x: 3, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 4, y: 5, level: 0, type: 'dry_sand',    health: 25, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    expect(score.total_hp).toBe(85);
  });

  it('only counts cells belonging to the specified player', () => {
    const cells = [
      { x: 3, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 15, y: 5, level: 0, type: 'dry_sand',    health: 25, owner: 'player2' },
    ];
    const score = computeStructureScore(cells, 'player1');
    expect(score.total_hp).toBe(60);
    expect(score.footprint).toBe(1);
  });

  it('calculates max_height as highest level + 1', () => {
    const cells = [
      { x: 3, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 3, y: 5, level: 1, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 3, y: 5, level: 2, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    expect(score.max_height).toBe(3);
  });

  it('calculates footprint as distinct (x,y) positions', () => {
    const cells = [
      { x: 3, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 3, y: 5, level: 1, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 4, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 5, y: 6, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    expect(score.footprint).toBe(3); // (3,5), (4,5), (5,6)
  });

  it('detects enclosed courtyard cells', () => {
    // Build a 3x3 ring of blocks in player1 zone (columns 0-9) to enclose (4,10)
    // Ring: positions (3,9),(4,9),(5,9),(3,10),(5,10),(3,11),(4,11),(5,11)
    const ring = [
      [3, 9], [4, 9], [5, 9],
      [3, 10],        [5, 10],
      [3, 11], [4, 11], [5, 11],
    ];
    const cells = ring.map(([x, y]) => ({
      x, y, level: 0, type: 'packed_sand', health: 60, owner: 'player1',
    }));
    const score = computeStructureScore(cells, 'player1');
    expect(score.courtyard_bonus).toBe(1); // (4,10) is enclosed
    expect(score.courtyard_cells).toEqual([[4, 10]]);
  });

  it('returns zero courtyard_bonus for open structures without enclosure', () => {
    // Just a straight line — nothing enclosed
    const cells = [
      { x: 3, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 4, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 5, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    expect(score.courtyard_bonus).toBe(0);
  });

  it('calculates perimeter as exposed outer edges of the footprint', () => {
    // Single block: 4 exposed sides
    const single = [{ x: 5, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' }];
    expect(computeStructureScore(single, 'player1').perimeter).toBe(4);

    // Horizontal line of 3: 2*3 + 2*1 = 8 exposed sides
    const line = [
      { x: 3, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 4, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 5, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    expect(computeStructureScore(line, 'player1').perimeter).toBe(8);

    // 2x2 square: 4*4 - 2*4 = 8 exposed sides
    const square = [
      { x: 3, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 4, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 3, y: 6, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 4, y: 6, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    expect(computeStructureScore(square, 'player1').perimeter).toBe(8);
  });

  it('perimeter only counts the 2D footprint (not per-level)', () => {
    // Stacking 3 levels at the same (x,y) should not increase perimeter
    const tower = [
      { x: 5, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 5, y: 5, level: 1, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 5, y: 5, level: 2, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    expect(computeStructureScore(tower, 'player1').perimeter).toBe(4);
  });

  it('calculates height_variety as number of distinct levels in use', () => {
    // Uniform: only level 0 — variety = 1
    const uniform = [
      { x: 3, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 4, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    expect(computeStructureScore(uniform, 'player1').height_variety).toBe(1);

    // Mixed levels 0 and 2 — variety = 2
    const mixed = [
      { x: 3, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 4, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 3, y: 5, level: 2, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    expect(computeStructureScore(mixed, 'player1').height_variety).toBe(2);

    // All four levels — variety = 4
    const allLevels = [0, 1, 2, 3].map(level => ({
      x: 5, y: 5, level, type: 'packed_sand', health: 60, owner: 'player1',
    }));
    expect(computeStructureScore(allLevels, 'player1').height_variety).toBe(4);
  });

  it('returns height_variety 0 for empty board', () => {
    expect(computeStructureScore([], 'player1').height_variety).toBe(0);
  });

  it('calculates flag_diversity as count of player flags', () => {
    const cells = [
      { x: 3, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 8, y: 15, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    const flags = [
      { id: 'f1', x: 3, y: 5, level: 0, owner: 'player1', label: 'Gate' },
      { id: 'f2', x: 8, y: 15, level: 0, owner: 'player1', label: 'Tower' },
      { id: 'f3', x: 15, y: 5, level: 0, owner: 'player2', label: 'Bastion' },
    ];
    const score = computeStructureScore(cells, 'player1', flags);
    expect(score.flag_diversity).toBe(2); // only player1's 2 flags counted
  });

  it('returns flag_diversity 0 when no flags provided', () => {
    const cells = [{ x: 3, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' }];
    expect(computeStructureScore(cells, 'player1').flag_diversity).toBe(0);
    expect(computeStructureScore(cells, 'player1', []).flag_diversity).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeStructureScore — new breakdown fields (total_blocks, avg_health, etc.)
// ---------------------------------------------------------------------------

describe('computeStructureScore — breakdown fields', () => {
  it('counts total_blocks as raw block count (not footprint)', () => {
    const cells = [
      { x: 3, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 3, y: 5, level: 1, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 4, y: 6, level: 0, type: 'dry_sand',    health: 25, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    expect(score.total_blocks).toBe(3);
    expect(score.footprint).toBe(2); // only 2 distinct (x,y) positions
  });

  it('only counts blocks for the specified player', () => {
    const cells = [
      { x: 3, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 15, y: 5, level: 0, type: 'dry_sand',   health: 25, owner: 'player2' },
    ];
    const score = computeStructureScore(cells, 'player1');
    expect(score.total_blocks).toBe(1);
  });

  it('calculates avg_health correctly', () => {
    const cells = [
      { x: 3, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 4, y: 5, level: 0, type: 'dry_sand',    health: 20, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    expect(score.avg_health).toBe(40);
  });

  it('counts architectural_complexity as multi-level columns', () => {
    const cells = [
      { x: 3, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 3, y: 5, level: 1, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 4, y: 6, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    expect(score.architectural_complexity).toBe(1); // only (3,5) has 2 levels
  });

  it('calculates perimeter_integrity > 0 when perimeter cells are occupied', () => {
    // Place a block on a zone boundary cell for player1 (x=0 is the left edge)
    const cells = [
      { x: 0, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    expect(score.perimeter_integrity).toBeGreaterThan(0);
  });

  it('returns perimeter_integrity 0 when no perimeter cells occupied', () => {
    // Interior cell — not on zone boundary
    const cells = [
      { x: 5, y: 10, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    expect(score.perimeter_integrity).toBe(0);
  });

  it('counts moat cells on the zone boundary as occupied for perimeter_integrity', () => {
    // Moat cell directly on zone boundary (x=0 is left edge of player1's zone)
    const cells = [
      { x: 0, y: 5, level: 0, type: 'moat', health: 0, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    expect(score.perimeter_integrity).toBeGreaterThan(0);
  });

  it('awards full perimeter_integrity for complete moat ring enclosing non-moat structures', () => {
    // Moat ring forming a rectangle inside player1's zone (x=2..8, y=7..17)
    // with a non-moat block enclosed at the centre.
    const makeMoat = (x, y) => ({ x, y, level: 0, type: 'moat', health: 0, owner: 'player1' });
    const moatCells = [
      // Left wall x=2, y=7..17
      ...[7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map(y => makeMoat(2, y)),
      // Right wall x=8, y=7..17
      ...[7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map(y => makeMoat(8, y)),
      // Top wall y=7, x=3..7 (corners already covered by left/right walls)
      ...[3, 4, 5, 6, 7].map(x => makeMoat(x, 7)),
      // Bottom wall y=17, x=3..7
      ...[3, 4, 5, 6, 7].map(x => makeMoat(x, 17)),
    ];
    const innerBlock = { x: 5, y: 12, level: 0, type: 'packed_sand', health: 60, owner: 'player1' };
    const score = computeStructureScore([...moatCells, innerBlock], 'player1');
    expect(score.perimeter_integrity).toBe(100);
  });

  it('returns zero perimeter_integrity for incomplete moat ring with gap', () => {
    // Same ring as above but with (5, 7) removed — creating a gap in the top wall
    const makeMoat = (x, y) => ({ x, y, level: 0, type: 'moat', health: 0, owner: 'player1' });
    const moatCells = [
      ...[7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map(y => makeMoat(2, y)),
      ...[7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map(y => makeMoat(8, y)),
      // Top wall with gap at x=5
      ...[3, 4, 6, 7].map(x => makeMoat(x, 7)),
      ...[3, 4, 5, 6, 7].map(x => makeMoat(x, 17)),
    ];
    const innerBlock = { x: 5, y: 12, level: 0, type: 'packed_sand', health: 60, owner: 'player1' };
    const score = computeStructureScore([...moatCells, innerBlock], 'player1');
    // Gap lets zone boundary reach interior block → no moat-ring bonus → falls back to
    // direct boundary coverage (no blocks on zone boundary → 0)
    expect(score.perimeter_integrity).toBe(0);
  });

  it('returns perimeter_gaps as empty array when moat ring fully defends perimeter', () => {
    const makeMoat = (x, y) => ({ x, y, level: 0, type: 'moat', health: 0, owner: 'player1' });
    const moatCells = [
      ...[7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map(y => makeMoat(2, y)),
      ...[7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map(y => makeMoat(8, y)),
      ...[3, 4, 5, 6, 7].map(x => makeMoat(x, 7)),
      ...[3, 4, 5, 6, 7].map(x => makeMoat(x, 17)),
    ];
    const innerBlock = { x: 5, y: 12, level: 0, type: 'packed_sand', health: 60, owner: 'player1' };
    const score = computeStructureScore([...moatCells, innerBlock], 'player1');
    expect(score.perimeter_gaps).toEqual([]);
  });

  it('returns perimeter_gaps listing unoccupied zone boundary cells when no blocks placed', () => {
    const score = computeStructureScore([], 'player1');
    // All perimeter cells should be listed as gaps
    expect(Array.isArray(score.perimeter_gaps)).toBe(true);
    expect(score.perimeter_gaps.length).toBeGreaterThan(0);
    expect(score.perimeter_gaps.every(g => typeof g.x === 'number' && typeof g.y === 'number')).toBe(true);
  });

  it('excludes occupied boundary cells from perimeter_gaps', () => {
    // Place a block on a zone boundary cell for player1 (x=0 is the left edge)
    const cells = [
      { x: 0, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    const gap = score.perimeter_gaps.find(g => g.x === 0 && g.y === 5);
    expect(gap).toBeUndefined(); // occupied cell should not appear as a gap
    expect(score.perimeter_gaps.length).toBeLessThan(computeStructureScore([], 'player1').perimeter_gaps.length);
  });
});

// ---------------------------------------------------------------------------
// computeStructureScore — prestige score (height multiplier + depth bonus)
// ---------------------------------------------------------------------------

describe('computeStructureScore — prestige_score', () => {
  it('awards level multipliers: L0=1x, L1=1.5x, L2=2x, L3=3x', () => {
    const cells = [
      { x: 3, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 4, y: 5, level: 1, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 5, y: 5, level: 2, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 6, y: 5, level: 3, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    // 60*1 + 60*1.5 + 60*2 + 60*3 = 60 + 90 + 120 + 180 = 450
    expect(score.prestige_score).toBe(450);
  });

  it('grants 25% structural depth bonus for a fully-stacked column (L0–L3)', () => {
    const cells = [0, 1, 2, 3].map(level => ({
      x: 5, y: 5, level, type: 'packed_sand', health: 60, owner: 'player1',
    }));
    const score = computeStructureScore(cells, 'player1');
    // Raw column: 60*1 + 60*1.5 + 60*2 + 60*3 = 450; with 25% bonus: 450 * 1.25 = 562.5 → 563
    expect(score.prestige_score).toBe(563);
  });

  it('does not apply depth bonus when column is incomplete', () => {
    // Only L0 and L3 — not a complete column
    const cells = [
      { x: 5, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 5, y: 5, level: 3, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    // No bonus: 60*1 + 60*3 = 240
    expect(score.prestige_score).toBe(240);
  });

  it('excludes moat cells from prestige score', () => {
    const cells = [
      { x: 3, y: 5, level: 0, type: 'moat', health: 0, owner: 'player1' },
      { x: 4, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    // Only sand block counts: 60 * 1 = 60
    expect(score.prestige_score).toBe(60);
  });

  it('returns prestige_score 0 for empty board', () => {
    expect(computeStructureScore([], 'player1').prestige_score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeStructureScore — courtyard tower bonus
// ---------------------------------------------------------------------------

describe('computeStructureScore — courtyard tower prestige bonus', () => {
  it('grants 25% prestige bonus to an L2 block adjacent to a courtyard', () => {
    const cells = [
      { x: 5, y: 10, level: 0, type: 'courtyard', health: 30, owner: 'player1' },
      { x: 6, y: 10, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 6, y: 10, level: 1, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 6, y: 10, level: 2, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    // courtyard at L0: 30*1 = 30 prestige
    // tower col (6,10): L0=60*1=60, L1=60*1.5=90, L2=60*2=120 → L2 gets 25% bonus: 120*1.25=150
    // total = 30 + 60 + 90 + 150 = 330
    expect(score.prestige_score).toBe(330);
  });

  it('grants 25% prestige bonus to an L3 block adjacent to a courtyard', () => {
    const cells = [
      { x: 5, y: 10, level: 0, type: 'courtyard', health: 30, owner: 'player1' },
      { x: 5, y: 11, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 5, y: 11, level: 1, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 5, y: 11, level: 2, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 5, y: 11, level: 3, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    // courtyard at (5,10): 30*1 = 30
    // tower col (5,11): L0=60, L1=90, L2=120*1.25=150, L3=180*1.25=225 → raw sum=525
    // full column (L0–L3) depth bonus applied to the raw sum: 525*1.25=656.25
    // total prestige = Math.round(30 + 656.25) = 686
    expect(score.prestige_score).toBe(686);
  });

  it('does NOT grant courtyard bonus to L0 or L1 blocks', () => {
    const cells = [
      { x: 5, y: 10, level: 0, type: 'courtyard', health: 30, owner: 'player1' },
      { x: 6, y: 10, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 6, y: 10, level: 1, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    // courtyard: 30, L0=60, L1=90 (no bonus for L0/L1)
    expect(score.prestige_score).toBe(180);
  });

  it('does NOT grant courtyard bonus when courtyard belongs to the opponent', () => {
    const cells = [
      { x: 5, y: 10, level: 0, type: 'courtyard', health: 30, owner: 'player2' },
      { x: 6, y: 10, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 6, y: 10, level: 1, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 6, y: 10, level: 2, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    // player1 has no courtyard; no bonus: L0=60, L1=90, L2=120
    expect(score.prestige_score).toBe(270);
  });

  it('does NOT grant courtyard bonus when tower is not adjacent (diagonal only)', () => {
    const cells = [
      { x: 5, y: 10, level: 0, type: 'courtyard', health: 30, owner: 'player1' },
      { x: 6, y: 11, level: 0, type: 'packed_sand', health: 60, owner: 'player1' }, // diagonal — not adjacent
      { x: 6, y: 11, level: 1, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 6, y: 11, level: 2, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    // courtyard: 30, L0=60, L1=90, L2=120 (no bonus since diagonal, not orthogonally adjacent)
    expect(score.prestige_score).toBe(300);
  });

  it('courtyard block itself contributes to prestige based on its health', () => {
    const cells = [
      { x: 5, y: 10, level: 0, type: 'courtyard', health: 30, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    // courtyard at L0: 30 * 1 = 30
    expect(score.prestige_score).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// computeStructureScore — moat courtyard bonus
// ---------------------------------------------------------------------------

describe('computeStructureScore — moat_courtyard_bonus', () => {
  it('counts non-moat blocks enclosed within a closed moat ring', () => {
    // Ring of moats around (5, 10); sand block inside at (5, 10)
    const moatRing = [
      [4, 9], [5, 9], [6, 9],
      [4, 10],         [6, 10],
      [4, 11], [5, 11], [6, 11],
    ].map(([x, y]) => ({ x, y, level: 0, type: 'moat', health: 0, owner: 'player1' }));
    const innerBlock = { x: 5, y: 10, level: 0, type: 'packed_sand', health: 60, owner: 'player1' };
    const score = computeStructureScore([...moatRing, innerBlock], 'player1');
    expect(score.moat_courtyard_bonus).toBe(1);
  });

  it('returns 0 when there is no moat ring enclosure', () => {
    const cells = [
      { x: 3, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 4, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    expect(computeStructureScore(cells, 'player1').moat_courtyard_bonus).toBe(0);
  });

  it('does not count moat cells themselves in the bonus', () => {
    // A small moat ring with no sand blocks inside
    const moatRing = [
      [4, 9], [5, 9], [6, 9],
      [4, 10],         [6, 10],
      [4, 11], [5, 11], [6, 11],
    ].map(([x, y]) => ({ x, y, level: 0, type: 'moat', health: 0, owner: 'player1' }));
    const score = computeStructureScore(moatRing, 'player1');
    expect(score.moat_courtyard_bonus).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeStructureScore — longevity bonus
// ---------------------------------------------------------------------------

describe('computeStructureScore — longevity_bonus', () => {
  it('sums survivedTicks for L2 and L3 blocks', () => {
    const cells = [
      { x: 3, y: 5, level: 2, type: 'packed_sand', health: 60, owner: 'player1', survivedTicks: 5 },
      { x: 3, y: 5, level: 3, type: 'packed_sand', health: 60, owner: 'player1', survivedTicks: 3 },
      { x: 4, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1', survivedTicks: 10 },
      { x: 4, y: 5, level: 1, type: 'packed_sand', health: 60, owner: 'player1', survivedTicks: 10 },
    ];
    const score = computeStructureScore(cells, 'player1');
    // Only L2 (5) and L3 (3) count: total = 8
    expect(score.longevity_bonus).toBe(8);
  });

  it('treats missing survivedTicks as 0', () => {
    const cells = [
      { x: 3, y: 5, level: 2, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 3, y: 5, level: 3, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    expect(score.longevity_bonus).toBe(0);
  });

  it('excludes moat blocks from longevity bonus', () => {
    const cells = [
      { x: 3, y: 5, level: 2, type: 'moat', health: 0, owner: 'player1', survivedTicks: 99 },
      { x: 4, y: 5, level: 3, type: 'packed_sand', health: 60, owner: 'player1', survivedTicks: 4 },
    ];
    const score = computeStructureScore(cells, 'player1');
    expect(score.longevity_bonus).toBe(4);
  });

  it('returns 0 for empty board', () => {
    expect(computeStructureScore([], 'player1').longevity_bonus).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// applyWeather — survivedTicks accumulation
// ---------------------------------------------------------------------------

describe('applyWeather — survivedTicks', () => {
  it('increments survivedTicks for L2/L3 blocks surviving a tick', () => {
    const state = freshState();
    state.weather = { rain_mm: 0, wind_speed_kph: 0, wind_direction: 'N', event: 'calm' };
    state.cells = [
      { x: 5, y: 5, level: 2, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 5, y: 5, level: 3, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    const result = applyWeather(structuredClone(state));
    const l2 = result.cells.find(c => c.level === 2);
    const l3 = result.cells.find(c => c.level === 3);
    expect(l2.survivedTicks).toBe(1);
    expect(l3.survivedTicks).toBe(1);
  });

  it('does not increment survivedTicks for L0/L1 blocks', () => {
    const state = freshState();
    state.weather = { rain_mm: 0, wind_speed_kph: 0, wind_direction: 'N', event: 'calm' };
    state.cells = [
      { x: 5, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 5, y: 5, level: 1, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    const result = applyWeather(structuredClone(state));
    result.cells.forEach(c => {
      expect(c.survivedTicks).toBeUndefined();
    });
  });

  it('accumulates survivedTicks across multiple ticks', () => {
    let state = freshState();
    state.weather = { rain_mm: 0, wind_speed_kph: 0, wind_direction: 'N', event: 'calm' };
    state.cells = [
      { x: 5, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 5, y: 5, level: 2, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    for (let i = 0; i < 3; i++) {
      state = applyWeather(structuredClone(state));
      state.weather = { rain_mm: 0, wind_speed_kph: 0, wind_direction: 'N', event: 'calm' };
    }
    const l2 = state.cells.find(c => c.level === 2);
    expect(l2.survivedTicks).toBe(3);
  });
});
