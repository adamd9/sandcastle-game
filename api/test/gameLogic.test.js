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
  });
});

// ---------------------------------------------------------------------------
// computeStructureScore
// ---------------------------------------------------------------------------

import { computeStructureScore } from '../lib/gameLogic.js';

describe('computeStructureScore', () => {
  it('returns all zeros for empty board', () => {
    const score = computeStructureScore([], 'player1');
    expect(score).toEqual({ total_hp: 0, max_height: 0, footprint: 0, courtyard_bonus: 0 });
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
});
