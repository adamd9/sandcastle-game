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
    state.cells.push({ x: 3, y: 3, type: 'dry_sand', health: 40, owner: 'player1' });
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

  it('allows REMOVE own cell', () => {
    const state = freshState();
    state.cells.push({ x: 3, y: 3, type: 'dry_sand', health: 40, owner: 'player1' });
    const r = validateMove(state, 'player1', { action: 'REMOVE', x: 3, y: 3 });
    expect(r.valid).toBe(true);
  });

  it("rejects REMOVE of opponent's cell", () => {
    const state = freshState();
    state.cells.push({ x: 3, y: 3, type: 'dry_sand', health: 40, owner: 'player2' });
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
    state.cells.push({ x: 3, y: 3, type: 'dry_sand', health: 40, owner: 'player1' });
    const r = validateMove(state, 'player1', { action: 'REINFORCE', x: 3, y: 3 });
    expect(r.valid).toBe(true);
  });

  it('rejects REINFORCE on empty cell', () => {
    const r = validateMove(freshState(), 'player1', { action: 'REINFORCE', x: 3, y: 3 });
    expect(r.valid).toBe(false);
  });

  it('rejects when action budget exhausted', () => {
    const state = freshState();
    state.players.player1.actionsThisTick = 12;
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
    expect(next.cells[0]).toMatchObject({ x: 5, y: 5, type: 'packed_sand', health: 100, owner: 'player1' });
    expect(next.players.player1.actionsThisTick).toBe(1);
  });

  it('REMOVE deletes the cell', () => {
    const state = freshState();
    state.cells.push({ x: 5, y: 5, type: 'dry_sand', health: 40, owner: 'player1' });
    const next = applyMove(structuredClone(state), 'player1', { action: 'REMOVE', x: 5, y: 5 });
    expect(next.cells).toHaveLength(0);
  });

  it('REINFORCE increases health up to MAX_HEALTH', () => {
    const state = freshState();
    state.cells.push({ x: 5, y: 5, type: 'packed_sand', health: 90, owner: 'player1' });
    const next = applyMove(structuredClone(state), 'player1', { action: 'REINFORCE', x: 5, y: 5 });
    expect(next.cells[0].health).toBe(100); // 90 + 20 capped at 100
  });
});

describe('applyWeather', () => {
  it('applies rain damage to all cells', () => {
    const state = freshState();
    state.cells.push({ x: 5, y: 5, type: 'dry_sand', health: 40, owner: 'player1' });
    state.weather = { rain_mm: 5, wind_speed_kph: 0, wind_direction: 'N' };
    const next = applyWeather(structuredClone(state));
    // rainDamage(5) = floor(5*2) = 10
    expect(next.cells[0].health).toBe(30);
  });

  it('removes cells reduced to 0 health', () => {
    const state = freshState();
    state.cells.push({ x: 5, y: 5, type: 'dry_sand', health: 10, owner: 'player1' });
    state.weather = { rain_mm: 10, wind_speed_kph: 0, wind_direction: 'N' };
    const next = applyWeather(structuredClone(state));
    // rainDamage(10) = 20 > 10 → cell destroyed
    expect(next.cells).toHaveLength(0);
  });

  it('applies wind damage to windward-edge cells', () => {
    const state = freshState();
    // y=0 is the N edge — wind from N hits it
    state.cells.push({ x: 5, y: 0, type: 'dry_sand', health: 40, owner: 'player1' });
    state.weather = { rain_mm: 0, wind_speed_kph: 50, wind_direction: 'N' };
    const next = applyWeather(structuredClone(state));
    // windDamage(50) = floor(50/5) = 10
    expect(next.cells[0].health).toBe(30);
  });

  it('does not apply wind damage to sheltered cells', () => {
    const state = freshState();
    state.cells.push({ x: 5, y: 10, type: 'dry_sand', health: 40, owner: 'player1' });
    state.weather = { rain_mm: 0, wind_speed_kph: 50, wind_direction: 'N' };
    const next = applyWeather(structuredClone(state));
    expect(next.cells[0].health).toBe(40);
  });

  it('increments tick and resets actionsThisTick', () => {
    const state = freshState();
    state.players.player1.actionsThisTick = 5;
    state.players.player2.actionsThisTick = 3;
    state.weather = { rain_mm: 0, wind_speed_kph: 0, wind_direction: 'N' };
    const next = applyWeather(structuredClone(state));
    expect(next.tick).toBe(1);
    expect(next.players.player1.actionsThisTick).toBe(0);
    expect(next.players.player2.actionsThisTick).toBe(0);
  });
});
