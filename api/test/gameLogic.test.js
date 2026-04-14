import { describe, it, expect, beforeEach } from 'vitest';
import { validateMove, applyMove, applyWeather, computeStructureScore } from '../lib/gameLogic.js';

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

  describe('buttress validation', () => {
    it('allows PLACE buttress at level 0', () => {
      const r = validateMove(freshState(), 'player1', { action: 'PLACE', x: 5, y: 5, type: 'buttress' });
      expect(r.valid).toBe(true);
    });

    it('rejects PLACE buttress at level > 0', () => {
      const state = freshState();
      state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
      const r = validateMove(state, 'player1', { action: 'PLACE', x: 5, y: 6, type: 'buttress', level: 1 });
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/buttress/i);
    });

    it('allows REINFORCE on a buttress block', () => {
      const state = freshState();
      state.cells.push({ x: 5, y: 5, type: 'buttress', health: 10, owner: 'player1', level: 0 });
      const r = validateMove(state, 'player1', { action: 'REINFORCE', x: 5, y: 5 });
      expect(r.valid).toBe(true);
    });

    it('allows REPAIR_KIT on a buttress block', () => {
      const state = freshState();
      state.cells.push({ x: 5, y: 5, type: 'buttress', health: 5, owner: 'player1', level: 0 });
      const r = validateMove(state, 'player1', { action: 'REPAIR_KIT', x: 5, y: 5 });
      expect(r.valid).toBe(true);
    });

    it('allows normal blocks to be stacked on top of a buttress', () => {
      const state = freshState();
      state.cells.push({ x: 5, y: 5, type: 'buttress', health: 20, owner: 'player1', level: 0 });
      const r = validateMove(state, 'player1', { action: 'PLACE', x: 5, y: 5, type: 'packed_sand', level: 1 });
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

  it('REINFORCE on critically damaged block (health < 20) grants 30 HP instead of 15', () => {
    const state = freshState();
    state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 5, owner: 'player1', level: 0 });
    const next = applyMove(structuredClone(state), 'player1', { action: 'REINFORCE', x: 5, y: 5 });
    expect(next.cells[0].health).toBe(35); // 5 + 30 = 35
  });

  it('REINFORCE on block at exactly 20 HP grants standard 15 HP (not critical)', () => {
    const state = freshState();
    state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 20, owner: 'player1', level: 0 });
    const next = applyMove(structuredClone(state), 'player1', { action: 'REINFORCE', x: 5, y: 5 });
    expect(next.cells[0].health).toBe(35); // 20 + 15 = 35
  });

  it('REINFORCE critical healing is still capped at MAX_HEALTH', () => {
    const state = freshState();
    state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 15, owner: 'player1', level: 0 });
    const next = applyMove(structuredClone(state), 'player1', { action: 'REINFORCE', x: 5, y: 5 });
    expect(next.cells[0].health).toBe(45); // 15 + 30 = 45 (under cap)
  });

  it('REINFORCE critical healing on block adjacent to buttress caps at 70', () => {
    const state = freshState();
    state.cells.push({ x: 4, y: 5, type: 'buttress', health: 20, owner: 'player1', level: 0 });
    state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 10, owner: 'player1', level: 0 });
    const next = applyMove(structuredClone(state), 'player1', { action: 'REINFORCE', x: 5, y: 5 });
    expect(next.cells.find(c => c.x === 5).health).toBe(40); // 10 + 30 = 40 (under cap of 70)
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

  describe('buttress HP bonus', () => {
    it('PLACE buttress creates block with initial_health 20', () => {
      const state = freshState();
      const next = applyMove(structuredClone(state), 'player1', { action: 'PLACE', x: 5, y: 5, type: 'buttress' });
      expect(next.cells[0].health).toBe(20);
    });

    it('REINFORCE on block adjacent to same-owner buttress caps at 70 (MAX_HEALTH + BUTTRESS_HP_BONUS)', () => {
      const state = freshState();
      // Buttress at (4, 5); packed_sand at (5, 5) — adjacent, same owner
      state.cells.push({ x: 4, y: 5, type: 'buttress', health: 20, owner: 'player1', level: 0 });
      state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
      const next = applyMove(structuredClone(state), 'player1', { action: 'REINFORCE', x: 5, y: 5 });
      // 60 + 15 = 75, capped at 70 (buttress bonus)
      expect(next.cells.find(c => c.x === 5).health).toBe(70);
    });

    it('REINFORCE on block NOT adjacent to buttress still caps at 60 (MAX_HEALTH)', () => {
      const state = freshState();
      // Buttress at (4, 5); packed_sand at (7, 5) — not adjacent
      state.cells.push({ x: 4, y: 5, type: 'buttress', health: 20, owner: 'player1', level: 0 });
      state.cells.push({ x: 7, y: 5, type: 'packed_sand', health: 55, owner: 'player1', level: 0 });
      const next = applyMove(structuredClone(state), 'player1', { action: 'REINFORCE', x: 7, y: 5 });
      // 55 + 15 = 70, capped at 60 (no buttress bonus)
      expect(next.cells.find(c => c.x === 7).health).toBe(60);
    });

    it('REINFORCE adjacent to opponent buttress does NOT grant bonus', () => {
      const state = freshState();
      // Player2 buttress at (9, 5); player1 packed_sand at (8, 5) — adjacent but different owner
      state.cells.push({ x: 9, y: 5, type: 'buttress', health: 20, owner: 'player2', level: 0 });
      state.cells.push({ x: 8, y: 5, type: 'packed_sand', health: 55, owner: 'player1', level: 0 });
      const next = applyMove(structuredClone(state), 'player1', { action: 'REINFORCE', x: 8, y: 5 });
      // 55 + 15 = 70, capped at 60 (opponent buttress — no bonus)
      expect(next.cells.find(c => c.x === 8).health).toBe(60);
    });

    it('REPAIR_KIT on block adjacent to same-owner buttress restores to 70', () => {
      const state = freshState();
      state.cells.push({ x: 4, y: 5, type: 'buttress', health: 20, owner: 'player1', level: 0 });
      state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 10, owner: 'player1', level: 0 });
      const next = applyMove(structuredClone(state), 'player1', { action: 'REPAIR_KIT', x: 5, y: 5 });
      expect(next.cells.find(c => c.x === 5).health).toBe(70);
    });

    it('REPAIR_KIT on block NOT adjacent to buttress restores to 60', () => {
      const state = freshState();
      state.cells.push({ x: 4, y: 5, type: 'buttress', health: 20, owner: 'player1', level: 0 });
      state.cells.push({ x: 7, y: 5, type: 'packed_sand', health: 10, owner: 'player1', level: 0 });
      const next = applyMove(structuredClone(state), 'player1', { action: 'REPAIR_KIT', x: 7, y: 5 });
      expect(next.cells.find(c => c.x === 7).health).toBe(60);
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
  it('awards level multipliers: L0=1x, L1=1.2x, L2=1.5x, L3=2.0x', () => {
    const cells = [
      { x: 3, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 4, y: 5, level: 1, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 5, y: 5, level: 2, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 6, y: 5, level: 3, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    // 60*1 + 60*1.2 + 60*1.5 + 60*2.0 = 60 + 72 + 90 + 120 = 342
    expect(score.prestige_score).toBe(342);
  });

  it('grants 50% structural depth bonus for a fully-stacked column (L0–L3)', () => {
    const cells = [0, 1, 2, 3].map(level => ({
      x: 5, y: 5, level, type: 'packed_sand', health: 60, owner: 'player1',
    }));
    const score = computeStructureScore(cells, 'player1');
    // Raw column: 60*1 + 60*1.2 + 60*1.5 + 60*2.0 = 342; with 50% bonus: 342 * 1.5 = 513
    expect(score.prestige_score).toBe(513);
  });

  it('does not apply depth bonus when column is incomplete', () => {
    // Only L0 and L3 — not a complete column
    const cells = [
      { x: 5, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 5, y: 5, level: 3, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    // No bonus: 60*1 + 60*2.0 = 180
    expect(score.prestige_score).toBe(180);
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
    // tower col (6,10): L0=60*1=60, L1=60*1.2=72, L2=60*1.5=90 → L2 gets 25% bonus: 90*1.25=112.5
    // total = 30 + 60 + 72 + 112.5 = 274.5 → 275
    expect(score.prestige_score).toBe(275);
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
    // tower col (5,11): L0=60*1=60, L1=60*1.2=72, L2=60*1.5*1.25=112.5, L3=60*2.0*1.25=150 → raw sum=394.5
    // full column (L0–L3) depth bonus 50%: 394.5*1.5=591.75
    // total prestige = Math.round(30 + 591.75) = 622
    expect(score.prestige_score).toBe(622);
  });

  it('does NOT grant courtyard bonus to L0 or L1 blocks', () => {
    const cells = [
      { x: 5, y: 10, level: 0, type: 'courtyard', health: 30, owner: 'player1' },
      { x: 6, y: 10, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 6, y: 10, level: 1, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    // courtyard: 30, L0=60*1=60, L1=60*1.2=72 (no bonus for L0/L1)
    expect(score.prestige_score).toBe(162);
  });

  it('does NOT grant courtyard bonus when courtyard belongs to the opponent', () => {
    const cells = [
      { x: 5, y: 10, level: 0, type: 'courtyard', health: 30, owner: 'player2' },
      { x: 6, y: 10, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 6, y: 10, level: 1, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 6, y: 10, level: 2, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    // player1 has no courtyard; no bonus: L0=60*1=60, L1=60*1.2=72, L2=60*1.5=90
    expect(score.prestige_score).toBe(222);
  });

  it('does NOT grant courtyard bonus when tower is not adjacent (diagonal only)', () => {
    const cells = [
      { x: 5, y: 10, level: 0, type: 'courtyard', health: 30, owner: 'player1' },
      { x: 6, y: 11, level: 0, type: 'packed_sand', health: 60, owner: 'player1' }, // diagonal — not adjacent
      { x: 6, y: 11, level: 1, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 6, y: 11, level: 2, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    // courtyard: 30, L0=60*1=60, L1=60*1.2=72, L2=60*1.5=90 (no bonus since diagonal, not orthogonally adjacent)
    expect(score.prestige_score).toBe(252);
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
// computeStructureScore — buttress prestige score multiplier
// ---------------------------------------------------------------------------

describe('computeStructureScore — buttress prestige multiplier', () => {
  it('grants 1.2× prestige multiplier to blocks adjacent to a same-owner buttress', () => {
    const cells = [
      { x: 5, y: 10, level: 0, type: 'buttress', health: 20, owner: 'player1' },
      { x: 6, y: 10, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    // buttress at L0: 20*1 = 20 (no adjacent buttress, no multiplier)
    // sand at L0: 60*1 = 60, adjacent to buttress → 60 * 1.2 = 72
    // total = 20 + 72 = 92
    expect(score.prestige_score).toBe(92);
  });

  it('does NOT grant buttress multiplier when buttress belongs to the opponent', () => {
    const cells = [
      { x: 5, y: 10, level: 0, type: 'buttress', health: 20, owner: 'player2' },
      { x: 6, y: 10, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    // player1 has no buttress; no multiplier: 60*1 = 60
    expect(score.prestige_score).toBe(60);
  });

  it('does NOT grant buttress multiplier when block is diagonal (not orthogonally adjacent)', () => {
    const cells = [
      { x: 5, y: 10, level: 0, type: 'buttress', health: 20, owner: 'player1' },
      { x: 6, y: 11, level: 0, type: 'packed_sand', health: 60, owner: 'player1' }, // diagonal
    ];
    const score = computeStructureScore(cells, 'player1');
    // buttress: 20; sand: 60 (no multiplier — diagonal only)
    expect(score.prestige_score).toBe(80);
  });

  it('buttress multiplier stacks multiplicatively with courtyard tower bonus', () => {
    const cells = [
      { x: 4, y: 10, level: 0, type: 'courtyard', health: 30, owner: 'player1' },
      { x: 6, y: 10, level: 0, type: 'buttress', health: 20, owner: 'player1' },
      { x: 5, y: 10, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 5, y: 10, level: 1, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 5, y: 10, level: 2, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    // courtyard (4,10): 30*1 = 30 (not adjacent to buttress — distance=2, not adjacent)
    // buttress (6,10): 20*1 = 20 (adjacent to sand col at (5,10) but does not receive courtyard bonus — courtyard at x=4 is not adjacent to buttress at x=6)
    // sand col (5,10): adjacent to both buttress(6,10) and courtyard(4,10)
    //   L0: 60*1*1.2 = 72; adjacent to courtyard (4,10) → level<2, no courtyard bonus
    //   L1: 60*1.2*1.2 = 86.4; adjacent to courtyard (4,10) → level<2, no courtyard bonus
    //   L2: 60*1.5*1.2 = 108; adjacent to courtyard (4,10) → level>=2, ×1.25 = 135
    // total = 30 + 20 + 72 + 86.4 + 135 = 343.4 → 343
    expect(score.prestige_score).toBe(343);
  });

  it('buttress block itself contributes to prestige based on its health', () => {
    const cells = [
      { x: 5, y: 10, level: 0, type: 'buttress', health: 20, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    // buttress at L0: 20 * 1 = 20 (no adjacent buttress)
    expect(score.prestige_score).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// computeStructureScore — crown prestige multiplier
// ---------------------------------------------------------------------------

describe('computeStructureScore — crown prestige multiplier', () => {
  it('doubles the prestige of a column topped with a crown block', () => {
    const cells = [
      { x: 5, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 5, y: 5, level: 1, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 5, y: 5, level: 2, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 5, y: 5, level: 3, type: 'crown',       health: 40, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    // Raw col (before depth/crown): 60*1 + 60*1.2 + 60*1.5 + 40*2.0 = 60+72+90+80 = 302
    // Full column (L0–L3): 302 * 1.5 = 453
    // Crown doubles the column: 453 * 2 = 906
    expect(score.prestige_score).toBe(906);
  });

  it('crown_count is 1 when a crown tops a column', () => {
    const cells = [
      { x: 5, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 5, y: 5, level: 3, type: 'crown',       health: 40, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    expect(score.crown_count).toBe(1);
  });

  it('crown_count is 0 when no crown blocks exist', () => {
    const cells = [
      { x: 5, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    expect(score.crown_count).toBe(0);
  });

  it('crown block itself contributes prestige based on its health and level multiplier', () => {
    const cells = [
      { x: 5, y: 5, level: 3, type: 'crown', health: 40, owner: 'player1' },
    ];
    const score = computeStructureScore(cells, 'player1');
    // crown at L3: 40*2.0 = 80; column topped with crown → *2.0 = 160
    expect(score.prestige_score).toBe(160);
  });
});

// ---------------------------------------------------------------------------
// validateMove — crown placement
// ---------------------------------------------------------------------------

describe('validateMove — crown placement', () => {
  it('allows PLACE crown at level 3 with a foundation below', () => {
    const state = freshState();
    state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 2 });
    const r = validateMove(state, 'player1', { action: 'PLACE', x: 5, y: 5, type: 'crown', level: 3 });
    expect(r.valid).toBe(true);
  });

  it('rejects PLACE crown at level 0', () => {
    const state = freshState();
    const r = validateMove(state, 'player1', { action: 'PLACE', x: 5, y: 5, type: 'crown', level: 0 });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/level 3/);
  });

  it('rejects PLACE crown at level 1', () => {
    const state = freshState();
    state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
    const r = validateMove(state, 'player1', { action: 'PLACE', x: 5, y: 5, type: 'crown', level: 1 });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/level 3/);
  });

  it('rejects PLACE crown at level 2', () => {
    const state = freshState();
    state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 1 });
    const r = validateMove(state, 'player1', { action: 'PLACE', x: 5, y: 5, type: 'crown', level: 2 });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/level 3/);
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

describe('parapet validation', () => {
  it('allows PLACE parapet at level 1 with foundation', () => {
    const state = freshState();
    state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
    const r = validateMove(state, 'player1', { action: 'PLACE', x: 5, y: 5, type: 'parapet', level: 1 });
    expect(r.valid).toBe(true);
  });

  it('allows PLACE parapet at level 2 with foundation', () => {
    const state = freshState();
    state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
    state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 1 });
    const r = validateMove(state, 'player1', { action: 'PLACE', x: 5, y: 5, type: 'parapet', level: 2 });
    expect(r.valid).toBe(true);
  });

  it('rejects PLACE parapet at level 0', () => {
    const r = validateMove(freshState(), 'player1', { action: 'PLACE', x: 5, y: 5, type: 'parapet', level: 0 });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/parapet/i);
  });

  it('rejects PLACE parapet at level 3', () => {
    const state = freshState();
    state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
    state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 1 });
    state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 2 });
    const r = validateMove(state, 'player1', { action: 'PLACE', x: 5, y: 5, type: 'parapet', level: 3 });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/parapet/i);
  });

  it('allows REINFORCE on a parapet block', () => {
    const state = freshState();
    state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
    state.cells.push({ x: 5, y: 5, type: 'parapet', health: 10, owner: 'player1', level: 1 });
    const r = validateMove(state, 'player1', { action: 'REINFORCE', x: 5, y: 5, level: 1 });
    expect(r.valid).toBe(true);
  });

  it('allows REPAIR_KIT on a parapet block', () => {
    const state = freshState();
    state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
    state.cells.push({ x: 5, y: 5, type: 'parapet', health: 5, owner: 'player1', level: 1 });
    const r = validateMove(state, 'player1', { action: 'REPAIR_KIT', x: 5, y: 5, level: 1 });
    expect(r.valid).toBe(true);
  });

  it('parapet on windward edge reduces wind damage to column top block by 50%', () => {
    // Use x=0 (on west edge for W wind) for a non-water row
    const state = freshState();
    state.weather = { rain_mm: 0, wind_speed_kph: 30, wind_direction: 'W', event: 'normal' };
    // Column x=0, y=5: packed_sand L0, parapet L1 (on windward west edge for W wind)
    state.cells = [
      { x: 0, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 0 },
      { x: 0, y: 5, type: 'parapet', health: 35, owner: 'player1', level: 1 },
    ];
    const result = applyWeather(structuredClone(state));
    const parapetCell = result.cells.find(c => c.x === 0 && c.y === 5 && c.level === 1);
    // wind damage = floor(30/3) = 10; with 50% parapet reduction = round(10 * 0.5) = 5
    // rain damage: rainDamage(0) = BASE_DAMAGE(3) + floor(0 * 10) = 3 (base erosion always applies)
    // total = 3 + 5 = 8, parapet health = 35 - 8 = 27
    const windDmgFull = Math.floor(30 / 3); // 10
    const windDmgReduced = Math.round(windDmgFull * 0.5); // 5
    const rainDmg = 3; // BASE_DAMAGE always applies regardless of rain_mm
    expect(parapetCell.health).toBe(35 - (rainDmg + windDmgReduced));
  });

  it('parapet NOT on windward edge gives no wind reduction', () => {
    // Wind from W: windward edge is x=0; parapet at x=5 (not on edge) should not reduce wind
    const state = freshState();
    state.weather = { rain_mm: 0, wind_speed_kph: 30, wind_direction: 'W', event: 'normal' };
    state.cells = [
      { x: 5, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 0 },
      { x: 5, y: 5, type: 'parapet', health: 35, owner: 'player1', level: 1 },
    ];
    const result = applyWeather(structuredClone(state));
    const parapetCell = result.cells.find(c => c.x === 5 && c.y === 5 && c.level === 1);
    // Not on windward edge, so no wind damage (wind only hits edge blocks in normal weather)
    const rainDmg = 3;
    expect(parapetCell.health).toBe(35 - rainDmg);
  });

  it('column topped with parapet gets 10% prestige bonus in computeStructureScore', () => {
    // Two identical columns except one is topped with parapet, other with packed_sand
    const cells = [
      // Column with parapet top
      { x: 1, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 0 },
      { x: 1, y: 5, type: 'parapet',     health: 35, owner: 'player1', level: 1 },
      // Column with packed_sand top
      { x: 2, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 0 },
      { x: 2, y: 5, type: 'packed_sand', health: 35, owner: 'player1', level: 1 },
    ];
    const score = computeStructureScore(cells, 'player1');
    expect(score.parapet_count).toBe(1);
    // Column 1 prestige should be slightly higher than column 2 due to parapet 10% bonus
    // Both base: L0=60*1=60, L1=35*1.5=52.5 → base=112.5
    // Parapet column: 112.5 * 1.1 = 123.75; plain column: 112.5
    // Total = round(123.75 + 112.5) = round(236.25) = 236
    expect(score.prestige_score).toBeGreaterThan(0);
  });
});

describe('reinforced_wall validation', () => {
  it('allows PLACE reinforced_wall at level 0 when adjacent to packed_sand', () => {
    const state = freshState();
    state.cells.push({ x: 4, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
    const r = validateMove(state, 'player1', { action: 'PLACE', x: 5, y: 5, type: 'reinforced_wall', level: 0 });
    expect(r.valid).toBe(true);
  });

  it('allows PLACE reinforced_wall adjacent to another reinforced_wall', () => {
    const state = freshState();
    state.cells.push({ x: 4, y: 5, type: 'reinforced_wall', health: 80, owner: 'player1', level: 0 });
    const r = validateMove(state, 'player1', { action: 'PLACE', x: 5, y: 5, type: 'reinforced_wall', level: 0 });
    expect(r.valid).toBe(true);
  });

  it('rejects PLACE reinforced_wall at level 1 without level-0 foundation at that position', () => {
    const state = freshState();
    // (4,5) has both level 0 and 1 — making it adjacent at level 1 — but (5,6) has no L0 foundation
    state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
    state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 1 });
    state.cells.push({ x: 4, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
    state.cells.push({ x: 4, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 1 });
    const r = validateMove(state, 'player1', { action: 'PLACE', x: 5, y: 6, type: 'reinforced_wall', level: 1 });
    expect(r.valid).toBe(false); // No foundation at (5,6) level 0
  });

  it('rejects PLACE reinforced_wall without adjacent qualifying block', () => {
    const state = freshState();
    // Only dry_sand nearby — not packed_sand or reinforced_wall
    state.cells.push({ x: 4, y: 5, type: 'dry_sand', health: 25, owner: 'player1', level: 0 });
    const r = validateMove(state, 'player1', { action: 'PLACE', x: 5, y: 5, type: 'reinforced_wall', level: 0 });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/adjacent/i);
  });

  it('rejects PLACE reinforced_wall in isolation (no neighbors)', () => {
    const r = validateMove(freshState(), 'player1', { action: 'PLACE', x: 5, y: 5, type: 'reinforced_wall', level: 0 });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/adjacent/i);
  });

  it('rejects PLACE reinforced_wall adjacent to opponent packed_sand', () => {
    const state = freshState();
    // Adjacent packed_sand belongs to player2 — should not count
    state.cells.push({ x: 4, y: 5, type: 'packed_sand', health: 60, owner: 'player2', level: 0 });
    const r = validateMove(state, 'player1', { action: 'PLACE', x: 5, y: 5, type: 'reinforced_wall', level: 0 });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/adjacent/i);
  });

  it('rejects PLACE reinforced_wall at level 3', () => {
    const state = freshState();
    // Build a column up to level 2
    for (let l = 0; l < 3; l++) {
      state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: l });
    }
    const r = validateMove(state, 'player1', { action: 'PLACE', x: 5, y: 5, type: 'reinforced_wall', level: 3 });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/reinforced wall/i);
  });

  it('reinforced_wall costs 2 actions (rejects when only 1 action left)', () => {
    const state = freshState();
    state.players.player1.actionsThisTick = 19; // 1 left
    state.cells.push({ x: 4, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
    const r = validateMove(state, 'player1', { action: 'PLACE', x: 5, y: 5, type: 'reinforced_wall', level: 0 });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/2 actions/i);
  });

  it('reinforced_wall costs 2 actions (allowed when 2 actions left)', () => {
    const state = freshState();
    state.players.player1.actionsThisTick = 18; // 2 left
    state.cells.push({ x: 4, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
    const r = validateMove(state, 'player1', { action: 'PLACE', x: 5, y: 5, type: 'reinforced_wall', level: 0 });
    expect(r.valid).toBe(true);
  });

  it('placing reinforced_wall increments actionsThisTick by 2', () => {
    const state = freshState();
    state.cells.push({ x: 4, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
    const newState = applyMove(structuredClone(state), 'player1', { action: 'PLACE', x: 5, y: 5, type: 'reinforced_wall', level: 0 });
    expect(newState.players.player1.actionsThisTick).toBe(2);
  });

  it('reinforced_wall has initial_health of 80', () => {
    const state = freshState();
    state.cells.push({ x: 4, y: 5, type: 'packed_sand', health: 60, owner: 'player1', level: 0 });
    const newState = applyMove(structuredClone(state), 'player1', { action: 'PLACE', x: 5, y: 5, type: 'reinforced_wall', level: 0 });
    const wall = newState.cells.find(c => c.type === 'reinforced_wall');
    expect(wall).toBeDefined();
    expect(wall.health).toBe(80);
  });

  it('REINFORCE on reinforced_wall caps at 80 HP', () => {
    const state = freshState();
    state.cells.push({ x: 5, y: 5, type: 'reinforced_wall', health: 75, owner: 'player1', level: 0 });
    const newState = applyMove(structuredClone(state), 'player1', { action: 'REINFORCE', x: 5, y: 5, level: 0 });
    const wall = newState.cells.find(c => c.type === 'reinforced_wall');
    expect(wall.health).toBe(80); // capped at 80, not 90 (75 + 15)
  });

  it('REPAIR_KIT on reinforced_wall restores to 80 HP', () => {
    const state = freshState();
    state.cells.push({ x: 5, y: 5, type: 'reinforced_wall', health: 10, owner: 'player1', level: 0 });
    const newState = applyMove(structuredClone(state), 'player1', { action: 'REPAIR_KIT', x: 5, y: 5, level: 0 });
    const wall = newState.cells.find(c => c.type === 'reinforced_wall');
    expect(wall.health).toBe(80);
  });

  it('reinforced_wall grants 15% damage reduction to block behind it (away from nearest edge)', () => {
    // Player1 zone x=0-9; reinforced_wall at x=0 means nearest edge is x=0 (left)
    // "behind" = direction away from left edge = x+1, so block at x=1 gets protection
    const state = freshState();
    state.weather = { rain_mm: 0, wind_speed_kph: 0, wind_direction: 'N', event: 'normal' };
    state.cells = [
      { x: 0, y: 5, type: 'reinforced_wall', health: 80, owner: 'player1', level: 0 },
      { x: 1, y: 5, type: 'packed_sand',     health: 60, owner: 'player1', level: 0 },
    ];
    const result = applyWeather(structuredClone(state));
    // Base damage = BASE_DAMAGE(3) + rain(0) = 3; with 15% reduction = floor(3 * 0.85) = 2
    const inner = result.cells.find(c => c.x === 1 && c.y === 5);
    expect(inner).toBeDefined();
    expect(inner.health).toBe(60 - Math.floor(3 * (1 - 0.15))); // 60 - 2 = 58
  });

  it('reinforced_wall itself takes full damage (no self-protection)', () => {
    const state = freshState();
    state.weather = { rain_mm: 0, wind_speed_kph: 0, wind_direction: 'N', event: 'normal' };
    state.cells = [
      { x: 0, y: 5, type: 'reinforced_wall', health: 80, owner: 'player1', level: 0 },
      { x: 1, y: 5, type: 'packed_sand',     health: 60, owner: 'player1', level: 0 },
    ];
    const result = applyWeather(structuredClone(state));
    // reinforced_wall itself: base damage = 3 (no reduction for the wall itself)
    const wall = result.cells.find(c => c.x === 0 && c.y === 5);
    expect(wall).toBeDefined();
    expect(wall.health).toBe(77); // 80 - 3
  });

  it('block on wrong side of reinforced_wall does NOT get protection', () => {
    // Wall at x=0; nearest edge is left (x=0), so "behind" direction is x+1
    // Block at x=-1 would be "in front" but x=-1 is off grid
    // Block at (0, 4) is north of the wall; it should NOT get protection
    const state = freshState();
    state.weather = { rain_mm: 0, wind_speed_kph: 0, wind_direction: 'N', event: 'normal' };
    state.cells = [
      { x: 0, y: 5, type: 'reinforced_wall', health: 80, owner: 'player1', level: 0 },
      { x: 0, y: 4, type: 'packed_sand',     health: 60, owner: 'player1', level: 0 },
    ];
    const result = applyWeather(structuredClone(state));
    // (0, 4) is to the NORTH of the wall, not behind it — no protection
    const north = result.cells.find(c => c.x === 0 && c.y === 4);
    expect(north).toBeDefined();
    expect(north.health).toBe(57); // 60 - 3 (full damage, no reduction)
  });
});

