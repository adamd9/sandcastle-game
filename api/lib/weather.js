// Predefined weather event selection — replaces live Sydney weather fetch.
// Events are loaded from weather-events.json and cached in memory.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

let _events = null;
function loadEvents() {
  if (!_events) {
    const raw = readFileSync(join(__dirname, 'weather-events.json'), 'utf8');
    _events = JSON.parse(raw);
  }
  return _events;
}

/** Pick a random predefined event using weighted selection. */
export function selectRandomWeatherEvent() {
  const events = loadEvents();
  const total = events.reduce((s, e) => s + e.weight, 0);
  let r = Math.random() * total;
  for (const ev of events) {
    r -= ev.weight;
    if (r <= 0) return { ...ev };
  }
  return { ...events[0] };
}

/** Look up a predefined event by id. Returns the event or null. */
export function getWeatherEventById(id) {
  const ev = loadEvents().find(e => e.id === id);
  return ev ? { ...ev } : null;
}

/** Return all predefined weather events. */
export function getAllWeatherEvents() {
  return loadEvents();
}

/**
 * fetchWeather() — selects a random predefined event and returns weather data.
 * Drop-in replacement for the old live-fetch function.
 */
export async function fetchWeather() {
  const ev = selectRandomWeatherEvent();
  return {
    rain_mm:        ev.rain_mm,
    wind_speed_kph: ev.wind_speed_kph,
    wind_direction: ev.wind_direction,
    event_id:       ev.id,
    event_name:     ev.name,
    event_emoji:    ev.emoji,
    event_type:     ev.event_type,
  };
}
