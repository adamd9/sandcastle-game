import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../server.js';
import { resetState } from '../lib/store.js';

// Set env vars before the app is imported so auth middleware has something to check.
process.env.PLAYER1_API_KEY = 'test-key-p1';
process.env.PLAYER2_API_KEY = 'test-key-p2';
process.env.TICK_ADMIN_KEY  = 'test-key-tick';

beforeEach(() => {
  resetState();
});

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------
describe('GET /health', () => {
  it('returns 200 ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /rules
// ---------------------------------------------------------------------------
describe('GET /rules', () => {
  it('returns the rules document', async () => {
    const res = await request(app).get('/rules');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('grid');
    expect(res.body).toHaveProperty('zones');
    expect(res.body).toHaveProperty('actions_per_tick', 12);
    expect(res.body).toHaveProperty('block_types');
  });
});

// ---------------------------------------------------------------------------
// GET /state
// ---------------------------------------------------------------------------
describe('GET /state', () => {
  it('returns initial state', async () => {
    const res = await request(app).get('/state');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tick', 0);
    expect(res.body).toHaveProperty('cells');
    expect(Array.isArray(res.body.cells)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /move
// ---------------------------------------------------------------------------
describe('POST /move', () => {
  it('rejects request with no API key', async () => {
    const res = await request(app).post('/move').send({ action: 'PLACE', x: 5, y: 5, type: 'dry_sand' });
    expect(res.status).toBe(401);
  });

  it('rejects request with wrong API key', async () => {
    const res = await request(app)
      .post('/move')
      .set('X-Api-Key', 'wrong-key')
      .send({ action: 'PLACE', x: 5, y: 5, type: 'dry_sand' });
    expect(res.status).toBe(403);
  });

  it('places a block for player1', async () => {
    const res = await request(app)
      .post('/move')
      .set('X-Api-Key', 'test-key-p1')
      .send({ action: 'PLACE', x: 5, y: 5, type: 'dry_sand' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.actionsThisTick).toBe(1);
  });

  it('places a block for player2 in their zone', async () => {
    const res = await request(app)
      .post('/move')
      .set('X-Api-Key', 'test-key-p2')
      .send({ action: 'PLACE', x: 15, y: 5, type: 'wet_sand' });
    expect(res.status).toBe(200);
    expect(res.body.actionsThisTick).toBe(1);
  });

  it('rejects move outside own zone', async () => {
    const res = await request(app)
      .post('/move')
      .set('X-Api-Key', 'test-key-p1')
      .send({ action: 'PLACE', x: 15, y: 5, type: 'dry_sand' });
    expect(res.status).toBe(422);
  });

  it('rejects missing body fields', async () => {
    const res = await request(app)
      .post('/move')
      .set('X-Api-Key', 'test-key-p1')
      .send({ action: 'PLACE' }); // missing x, y
    expect(res.status).toBe(400);
  });

  it('cell is present in state after PLACE', async () => {
    await request(app)
      .post('/move')
      .set('X-Api-Key', 'test-key-p1')
      .send({ action: 'PLACE', x: 3, y: 3, type: 'packed_sand' });

    const state = await request(app).get('/state');
    const cell = state.body.cells.find(c => c.x === 3 && c.y === 3);
    expect(cell).toBeDefined();
    expect(cell.health).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// POST /tick
// ---------------------------------------------------------------------------
describe('POST /tick', () => {
  it('rejects without admin key', async () => {
    const res = await request(app).post('/tick').set('X-Api-Key', 'test-key-p1');
    expect(res.status).toBe(403);
  });

  it('advances tick counter', async () => {
    const res = await request(app).post('/tick').set('X-Api-Key', 'test-key-tick');
    expect(res.status).toBe(200);
    expect(res.body.tick).toBe(1);
  });

  it('resets actionsThisTick after tick', async () => {
    // Give player1 some actions
    await request(app)
      .post('/move')
      .set('X-Api-Key', 'test-key-p1')
      .send({ action: 'PLACE', x: 5, y: 5, type: 'dry_sand' });

    await request(app).post('/tick').set('X-Api-Key', 'test-key-tick');

    const state = await request(app).get('/state');
    expect(state.body.players.player1.actionsThisTick).toBe(0);
  });
});
