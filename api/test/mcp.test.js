import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../server.js';
import { resetState } from '../lib/store.js';
import { ACTIONS_PER_TICK } from '../lib/rules.js';

process.env.PLAYER1_API_KEY = 'test-key-p1';
process.env.PLAYER2_API_KEY = 'test-key-p2';

beforeEach(() => {
  resetState();
});

describe('POST /mcp', () => {
  it('rejects missing API key with 401', async () => {
    const res = await request(app)
      .post('/mcp')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(401);
  });

  it('returns tool list for authenticated player', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('X-Api-Key', 'test-key-p1')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(200);
    const tools = res.body.result?.tools ?? [];
    const names = tools.map(t => t.name);
    expect(names).toContain('get_state');
    expect(names).toContain('get_rules');
    expect(names).toContain('submit_turn');
    expect(names).toContain('get_my_zone_state');
    expect(names).toContain('get_flags');
  });

  it('get_rules includes flag mechanics', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('X-Api-Key', 'test-key-p1')
      .send({
        jsonrpc: '2.0', id: 1,
        method: 'tools/call',
        params: { name: 'get_rules', arguments: {} },
      });
    expect(res.status).toBe(200);
    const text = res.body.result?.content?.[0]?.text;
    expect(text).toBeDefined();
    const rules = JSON.parse(text);
    expect(rules).toHaveProperty('flag_mechanics');
    expect(rules.flag_mechanics).toHaveProperty('damage_reduction', 0.5);
    expect(rules.flag_mechanics).toHaveProperty('min_spacing', 4);
    expect(rules.flag_mechanics).toHaveProperty('protection_model');
    expect(rules.flag_mechanics).toHaveProperty('strategy');
  });

  it('get_rules includes moat mechanics', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('X-Api-Key', 'test-key-p1')
      .send({
        jsonrpc: '2.0', id: 1,
        method: 'tools/call',
        params: { name: 'get_rules', arguments: {} },
      });
    expect(res.status).toBe(200);
    const text = res.body.result?.content?.[0]?.text;
    expect(text).toBeDefined();
    const rules = JSON.parse(text);
    expect(rules).toHaveProperty('moat_mechanics');
    expect(rules.moat_mechanics).toHaveProperty('damage_reduction', 0.25);
    expect(rules.moat_mechanics).toHaveProperty('permanence');
    expect(rules.moat_mechanics).toHaveProperty('adjacency_protection');
    expect(rules.moat_mechanics).toHaveProperty('strategy');
  });

  it('get_state returns game state', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('X-Api-Key', 'test-key-p1')
      .send({
        jsonrpc: '2.0', id: 1,
        method: 'tools/call',
        params: { name: 'get_state', arguments: {} },
      });
    expect(res.status).toBe(200);
    const text = res.body.result?.content?.[0]?.text;
    expect(text).toBeDefined();
    const parsed = JSON.parse(text);
    expect(parsed).toHaveProperty('current_state');
    expect(parsed.current_state).toHaveProperty('tick');
    expect(parsed.current_state).toHaveProperty('my_player', 'player1');
    expect(parsed.current_state).toHaveProperty('my_blocks');
    expect(parsed).toHaveProperty('recent_history');
    // Structure scores should always be present
    expect(parsed.current_state).toHaveProperty('my_structure_score');
    expect(parsed.current_state).toHaveProperty('opponent_structure_score');
    expect(parsed.current_state.my_structure_score).toHaveProperty('total_hp');
    expect(parsed.current_state.my_structure_score).toHaveProperty('total_blocks');
    expect(parsed.current_state.my_structure_score).toHaveProperty('avg_health');
    expect(parsed.current_state.my_structure_score).toHaveProperty('max_height');
    expect(parsed.current_state.my_structure_score).toHaveProperty('footprint');
    expect(parsed.current_state.my_structure_score).toHaveProperty('perimeter_integrity');
    expect(parsed.current_state.my_structure_score).toHaveProperty('architectural_complexity');
    expect(parsed.current_state.my_structure_score).toHaveProperty('courtyard_bonus');
    // Score breakdown mirrors structure score for AI discoverability
    expect(parsed.current_state).toHaveProperty('my_score_breakdown');
    expect(parsed.current_state).toHaveProperty('opponent_score_breakdown');
    expect(parsed.current_state.my_score_breakdown).toHaveProperty('total_blocks');
    expect(parsed.current_state.my_score_breakdown).toHaveProperty('avg_health');
    expect(parsed.current_state.my_score_breakdown).toHaveProperty('perimeter_integrity');
    expect(parsed.current_state.my_score_breakdown).toHaveProperty('architectural_complexity');
    // flag_coverage and damage_preview are always present
    expect(parsed.current_state).toHaveProperty('flag_coverage');
    expect(Array.isArray(parsed.current_state.flag_coverage)).toBe(true);
    expect(parsed.current_state).toHaveProperty('damage_preview');
    expect(parsed.current_state.damage_preview).toHaveProperty('weather_assumption');
    expect(parsed.current_state.damage_preview).toHaveProperty('damage_per_top_block');
    expect(parsed.current_state.damage_preview).toHaveProperty('blocks_at_risk');
    expect(Array.isArray(parsed.current_state.damage_preview.damage_per_top_block)).toBe(true);
    expect(Array.isArray(parsed.current_state.damage_preview.blocks_at_risk)).toBe(true);
  });

  it('get_state flag_coverage lists protected blocks for each flag', async () => {
    // Place a block then flag it
    await request(app)
      .post('/mcp')
      .set('X-Api-Key', 'test-key-p1')
      .send({
        jsonrpc: '2.0', id: 1,
        method: 'tools/call',
        params: {
          name: 'submit_turn',
          arguments: { moves: [{ action: 'PLACE', x: 5, y: 5, block_type: 'packed_sand' }] },
        },
      });
    await request(app)
      .post('/mcp')
      .set('X-Api-Key', 'test-key-p1')
      .send({
        jsonrpc: '2.0', id: 1,
        method: 'tools/call',
        params: { name: 'place_flag', arguments: { x: 5, y: 5, level: 0, label: 'TestTower' } },
      });

    const res = await request(app)
      .post('/mcp')
      .set('X-Api-Key', 'test-key-p1')
      .send({
        jsonrpc: '2.0', id: 1,
        method: 'tools/call',
        params: { name: 'get_state', arguments: {} },
      });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body.result?.content?.[0]?.text);
    const coverage = parsed.current_state.flag_coverage;
    expect(coverage).toHaveLength(1);
    expect(coverage[0].flag.label).toBe('TestTower');
    expect(Array.isArray(coverage[0].protected_blocks)).toBe(true);
    expect(coverage[0].protected_blocks).toHaveLength(1);
    expect(coverage[0].protected_blocks[0]).toMatchObject({ x: 5, y: 5, level: 0 });
  });

  it('get_state damage_preview shows expected damage for placed blocks', async () => {
    // Place a block so damage_per_top_block is non-empty
    await request(app)
      .post('/mcp')
      .set('X-Api-Key', 'test-key-p1')
      .send({
        jsonrpc: '2.0', id: 1,
        method: 'tools/call',
        params: {
          name: 'submit_turn',
          arguments: { moves: [{ action: 'PLACE', x: 5, y: 5, block_type: 'packed_sand' }] },
        },
      });

    const res = await request(app)
      .post('/mcp')
      .set('X-Api-Key', 'test-key-p1')
      .send({
        jsonrpc: '2.0', id: 1,
        method: 'tools/call',
        params: { name: 'get_state', arguments: {} },
      });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body.result?.content?.[0]?.text);
    const preview = parsed.current_state.damage_preview;
    expect(preview.damage_per_top_block.length).toBeGreaterThan(0);
    const block = preview.damage_per_top_block.find(b => b.x === 5 && b.y === 5);
    expect(block).toBeDefined();
    expect(block).toHaveProperty('expected_damage');
    expect(block).toHaveProperty('flag_protected', false);
    expect(block).toHaveProperty('moat_protected', false);
    expect(block).toHaveProperty('health');
    expect(block).toHaveProperty('type', 'packed_sand');
  });

  it('get_state blocks_at_risk includes blocks with health <= expected damage', async () => {
    // Place a dry_sand block (health=25), which may be at risk with enough rain
    await request(app)
      .post('/mcp')
      .set('X-Api-Key', 'test-key-p1')
      .send({
        jsonrpc: '2.0', id: 1,
        method: 'tools/call',
        params: {
          name: 'submit_turn',
          arguments: { moves: [{ action: 'PLACE', x: 5, y: 5, block_type: 'dry_sand' }] },
        },
      });

    const res = await request(app)
      .post('/mcp')
      .set('X-Api-Key', 'test-key-p1')
      .send({
        jsonrpc: '2.0', id: 1,
        method: 'tools/call',
        params: { name: 'get_state', arguments: {} },
      });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body.result?.content?.[0]?.text);
    const preview = parsed.current_state.damage_preview;
    // blocks_at_risk should contain only blocks where health <= expected_damage
    for (const b of preview.blocks_at_risk) {
      expect(b.health).toBeLessThanOrEqual(b.expected_damage);
    }
  });

  it('submit_turn places multiple blocks and auto-commits', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('X-Api-Key', 'test-key-p1')
      .send({
        jsonrpc: '2.0', id: 1,
        method: 'tools/call',
        params: {
          name: 'submit_turn',
          arguments: {
            moves: [
              { action: 'PLACE', x: 5, y: 5, block_type: 'packed_sand' },
              { action: 'PLACE', x: 5, y: 6, block_type: 'packed_sand' },
            ],
          },
        },
      });
    expect(res.status).toBe(200);
    const text = res.body.result?.content?.[0]?.text;
    const result = JSON.parse(text);
    expect(result.ok).toBe(true);
    expect(result.applied).toBe(2);
    expect(result.turnCommitted).toBe(true);
  });

  it('submit_turn can place a moat block', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('X-Api-Key', 'test-key-p1')
      .send({
        jsonrpc: '2.0', id: 1,
        method: 'tools/call',
        params: {
          name: 'submit_turn',
          arguments: {
            moves: [{ action: 'PLACE', x: 5, y: 5, block_type: 'moat', level: 0 }],
          },
        },
      });
    expect(res.status).toBe(200);
    const text = res.body.result?.content?.[0]?.text;
    const result = JSON.parse(text);
    expect(result.ok).toBe(true);
    expect(result.applied).toBe(1);
    expect(result.turnCommitted).toBe(true);
  });

  it('submit_turn rejects moat block at level > 0', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('X-Api-Key', 'test-key-p1')
      .send({
        jsonrpc: '2.0', id: 1,
        method: 'tools/call',
        params: {
          name: 'submit_turn',
          arguments: {
            moves: [{ action: 'PLACE', x: 5, y: 5, block_type: 'moat', level: 1 }],
          },
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.result?.isError).toBe(true);
    expect(res.body.result?.content?.[0]?.text).toMatch(/moat/i);
  });

  it('get_state returns correct my_actions_remaining based on ACTIONS_PER_TICK', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('X-Api-Key', 'test-key-p1')
      .send({
        jsonrpc: '2.0', id: 1,
        method: 'tools/call',
        params: { name: 'get_state', arguments: {} },
      });
    expect(res.status).toBe(200);
    const text = res.body.result?.content?.[0]?.text;
    const parsed = JSON.parse(text);
    const { my_actions_used, my_actions_remaining } = parsed.current_state;
    // Total should always equal ACTIONS_PER_TICK (20), not 12
    expect(my_actions_used + my_actions_remaining).toBe(ACTIONS_PER_TICK);
  });

  it('submit_turn rejects move in wrong zone', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('X-Api-Key', 'test-key-p1')
      .send({
        jsonrpc: '2.0', id: 1,
        method: 'tools/call',
        params: {
          name: 'submit_turn',
          arguments: {
            moves: [{ action: 'PLACE', x: 15, y: 5, block_type: 'dry_sand' }],
          },
        },
      });
    expect(res.status).toBe(200); // MCP errors are 200 with isError:true
    expect(res.body.result?.isError).toBe(true);
  });

  it('get_my_zone_state returns a 20x10 grid of nulls for empty zone', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('X-Api-Key', 'test-key-p1')
      .send({
        jsonrpc: '2.0', id: 1,
        method: 'tools/call',
        params: { name: 'get_my_zone_state', arguments: {} },
      });
    expect(res.status).toBe(200);
    const text = res.body.result?.content?.[0]?.text;
    expect(text).toBeDefined();
    const parsed = JSON.parse(text);
    expect(parsed).toHaveProperty('player', 'player1');
    expect(parsed).toHaveProperty('zone');
    expect(parsed.zone).toMatchObject({ x_min: 0, x_max: 9 });
    expect(parsed).toHaveProperty('zone_grid');
    const grid = parsed.zone_grid;
    expect(Array.isArray(grid)).toBe(true);
    expect(grid).toHaveLength(20);
    expect(grid[0]).toHaveLength(10);
    for (const row of grid) {
      for (const cell of row) {
        expect(cell).toBeNull();
      }
    }
  });

  it('get_my_zone_state shows top block after placement', async () => {
    // Place a block first
    await request(app)
      .post('/mcp')
      .set('X-Api-Key', 'test-key-p1')
      .send({
        jsonrpc: '2.0', id: 1,
        method: 'tools/call',
        params: {
          name: 'submit_turn',
          arguments: { moves: [{ action: 'PLACE', x: 4, y: 8, block_type: 'packed_sand' }] },
        },
      });

    const res = await request(app)
      .post('/mcp')
      .set('X-Api-Key', 'test-key-p1')
      .send({
        jsonrpc: '2.0', id: 1,
        method: 'tools/call',
        params: { name: 'get_my_zone_state', arguments: {} },
      });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body.result?.content?.[0]?.text);
    // row y=8, col index 4 (x_min=0, so col=x-0=4)
    const cell = parsed.zone_grid[8][4];
    expect(cell).not.toBeNull();
    expect(cell).toHaveProperty('level', 0);
    expect(cell).toHaveProperty('type', 'packed_sand');
    expect(cell).toHaveProperty('health');
    expect(cell).toHaveProperty('flag_protected', false);
  });

  it('get_my_zone_state includes flag_protected: true for flag-covered blocks', async () => {
    const { getState, saveState } = await import('../lib/store.js');
    const s = await getState();
    s.cells.push({ x: 3, y: 5, level: 0, type: 'packed_sand', health: 60, owner: 'player1' });
    s.flags.push({ id: 'flag_t1', x: 3, y: 5, level: 0, owner: 'player1', label: 'Main' });
    await saveState(s);

    const res = await request(app)
      .post('/mcp')
      .set('X-Api-Key', 'test-key-p1')
      .send({
        jsonrpc: '2.0', id: 1,
        method: 'tools/call',
        params: { name: 'get_my_zone_state', arguments: {} },
      });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body.result?.content?.[0]?.text);
    // col index = x - x_min = 3 - 0 = 3, row y=5
    const cell = parsed.zone_grid[5][3];
    expect(cell).not.toBeNull();
    expect(cell).toHaveProperty('flag_protected', true);
    // flags array should include the placed flag
    expect(parsed.flags).toEqual(expect.arrayContaining([
      expect.objectContaining({ x: 3, y: 5, level: 0, owner: 'player1', label: 'Main' }),
    ]));
  });

  it('get_my_zone_state includes flags array and unflagged cells have flag_protected: false', async () => {
    const { getState, saveState } = await import('../lib/store.js');
    const s = await getState();
    // Two adjacent blocks, only one flagged
    s.cells.push({ x: 2, y: 7, level: 0, type: 'packed_sand', health: 60, owner: 'player1' });
    s.cells.push({ x: 6, y: 7, level: 0, type: 'packed_sand', health: 60, owner: 'player1' });
    s.flags.push({ id: 'flag_t2', x: 2, y: 7, level: 0, owner: 'player1', label: 'East' });
    await saveState(s);

    const res = await request(app)
      .post('/mcp')
      .set('X-Api-Key', 'test-key-p1')
      .send({
        jsonrpc: '2.0', id: 1,
        method: 'tools/call',
        params: { name: 'get_my_zone_state', arguments: {} },
      });
    const parsed = JSON.parse(res.body.result?.content?.[0]?.text);
    expect(parsed.zone_grid[7][2]).toHaveProperty('flag_protected', true);
    expect(parsed.zone_grid[7][6]).toHaveProperty('flag_protected', false);
    expect(parsed.flags).toHaveLength(1);
    expect(parsed.flags[0]).toMatchObject({ x: 2, y: 7 });
  });

  it('get_my_zone_state shows moat blocks (health=0) as non-null — regression for moat omission bug', async () => {
    const { getState, saveState } = await import('../lib/store.js');
    const s = await getState();
    // Place moat blocks at y=17, x=2-4 (player1 zone)
    for (let x = 2; x <= 4; x++) {
      s.cells.push({ x, y: 17, level: 0, type: 'moat', health: 0, owner: 'player1', moatDepth: 1 });
    }
    await saveState(s);

    const res = await request(app)
      .post('/mcp')
      .set('X-Api-Key', 'test-key-p1')
      .send({
        jsonrpc: '2.0', id: 1,
        method: 'tools/call',
        params: { name: 'get_my_zone_state', arguments: {} },
      });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body.result?.content?.[0]?.text);
    expect(parsed.zone).toMatchObject({ x_min: 0 }); // player1 zone starts at x=0

    for (let x = 2; x <= 4; x++) {
      const cell = parsed.zone_grid[17][x - parsed.zone.x_min];
      expect(cell).not.toBeNull();
      expect(cell).toHaveProperty('type', 'moat');
      expect(cell).toHaveProperty('health', 0);
    }
  });

  it('get_my_zone_state uses direct y→row mapping for y>=12 — regression for row-offset bug', async () => {
    const { getState, saveState } = await import('../lib/store.js');
    const s = await getState();
    // Place distinct block types at y=12 and y=13 to detect any off-by-one
    s.cells.push({ x: 3, y: 12, level: 0, type: 'packed_sand', health: 60, owner: 'player1' });
    s.cells.push({ x: 3, y: 13, level: 0, type: 'dry_sand',    health: 25, owner: 'player1' });
    s.cells.push({ x: 3, y: 16, level: 0, type: 'wet_sand',    health: 40, owner: 'player1' });
    s.cells.push({ x: 3, y: 19, level: 0, type: 'packed_sand', health: 60, owner: 'player1' });
    await saveState(s);

    const res = await request(app)
      .post('/mcp')
      .set('X-Api-Key', 'test-key-p1')
      .send({
        jsonrpc: '2.0', id: 1,
        method: 'tools/call',
        params: { name: 'get_my_zone_state', arguments: {} },
      });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body.result?.content?.[0]?.text);

    // grid[y][x] must reflect game position (x, y) with no offset
    expect(parsed.zone_grid[12][3]).toMatchObject({ type: 'packed_sand' });
    expect(parsed.zone_grid[13][3]).toMatchObject({ type: 'dry_sand' });
    expect(parsed.zone_grid[16][3]).toMatchObject({ type: 'wet_sand' });
    expect(parsed.zone_grid[19][3]).toMatchObject({ type: 'packed_sand' });
    // Adjacent rows must be null (no accidental +1 or -1 shift)
    expect(parsed.zone_grid[11][3]).toBeNull();
    expect(parsed.zone_grid[14][3]).toBeNull();
    expect(parsed.zone_grid[15][3]).toBeNull();
    expect(parsed.zone_grid[17][3]).toBeNull();
    expect(parsed.zone_grid[18][3]).toBeNull();
  });

  it('get_flags returns player flag coverage', async () => {
    const { getState, saveState } = await import('../lib/store.js');
    const s = await getState();
    s.cells.push({ x: 4, y: 6, level: 0, type: 'packed_sand', health: 60, owner: 'player1' });
    s.cells.push({ x: 5, y: 6, level: 0, type: 'packed_sand', health: 60, owner: 'player1' });
    s.flags.push({ id: 'flag_t3', x: 4, y: 6, level: 0, owner: 'player1', label: 'Tower' });
    await saveState(s);

    const res = await request(app)
      .post('/mcp')
      .set('X-Api-Key', 'test-key-p1')
      .send({
        jsonrpc: '2.0', id: 1,
        method: 'tools/call',
        params: { name: 'get_flags', arguments: {} },
      });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body.result?.content?.[0]?.text);
    expect(parsed).toHaveProperty('player', 'player1');
    expect(parsed).toHaveProperty('flag_coverage');
    expect(parsed.flag_coverage).toHaveLength(1);
    const entry = parsed.flag_coverage[0];
    expect(entry.flag).toMatchObject({ x: 4, y: 6, label: 'Tower' });
    // Both adjacent blocks should be in protected_blocks (same connected component)
    expect(entry.protected_blocks.length).toBeGreaterThanOrEqual(2);
  });

  it('get_flags returns empty coverage when player has no flags', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('X-Api-Key', 'test-key-p1')
      .send({
        jsonrpc: '2.0', id: 1,
        method: 'tools/call',
        params: { name: 'get_flags', arguments: {} },
      });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body.result?.content?.[0]?.text);
    expect(parsed.flag_coverage).toEqual([]);
  });

  it('get_flags only returns calling player flags, not opponent flags', async () => {
    const { getState, saveState } = await import('../lib/store.js');
    const s = await getState();
    s.cells.push({ x: 4, y: 6, level: 0, type: 'packed_sand', health: 60, owner: 'player1' });
    s.cells.push({ x: 12, y: 6, level: 0, type: 'packed_sand', health: 60, owner: 'player2' });
    s.flags.push({ id: 'flag_p1', x: 4, y: 6, level: 0, owner: 'player1', label: 'P1 Tower' });
    s.flags.push({ id: 'flag_p2', x: 12, y: 6, level: 0, owner: 'player2', label: 'P2 Tower' });
    await saveState(s);

    const res = await request(app)
      .post('/mcp')
      .set('X-Api-Key', 'test-key-p1')
      .send({
        jsonrpc: '2.0', id: 1,
        method: 'tools/call',
        params: { name: 'get_flags', arguments: {} },
      });
    const parsed = JSON.parse(res.body.result?.content?.[0]?.text);
    expect(parsed.flag_coverage).toHaveLength(1);
    expect(parsed.flag_coverage[0].flag.owner).toBe('player1');
  });

  it('get_my_zone_state is scoped to the calling player zone', async () => {
    // player2 places a block in their zone
    await request(app)
      .post('/mcp')
      .set('X-Api-Key', 'test-key-p2')
      .send({
        jsonrpc: '2.0', id: 1,
        method: 'tools/call',
        params: {
          name: 'submit_turn',
          arguments: { moves: [{ action: 'PLACE', x: 12, y: 5, block_type: 'packed_sand' }] },
        },
      });

    // player2 calls get_my_zone_state — should only see their own zone
    const res = await request(app)
      .post('/mcp')
      .set('X-Api-Key', 'test-key-p2')
      .send({
        jsonrpc: '2.0', id: 1,
        method: 'tools/call',
        params: { name: 'get_my_zone_state', arguments: {} },
      });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body.result?.content?.[0]?.text);
    expect(parsed.player).toBe('player2');
    expect(parsed.zone).toMatchObject({ x_min: 10, x_max: 19 });
    expect(parsed.zone_grid).toHaveLength(20);
    expect(parsed.zone_grid[0]).toHaveLength(10);
    // col index = x - x_min = 12 - 10 = 2, row = 5
    const cell = parsed.zone_grid[5][2];
    expect(cell).not.toBeNull();
    expect(cell).toHaveProperty('type', 'packed_sand');
  });
});
