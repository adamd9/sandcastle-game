import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import app from '../server.js';
import { firePostTickHooks, triggerHookByName } from '../lib/hooks.js';

process.env.PLAYER1_API_KEY = 'test-key-p1';
process.env.PLAYER2_API_KEY = 'test-key-p2';
process.env.TICK_ADMIN_KEY  = 'test-key-tick';
process.env.COPILOT_TOKEN   = 'test-copilot-token';

function makeFetch(status = 204) {
  return vi.fn().mockResolvedValue({ status, text: async () => '' });
}

beforeEach(() => {
  globalThis.fetch = makeFetch(204);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// firePostTickHooks
// ---------------------------------------------------------------------------
describe('firePostTickHooks', () => {
  it('dispatches both player-one and player-two', async () => {
    await firePostTickHooks({ tick: 1 });

    const urls = globalThis.fetch.mock.calls.map(c => c[0]);
    expect(urls.some(u => u.includes('sandcastle-player-one'))).toBe(true);
    expect(urls.some(u => u.includes('sandcastle-player-two'))).toBe(true);
  });

  it('does NOT dispatch review when tick % 24 !== 0', async () => {
    await firePostTickHooks({ tick: 1 });

    const urls = globalThis.fetch.mock.calls.map(c => c[0]);
    expect(urls.some(u => u.includes('review-improvements'))).toBe(false);
  });

  it('dispatches review when tick % REVIEW_EVERY_N_TICKS === 0', async () => {
    process.env.REVIEW_EVERY_N_TICKS = '4';
    try {
      await firePostTickHooks({ tick: 4 });
      const urls = globalThis.fetch.mock.calls.map(c => c[0]);
      expect(urls.some(u => u.includes('review-improvements'))).toBe(true);
    } finally {
      delete process.env.REVIEW_EVERY_N_TICKS;
    }
  });

  it('resolves without throwing even when fetch fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));
    await expect(firePostTickHooks({ tick: 1 })).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// triggerHookByName
// ---------------------------------------------------------------------------
describe('triggerHookByName', () => {
  it("'notify-players' calls both player dispatches", async () => {
    await triggerHookByName('notify-players', { tick: 1 });

    const urls = globalThis.fetch.mock.calls.map(c => c[0]);
    expect(urls.some(u => u.includes('sandcastle-player-one'))).toBe(true);
    expect(urls.some(u => u.includes('sandcastle-player-two'))).toBe(true);
  });

  it("'review-improvements' force-fires regardless of tick", async () => {
    // tick: 1 would normally skip review via maybeDispatchReview,
    // but triggerHookByName('review-improvements') uses forceDispatchReview.
    await triggerHookByName('review-improvements', { tick: 1 });

    const urls = globalThis.fetch.mock.calls.map(c => c[0]);
    expect(urls.some(u => u.includes('review-improvements'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /god/trigger-hook
// ---------------------------------------------------------------------------
describe('POST /god/trigger-hook', () => {
  it('returns 401 without X-Api-Key', async () => {
    const res = await request(app)
      .post('/god/trigger-hook')
      .send({ hook: 'notify-players' });
    expect(res.status).toBe(401);
  });

  it('returns 200 { ok: true } when valid hook is dispatched', async () => {
    const res = await request(app)
      .post('/god/trigger-hook')
      .set('X-Api-Key', 'test-key-tick')
      .send({ hook: 'notify-players' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
