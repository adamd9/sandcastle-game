// Weather forecast generator.
// Produces a probabilistic outlook for the next N ticks based on the
// predefined weather-event pool and its weights.

import { getAllWeatherEvents, selectRandomWeatherEvent } from './weather.js';

const STORM_EVENT_TYPES = new Set(['storm', 'wave_surge', 'rogue_wave']);

/**
 * Generate a weather forecast for the next `ticks` game turns.
 *
 * Each entry contains:
 *   tick_offset         – how many ticks ahead (1, 2, 3 …)
 *   likely_event        – a sampled probable weather scenario (random, weighted)
 *   rain_mm_min/max     – possible rain range across the full event pool
 *   wind_speed_kph_min/max – possible wind range across the full event pool
 *   most_likely_wind_direction – direction with highest combined weight
 *   storm_probability   – integer % chance of a storm / wave event this tick
 *
 * The `likely_event` introduces randomness: it is an independent weighted draw
 * for each future tick, so the forecast may differ on every state refresh —
 * mirroring real-world forecast uncertainty.
 *
 * @param {number} [ticks=3] – number of future ticks to forecast
 * @returns {Array}
 */
export function generateForecast(ticks = 3) {
  const events = getAllWeatherEvents();
  if (!events || events.length === 0) {
    return [];
  }
  const totalWeight = events.reduce((s, e) => s + e.weight, 0);

  // Aggregate stats from the full pool (constant for a given event set)
  const rain_mm_min = Math.min(...events.map(e => e.rain_mm));
  const rain_mm_max = Math.max(...events.map(e => e.rain_mm));
  const wind_speed_kph_min = Math.min(...events.map(e => e.wind_speed_kph));
  const wind_speed_kph_max = Math.max(...events.map(e => e.wind_speed_kph));

  const stormWeight = events
    .filter(e => STORM_EVENT_TYPES.has(e.event_type))
    .reduce((s, e) => s + e.weight, 0);
  const storm_probability = Math.round((stormWeight / totalWeight) * 100);

  // Direction with the highest combined weight across all events
  const directionWeights = {};
  for (const ev of events) {
    directionWeights[ev.wind_direction] = (directionWeights[ev.wind_direction] || 0) + ev.weight;
  }
  const most_likely_wind_direction = Object.entries(directionWeights)
    .sort((a, b) => b[1] - a[1])[0][0];

  // Build per-tick forecast entries
  const forecast = [];
  for (let i = 1; i <= ticks; i++) {
    const sampled = selectRandomWeatherEvent();
    forecast.push({
      tick_offset: i,
      likely_event: {
        event_id:       sampled.id,
        event_name:     sampled.name,
        event_emoji:    sampled.emoji,
        event_type:     sampled.event_type,
        rain_mm:        sampled.rain_mm,
        wind_speed_kph: sampled.wind_speed_kph,
        wind_direction: sampled.wind_direction,
      },
      rain_mm_min,
      rain_mm_max,
      wind_speed_kph_min,
      wind_speed_kph_max,
      most_likely_wind_direction,
      storm_probability,
    });
  }

  return forecast;
}
