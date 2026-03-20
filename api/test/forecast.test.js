import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../server.js';
import { generateForecast } from '../lib/forecast.js';
import { resetState } from '../lib/store.js';

process.env.PLAYER1_API_KEY = 'test-key-p1';
process.env.PLAYER2_API_KEY = 'test-key-p2';
process.env.TICK_ADMIN_KEY  = 'test-key-tick';

beforeEach(() => {
  resetState();
});

// ---------------------------------------------------------------------------
// generateForecast() unit tests
// ---------------------------------------------------------------------------
describe('generateForecast()', () => {
  it('returns 3 entries by default', () => {
    const forecast = generateForecast();
    expect(Array.isArray(forecast)).toBe(true);
    expect(forecast).toHaveLength(3);
  });

  it('returns the requested number of entries', () => {
    expect(generateForecast(1)).toHaveLength(1);
    expect(generateForecast(5)).toHaveLength(5);
  });

  it('each entry has the correct shape', () => {
    const forecast = generateForecast(3);
    forecast.forEach((entry, idx) => {
      expect(entry.tick_offset).toBe(idx + 1);

      // Likely event fields
      expect(entry.likely_event).toHaveProperty('event_id');
      expect(entry.likely_event).toHaveProperty('event_name');
      expect(entry.likely_event).toHaveProperty('event_emoji');
      expect(entry.likely_event).toHaveProperty('event_type');
      expect(entry.likely_event).toHaveProperty('rain_mm');
      expect(entry.likely_event).toHaveProperty('wind_speed_kph');
      expect(entry.likely_event).toHaveProperty('wind_direction');

      // Range / probability fields
      expect(entry).toHaveProperty('rain_mm_min');
      expect(entry).toHaveProperty('rain_mm_max');
      expect(entry).toHaveProperty('wind_speed_kph_min');
      expect(entry).toHaveProperty('wind_speed_kph_max');
      expect(entry).toHaveProperty('most_likely_wind_direction');
      expect(entry).toHaveProperty('storm_probability');
    });
  });

  it('rain_mm_min <= rain_mm_max', () => {
    const forecast = generateForecast();
    for (const entry of forecast) {
      expect(entry.rain_mm_min).toBeLessThanOrEqual(entry.rain_mm_max);
    }
  });

  it('wind_speed_kph_min <= wind_speed_kph_max', () => {
    const forecast = generateForecast();
    for (const entry of forecast) {
      expect(entry.wind_speed_kph_min).toBeLessThanOrEqual(entry.wind_speed_kph_max);
    }
  });

  it('storm_probability is an integer between 0 and 100', () => {
    const forecast = generateForecast();
    for (const entry of forecast) {
      expect(entry.storm_probability).toBeGreaterThanOrEqual(0);
      expect(entry.storm_probability).toBeLessThanOrEqual(100);
      expect(Number.isInteger(entry.storm_probability)).toBe(true);
    }
  });

  it('likely_event.rain_mm is within the reported range', () => {
    const forecast = generateForecast();
    for (const entry of forecast) {
      expect(entry.likely_event.rain_mm).toBeGreaterThanOrEqual(entry.rain_mm_min);
      expect(entry.likely_event.rain_mm).toBeLessThanOrEqual(entry.rain_mm_max);
    }
  });

  it('likely_event.wind_speed_kph is within the reported range', () => {
    const forecast = generateForecast();
    for (const entry of forecast) {
      expect(entry.likely_event.wind_speed_kph).toBeGreaterThanOrEqual(entry.wind_speed_kph_min);
      expect(entry.likely_event.wind_speed_kph).toBeLessThanOrEqual(entry.wind_speed_kph_max);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /state includes forecast
// ---------------------------------------------------------------------------
describe('GET /state forecast', () => {
  it('returns a forecast array with 3 entries', async () => {
    const res = await request(app).get('/state');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('forecast');
    expect(Array.isArray(res.body.forecast)).toBe(true);
    expect(res.body.forecast).toHaveLength(3);
  });

  it('forecast entries have correct fields', async () => {
    const res = await request(app).get('/state');
    const { forecast } = res.body;
    forecast.forEach((entry, idx) => {
      expect(entry.tick_offset).toBe(idx + 1);
      expect(entry).toHaveProperty('likely_event');
      expect(entry).toHaveProperty('rain_mm_min');
      expect(entry).toHaveProperty('rain_mm_max');
      expect(entry).toHaveProperty('wind_speed_kph_min');
      expect(entry).toHaveProperty('wind_speed_kph_max');
      expect(entry).toHaveProperty('most_likely_wind_direction');
      expect(entry).toHaveProperty('storm_probability');
    });
  });
});

// ---------------------------------------------------------------------------
// GET /state/:player includes forecast
// ---------------------------------------------------------------------------
describe('GET /state/:player forecast', () => {
  it('returns a forecast array with 3 entries for player1', async () => {
    const res = await request(app).get('/state/player1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('forecast');
    expect(Array.isArray(res.body.forecast)).toBe(true);
    expect(res.body.forecast).toHaveLength(3);
  });

  it('forecast entries have correct fields for player2', async () => {
    const res = await request(app).get('/state/player2');
    const { forecast } = res.body;
    forecast.forEach((entry, idx) => {
      expect(entry.tick_offset).toBe(idx + 1);
      expect(entry).toHaveProperty('likely_event');
      expect(entry).toHaveProperty('storm_probability');
    });
  });
});
