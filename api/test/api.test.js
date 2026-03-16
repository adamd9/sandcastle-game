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
    expect(res.body).toHaveProperty('actions_per_tick', 20);
    expect(res.body).toHaveProperty('block_types');
  });
});

// ---------------------------------------------------------------------------
// GET /state
// ---------------------------------------------------------------------------
describe('GET /state', () => {
  it('returns initial state without history', async () => {
    const res = await request(app).get('/state');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tick', 0);
    expect(res.body).toHaveProperty('cells');
    expect(Array.isArray(res.body.cells)).toBe(true);
    expect(res.body).not.toHaveProperty('history');
  });
});

// ---------------------------------------------------------------------------
// GET /state/history
// ---------------------------------------------------------------------------
describe('GET /state/history', () => {
  it('returns history array', async () => {
    const res = await request(app).get('/state/history');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('history');
    expect(Array.isArray(res.body.history)).toBe(true);
  });

  it('returns history entries after a tick', async () => {
    await request(app).post('/tick').set('X-Api-Key', 'test-key-tick');

    const res = await request(app).get('/state/history');
    expect(res.status).toBe(200);
    expect(res.body.history.length).toBeGreaterThan(0);
    const lastEntry = res.body.history[res.body.history.length - 1];
    expect(lastEntry).toHaveProperty('tick');
    expect(lastEntry).toHaveProperty('timestamp');
  });
});

// ---------------------------------------------------------------------------
// GET /state/:player
// ---------------------------------------------------------------------------
describe('GET /state/:player', () => {
  it('returns player state without recentHistory', async () => {
    const res = await request(app).get('/state/player1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tick', 0);
    expect(res.body).toHaveProperty('myPlayer', 'player1');
    expect(res.body).toHaveProperty('cells');
    expect(res.body).not.toHaveProperty('recentHistory');
  });

  it('returns 400 for invalid player name', async () => {
    const res = await request(app).get('/state/unknownplayer');
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /state/:player/history
// ---------------------------------------------------------------------------
describe('GET /state/:player/history', () => {
  it('returns empty history before any ticks', async () => {
    const res = await request(app).get('/state/player1/history');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('history');
    expect(Array.isArray(res.body.history)).toBe(true);
  });

  it('returns player-filtered history after a tick', async () => {
    await request(app).post('/tick').set('X-Api-Key', 'test-key-tick');

    const res = await request(app).get('/state/player1/history');
    expect(res.status).toBe(200);
    expect(res.body.history.length).toBeGreaterThan(0);
    const lastEntry = res.body.history[res.body.history.length - 1];
    expect(lastEntry).toHaveProperty('myMoves');
    expect(lastEntry).toHaveProperty('myStats');
    expect(lastEntry).toHaveProperty('myWeatherEvents');
    expect(lastEntry).toHaveProperty('opponentStats');
  });

  it('returns 400 for invalid player name', async () => {
    const res = await request(app).get('/state/unknownplayer/history');
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /state/:player/my_blocks
// ---------------------------------------------------------------------------
describe('GET /state/:player/my_blocks', () => {
  it('returns empty blocks array when player has no blocks', async () => {
    const res = await request(app).get('/state/player1/my_blocks');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('player', 'player1');
    expect(res.body).toHaveProperty('blocks');
    expect(Array.isArray(res.body.blocks)).toBe(true);
    expect(res.body.blocks).toHaveLength(0);
  });

  it('returns only the requesting player\'s blocks with minimal fields', async () => {
    // Place a block for player1
    await request(app)
      .post('/move')
      .set('X-Api-Key', 'test-key-p1')
      .send({ action: 'PLACE', x: 3, y: 3, type: 'packed_sand' });

    // Place a block for player2
    await request(app)
      .post('/move')
      .set('X-Api-Key', 'test-key-p2')
      .send({ action: 'PLACE', x: 15, y: 5, type: 'wet_sand' });

    const res = await request(app).get('/state/player1/my_blocks');
    expect(res.status).toBe(200);
    expect(res.body.player).toBe('player1');
    expect(res.body.blocks.length).toBeGreaterThan(0);

    const block = res.body.blocks[0];
    expect(block).toHaveProperty('x');
    expect(block).toHaveProperty('y');
    expect(block).toHaveProperty('level');
    expect(block).toHaveProperty('type');
    expect(block).toHaveProperty('health');
    expect(block).not.toHaveProperty('owner');

    // Should not include player2's block
    const p2Block = res.body.blocks.find(b => b.x === 15 && b.y === 5);
    expect(p2Block).toBeUndefined();
  });

  it('returns 400 for invalid player name', async () => {
    const res = await request(app).get('/state/unknownplayer/my_blocks');
    expect(res.status).toBe(400);
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
// POST /suggest
// ---------------------------------------------------------------------------
describe('POST /suggest', () => {
  it('rejects request with no API key', async () => {
    const res = await request(app).post('/suggest').send({ title: 'Test', description: 'A test suggestion' });
    expect(res.status).toBe(401);
  });

  it('rejects request with wrong API key', async () => {
    const res = await request(app)
      .post('/suggest')
      .set('X-Api-Key', 'wrong-key')
      .send({ title: 'Test', description: 'A test suggestion' });
    expect(res.status).toBe(401);
  });

  it('rejects missing title', async () => {
    const res = await request(app)
      .post('/suggest')
      .set('X-Api-Key', 'test-key-tick')
      .send({ description: 'A test suggestion' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/i);
  });

  it('rejects missing description', async () => {
    const res = await request(app)
      .post('/suggest')
      .set('X-Api-Key', 'test-key-tick')
      .send({ title: 'Test' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/description/i);
  });

  it('accepts player1 key', async () => {
    // Mock fetch for GitHub API to avoid real network calls
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ number: 42, html_url: 'https://github.com/test/repo/issues/42' }),
    });
    try {
      const res = await request(app)
        .post('/suggest')
        .set('X-Api-Key', 'test-key-p1')
        .send({ title: 'My suggestion', description: 'Here is a detailed description' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.player).toBe('player1');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('uses TICK_ADMIN_KEY as fallback when SUGGESTIONS_GITHUB_TOKEN is absent', async () => {
    const originalFetch = globalThis.fetch;
    let capturedAuth;
    globalThis.fetch = async (url, opts) => {
      capturedAuth = opts.headers['Authorization'];
      return {
        ok: true,
        json: async () => ({ number: 99, html_url: 'https://github.com/test/repo/issues/99' }),
      };
    };
    const originalToken = process.env.SUGGESTIONS_GITHUB_TOKEN;
    delete process.env.SUGGESTIONS_GITHUB_TOKEN;
    try {
      const res = await request(app)
        .post('/suggest')
        .set('X-Api-Key', 'test-key-tick')
        .send({ title: 'Admin suggestion', description: 'Testing fallback token usage' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(capturedAuth).toBe('Bearer test-key-tick');
    } finally {
      globalThis.fetch = originalFetch;
      if (originalToken !== undefined) process.env.SUGGESTIONS_GITHUB_TOKEN = originalToken;
    }
  });

  it('returns 401 when no token is configured (auth fails before GitHub call)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
    const originalToken = process.env.SUGGESTIONS_GITHUB_TOKEN;
    const originalAdminKey = process.env.TICK_ADMIN_KEY;
    delete process.env.SUGGESTIONS_GITHUB_TOKEN;
    delete process.env.TICK_ADMIN_KEY;
    try {
      const res = await request(app)
        .post('/suggest')
        .set('X-Api-Key', 'test-key-tick')
        .send({ title: 'No token test', description: 'Should fail with 500' });
      expect(res.status).toBe(401);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalToken !== undefined) process.env.SUGGESTIONS_GITHUB_TOKEN = originalToken;
      process.env.TICK_ADMIN_KEY = originalAdminKey || 'test-key-tick';
    }
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

  it('records cells_after_weather in history entry for timeline weather points', async () => {
    await request(app).post('/tick').set('X-Api-Key', 'test-key-tick');

    const histRes = await request(app).get('/state/history');
    expect(Array.isArray(histRes.body.history)).toBe(true);
    expect(histRes.body.history.length).toBeGreaterThan(0);
    const lastEntry = histRes.body.history[histRes.body.history.length - 1];
    expect(lastEntry).toHaveProperty('cells_after_weather');
    expect(Array.isArray(lastEntry.cells_after_weather)).toBe(true);
  });

  it('records blocks_after in history entry player summaries', async () => {
    await request(app).post('/tick').set('X-Api-Key', 'test-key-tick');

    const histRes = await request(app).get('/state/history');
    expect(Array.isArray(histRes.body.history)).toBe(true);
    expect(histRes.body.history.length).toBeGreaterThan(0);
    const lastEntry = histRes.body.history[histRes.body.history.length - 1];
    expect(lastEntry.player1).toHaveProperty('blocks_after');
    expect(lastEntry.player2).toHaveProperty('blocks_after');
    expect(typeof lastEntry.player1.blocks_after).toBe('number');
    expect(typeof lastEntry.player2.blocks_after).toBe('number');
  });

  it('records a timestamp in each history entry', async () => {
    const before = new Date();
    await request(app).post('/tick').set('X-Api-Key', 'test-key-tick');
    const after = new Date();

    const histRes = await request(app).get('/state/history');
    expect(Array.isArray(histRes.body.history)).toBe(true);
    expect(histRes.body.history.length).toBeGreaterThan(0);
    const lastEntry = histRes.body.history[histRes.body.history.length - 1];
    expect(lastEntry).toHaveProperty('timestamp');
    const ts = new Date(lastEntry.timestamp);
    expect(ts.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(ts.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

// ---------------------------------------------------------------------------
// POST /god/tick — god_edits
// ---------------------------------------------------------------------------
describe('POST /god/tick god_edits', () => {
  it('PLACE god edit — cell appears in state after tick', async () => {
    const res = await request(app)
      .post('/god/tick')
      .set('X-Api-Key', 'test-key-tick')
      // Use event:'calm' to avoid wave_surge/rogue_wave destroying the test cell.
      // Place at y=10 (well above wave_surge range y=3-5) for extra safety.
      .send({ event: 'calm', god_edits: [{ action: 'PLACE', x: 5, y: 10, level: 0, type: 'packed_sand' }] });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.god_edits_applied).toHaveLength(1);
    expect(res.body.god_edits_applied[0]).toMatchObject({ action: 'PLACE', x: 5, y: 10, level: 0, type: 'packed_sand' });

    const histRes = await request(app).get('/state/history');
    // Cell placed with health 100; calm weather applies 0.5× base damage (≈3 hp) — cell survives
    const lastEntry = histRes.body.history[histRes.body.history.length - 1];
    const placed = lastEntry.cells_after_weather.find(c => c.x === 5 && c.y === 10 && c.level === 0 && c.owner === 'god');
    // With calm event the cell easily survives
    expect(placed).toBeDefined();
  });

  it('REMOVE god edit — cell removed after tick', async () => {
    // First place a block via player move
    await request(app)
      .post('/move')
      .set('X-Api-Key', 'test-key-p1')
      .send({ action: 'PLACE', x: 5, y: 5, type: 'packed_sand' });

    const res = await request(app)
      .post('/god/tick')
      .set('X-Api-Key', 'test-key-tick')
      .send({ rain_mm: 0, wind_speed_kph: 0, god_edits: [{ action: 'REMOVE', x: 5, y: 5, level: 0 }] });
    expect(res.status).toBe(200);
    expect(res.body.god_edits_applied).toHaveLength(1);
    expect(res.body.god_edits_applied[0]).toMatchObject({ action: 'REMOVE', x: 5, y: 5, level: 0 });

    const state = await request(app).get('/state');
    const cell = state.body.cells.find(c => c.x === 5 && c.y === 5 && c.level === 0);
    expect(cell).toBeUndefined();
  });

  it('god_edits with invalid coords (y < WATER_ROWS) — silently skipped, tick succeeds', async () => {
    const res = await request(app)
      .post('/god/tick')
      .set('X-Api-Key', 'test-key-tick')
      .send({ rain_mm: 0, wind_speed_kph: 0, god_edits: [{ action: 'PLACE', x: 5, y: 0, level: 0, type: 'packed_sand' }] });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.god_edits_applied).toHaveLength(0);
  });

  it('empty god_edits array — tick works fine', async () => {
    const res = await request(app)
      .post('/god/tick')
      .set('X-Api-Key', 'test-key-tick')
      .send({ rain_mm: 0, wind_speed_kph: 0, god_edits: [] });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.god_edits_applied).toHaveLength(0);
  });

  it('no god_edits key — tick works fine (backward compat)', async () => {
    const res = await request(app)
      .post('/god/tick')
      .set('X-Api-Key', 'test-key-tick')
      .send({ rain_mm: 0, wind_speed_kph: 0 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.god_edits_applied).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// POST /turn
// ---------------------------------------------------------------------------
describe('POST /turn', () => {
  it('rejects request with no API key', async () => {
    const res = await request(app).post('/turn').send({ moves: [{ action: 'PLACE', x: 5, y: 5, block_type: 'dry_sand' }] });
    expect(res.status).toBe(401);
  });

  it('rejects empty moves array', async () => {
    const res = await request(app)
      .post('/turn')
      .set('X-Api-Key', 'test-key-p1')
      .send({ moves: [] });
    expect(res.status).toBe(400);
  });

  it('applies a single move and auto-commits turn', async () => {
    const res = await request(app)
      .post('/turn')
      .set('X-Api-Key', 'test-key-p1')
      .send({ moves: [{ action: 'PLACE', x: 5, y: 5, block_type: 'dry_sand' }] });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.applied).toBe(1);
    expect(res.body.turnCommitted).toBe(true);
  });

  it('rejects a batch where a move is invalid against the initial state', async () => {
    // Trying to place at level 1 with no foundation — should fail
    const res = await request(app)
      .post('/turn')
      .set('X-Api-Key', 'test-key-p1')
      .send({ moves: [{ action: 'PLACE', x: 5, y: 5, block_type: 'dry_sand', level: 1 }] });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/Move 1 rejected/);
  });

  it('processes moves sequentially — later move can use foundation placed by earlier move in same batch', async () => {
    // Move 1: place level 0 foundation; Move 2: place level 1 on top — both in same batch
    const res = await request(app)
      .post('/turn')
      .set('X-Api-Key', 'test-key-p1')
      .send({
        moves: [
          { action: 'PLACE', x: 5, y: 5, block_type: 'packed_sand', level: 0 },
          { action: 'PLACE', x: 5, y: 5, block_type: 'packed_sand', level: 1 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.applied).toBe(2);

    const state = await request(app).get('/state');
    const l0 = state.body.cells.find(c => c.x === 5 && c.y === 5 && c.level === 0);
    const l1 = state.body.cells.find(c => c.x === 5 && c.y === 5 && c.level === 1);
    expect(l0).toBeDefined();
    expect(l1).toBeDefined();
  });

  it('allows stacking all 4 levels (0–3) in a single batch', async () => {
    const res = await request(app)
      .post('/turn')
      .set('X-Api-Key', 'test-key-p1')
      .send({
        moves: [
          { action: 'PLACE', x: 4, y: 4, block_type: 'packed_sand', level: 0 },
          { action: 'PLACE', x: 4, y: 4, block_type: 'packed_sand', level: 1 },
          { action: 'PLACE', x: 4, y: 4, block_type: 'packed_sand', level: 2 },
          { action: 'PLACE', x: 4, y: 4, block_type: 'packed_sand', level: 3 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(4);

    const state = await request(app).get('/state');
    for (let lvl = 0; lvl <= 3; lvl++) {
      const cell = state.body.cells.find(c => c.x === 4 && c.y === 4 && c.level === lvl);
      expect(cell).toBeDefined();
    }
  });

  it('rejects the second move when it is invalid given the state after the first', async () => {
    // Move 1 places at (5,5) level 0; Move 2 tries to place at (5,5) level 0 again — occupied
    const res = await request(app)
      .post('/turn')
      .set('X-Api-Key', 'test-key-p1')
      .send({
        moves: [
          { action: 'PLACE', x: 5, y: 5, block_type: 'dry_sand', level: 0 },
          { action: 'PLACE', x: 5, y: 5, block_type: 'dry_sand', level: 0 },
        ],
      });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/Move 2 rejected/);
  });
});

/* ── Render endpoint tests ──────────────────────────── */

describe('GET /render', () => {
  it('returns a PNG image for full board', async () => {
    const res = await request(app).get('/render');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
    expect(res.body.length).toBeGreaterThan(100);
  });

  it('returns a PNG for player1 view', async () => {
    const res = await request(app).get('/render/player1');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
  });

  it('returns a PNG for player2 view', async () => {
    const res = await request(app).get('/render/player2');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
  });
});
