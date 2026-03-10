import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../server.js';
import { resetState } from '../lib/store.js';

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
    const state = JSON.parse(text);
    expect(state).toHaveProperty('tick');
    expect(state).toHaveProperty('cells');
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
