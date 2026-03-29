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
});
