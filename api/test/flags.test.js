import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../server.js';
import { resetState, getState, saveState } from '../lib/store.js';

process.env.PLAYER1_API_KEY = 'test-key-p1';
process.env.PLAYER2_API_KEY = 'test-key-p2';
process.env.TICK_ADMIN_KEY  = 'test-key-tick';

// Helper: call an MCP tool
async function mcpCall(key, tool, args) {
  return request(app)
    .post('/mcp')
    .set('X-Api-Key', key)
    .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } });
}

beforeEach(() => {
  resetState();
});

// ---------------------------------------------------------------------------
// 1. place_flag via MCP — places flag, appears in GET /state
// ---------------------------------------------------------------------------
describe('place_flag MCP tool', () => {
  it('places a flag on own block and appears in GET /state', async () => {
    // Seed a player1-owned block directly into state
    const s = await getState();
    s.cells.push({ x: 5, y: 5, level: 0, owner: 'player1', type: 'packed_sand', health: 100 });
    await saveState(s);

    const res = await mcpCall('test-key-p1', 'place_flag', { x: 5, y: 5, level: 0, label: 'main wall' });
    expect(res.status).toBe(200);
    const result = JSON.parse(res.body.result?.content?.[0]?.text);
    expect(result.ok).toBe(true);
    expect(result.flag).toMatchObject({ x: 5, y: 5, level: 0, owner: 'player1', label: 'main wall' });
    expect(result.flag.id).toMatch(/^flag_/);

    // Verify in GET /state
    const stateRes = await request(app).get('/state');
    expect(stateRes.body.flags).toEqual(expect.arrayContaining([
      expect.objectContaining({ x: 5, y: 5, level: 0, label: 'main wall', owner: 'player1' }),
    ]));
  });

  // -------------------------------------------------------------------------
  // 2. place_flag on non-existent cell — returns error
  // -------------------------------------------------------------------------
  it('returns error when placing flag on non-existent cell', async () => {
    const res = await mcpCall('test-key-p1', 'place_flag', { x: 5, y: 5, level: 0, label: 'phantom' });
    expect(res.status).toBe(200);
    expect(res.body.result?.isError).toBe(true);
    const result = JSON.parse(res.body.result?.content?.[0]?.text);
    expect(result.error).toMatch(/No block/);
  });

  // -------------------------------------------------------------------------
  // 3. place_flag on opponent's cell — returns error
  // -------------------------------------------------------------------------
  it('returns error when placing flag on opponent cell', async () => {
    // Directly seed a god-owned cell into state
    const s = await getState();
    s.cells.push({ x: 5, y: 5, level: 0, owner: 'god', type: 'packed_sand', health: 100 });
    await saveState(s);

    // Cell is owned by 'god', not player1 → should get "belongs to" error
    const res = await mcpCall('test-key-p1', 'place_flag', { x: 5, y: 5, level: 0, label: 'claimed' });
    expect(res.status).toBe(200);
    expect(res.body.result?.isError).toBe(true);
    const result = JSON.parse(res.body.result?.content?.[0]?.text);
    expect(result.error).toMatch(/belongs to/);
  });

  // -------------------------------------------------------------------------
  // 4. place_flag replaces existing flag at same position
  // -------------------------------------------------------------------------
  it('replaces existing flag at same position', async () => {
    const s = await getState();
    s.cells.push({ x: 3, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' });
    s.flags.push({ id: 'flag_old', x: 3, y: 5, level: 0, owner: 'player1', label: 'old label' });
    await saveState(s);

    const res = await mcpCall('test-key-p1', 'place_flag', { x: 3, y: 5, level: 0, label: 'new label' });
    expect(res.status).toBe(200);
    const result = JSON.parse(res.body.result?.content?.[0]?.text);
    expect(result.ok).toBe(true);

    const stateRes = await request(app).get('/state');
    const flagsAt = stateRes.body.flags.filter(f => f.x === 3 && f.y === 5 && f.level === 0);
    expect(flagsAt).toHaveLength(1);
    expect(flagsAt[0].label).toBe('new label');
  });
});

// ---------------------------------------------------------------------------
// 5. Flag destroyed when block destroyed by weather
// ---------------------------------------------------------------------------
describe('flags destroyed with block', () => {
  it('removes flag when host block is destroyed by weather', async () => {
    // Place a block owned by player1 at a low-health position
    const s = await getState();
    s.cells.push({ x: 5, y: 5, level: 0, type: 'dry_sand', health: 1, owner: 'player1' });
    s.flags.push({ id: 'flag_doomed', x: 5, y: 5, level: 0, owner: 'player1', label: 'doomed tower' });
    await saveState(s);

    // Tick with heavy rain to destroy the cell (rain_mm=50 → 505 damage)
    await request(app)
      .post('/god/tick')
      .set('X-Api-Key', 'test-key-tick')
      .send({ rain_mm: 50, wind_speed_kph: 0, weather_event: 'normal' });

    const stateRes = await request(app).get('/state');
    const remainingFlags = stateRes.body.flags.filter(f => f.x === 5 && f.y === 5 && f.level === 0);
    expect(remainingFlags).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Flag cascade: REMOVE level 0 via god_edits removes flags at level >= 0
// ---------------------------------------------------------------------------
describe('flag cascade on REMOVE', () => {
  it('removes flags at same (x,y) with level >= removed level when god_edits REMOVE is used', async () => {
    // Seed state with blocks and flags at multiple levels
    const s = await getState();
    s.cells.push(
      { x: 4, y: 6, level: 0, type: 'packed_sand', health: 60, owner: 'player1' },
      { x: 4, y: 6, level: 1, type: 'packed_sand', health: 60, owner: 'player1' },
    );
    s.flags.push(
      { id: 'flag_l0', x: 4, y: 6, level: 0, owner: 'player1', label: 'base' },
      { id: 'flag_l1', x: 4, y: 6, level: 1, owner: 'player1', label: 'tower' },
    );
    await saveState(s);

    // Use god tick with REMOVE god_edit to cascade remove from level 0
    await request(app)
      .post('/god/tick')
      .set('X-Api-Key', 'test-key-tick')
      .send({
        rain_mm: 0, wind_speed_kph: 0,
        god_edits: [{ action: 'REMOVE', x: 4, y: 6, level: 0 }],
      });

    const stateRes = await request(app).get('/state');
    const remainingFlags = stateRes.body.flags.filter(f => f.x === 4 && f.y === 6);
    expect(remainingFlags).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7. God mode PLACE_FLAG via god_edits — appears in state
// ---------------------------------------------------------------------------
describe('god_edits PLACE_FLAG', () => {
  it('places a god flag via god_edits and it appears in GET /state', async () => {
    await request(app)
      .post('/god/tick')
      .set('X-Api-Key', 'test-key-tick')
      .send({
        rain_mm: 0, wind_speed_kph: 0,
        god_edits: [
          { action: 'PLACE', x: 10, y: 5, level: 0, type: 'packed_sand' },
          { action: 'PLACE_FLAG', x: 10, y: 5, level: 0, label: 'god marker' },
        ],
      });

    const stateRes = await request(app).get('/state');
    expect(stateRes.body.flags).toEqual(expect.arrayContaining([
      expect.objectContaining({ x: 10, y: 5, level: 0, owner: 'god', label: 'god marker' }),
    ]));
  });

  it('ignores PLACE_FLAG with empty label', async () => {
    const s = await getState();
    const flagsBefore = (s.flags || []).length;

    await request(app)
      .post('/god/tick')
      .set('X-Api-Key', 'test-key-tick')
      .send({
        rain_mm: 0, wind_speed_kph: 0,
        god_edits: [{ action: 'PLACE_FLAG', x: 10, y: 5, level: 0, label: '' }],
      });

    const stateRes = await request(app).get('/state');
    expect(stateRes.body.flags).toHaveLength(flagsBefore);
  });
});

// ---------------------------------------------------------------------------
// 8. God mode REMOVE_FLAG via god_edits — removes flag
// ---------------------------------------------------------------------------
describe('god_edits REMOVE_FLAG', () => {
  it('removes a flag via god_edits', async () => {
    const s = await getState();
    s.flags.push({ id: 'flag_123', x: 7, y: 8, level: 0, owner: 'god', label: 'to be removed' });
    await saveState(s);

    await request(app)
      .post('/god/tick')
      .set('X-Api-Key', 'test-key-tick')
      .send({
        rain_mm: 0, wind_speed_kph: 0,
        god_edits: [{ action: 'REMOVE_FLAG', x: 7, y: 8, level: 0 }],
      });

    const stateRes = await request(app).get('/state');
    const remaining = stateRes.body.flags.filter(f => f.x === 7 && f.y === 8 && f.level === 0);
    expect(remaining).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// remove_flag MCP tool
// ---------------------------------------------------------------------------
describe('remove_flag MCP tool', () => {
  it('removes own flag successfully', async () => {
    const s = await getState();
    s.cells.push({ x: 2, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' });
    s.flags.push({ id: 'flag_mine', x: 2, y: 5, level: 0, owner: 'player1', label: 'my tower' });
    await saveState(s);

    const res = await mcpCall('test-key-p1', 'remove_flag', { x: 2, y: 5, level: 0 });
    expect(res.status).toBe(200);
    const result = JSON.parse(res.body.result?.content?.[0]?.text);
    expect(result.ok).toBe(true);

    const stateRes = await request(app).get('/state');
    expect(stateRes.body.flags.filter(f => f.x === 2 && f.y === 5 && f.level === 0)).toHaveLength(0);
  });

  it('returns error when removing flag that does not exist', async () => {
    const res = await mcpCall('test-key-p1', 'remove_flag', { x: 9, y: 9, level: 0 });
    expect(res.status).toBe(200);
    expect(res.body.result?.isError).toBe(true);
  });

  it('returns error when removing another player flag', async () => {
    const s = await getState();
    s.flags.push({ id: 'flag_theirs', x: 6, y: 7, level: 0, owner: 'player2', label: 'not mine' });
    await saveState(s);

    const res = await mcpCall('test-key-p1', 'remove_flag', { x: 6, y: 7, level: 0 });
    expect(res.status).toBe(200);
    expect(res.body.result?.isError).toBe(true);
    const result = JSON.parse(res.body.result?.content?.[0]?.text);
    expect(result.error).toMatch(/belongs to/);
  });
});
