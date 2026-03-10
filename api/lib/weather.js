// Fetches current weather from Open-Meteo for a fixed location.
// Using Sydney, Australia as the canonical game location.
// No API key required.

const LATITUDE  = -33.8688;
const LONGITUDE = 151.2093;

const OPEN_METEO_URL =
  `https://api.open-meteo.com/v1/forecast` +
  `?latitude=${LATITUDE}&longitude=${LONGITUDE}` +
  `&current=rain,wind_speed_10m,wind_direction_10m`;

function degreesToCardinal(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

export async function fetchWeather() {
  const res = await fetch(OPEN_METEO_URL);
  if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);
  const data = await res.json();
  const cur = data.current;
  return {
    rain_mm:        cur.rain           ?? 0,
    wind_speed_kph: cur.wind_speed_10m ?? 0,
    wind_direction: degreesToCardinal(cur.wind_direction_10m ?? 0),
  };
}
