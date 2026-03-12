// Fetches current weather from wttr.in for Sydney, Australia.
// No API key required.

const WTTR_URL = 'https://wttr.in/Sydney?format=j1';

export async function fetchWeather() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout
  try {
    const res = await fetch(WTTR_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`wttr.in returned ${res.status}`);
    const data = await res.json();
    const cc = data.current_condition[0];
    return {
      rain_mm:        parseFloat(cc.precipMM),
      wind_speed_kph: parseFloat(cc.windspeedKmph),
      wind_direction: cc.winddir16Point,
      weatherSource:  'wttr.in/Sydney',
    };
  } catch (err) {
    // Re-throw with cause detail for better diagnostics
    const cause = err.cause?.message ?? err.cause ?? err.message;
    throw new Error(`Weather fetch failed: ${cause}`);
  } finally {
    clearTimeout(timeout);
  }
}
