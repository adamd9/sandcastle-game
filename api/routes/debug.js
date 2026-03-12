import { Router } from 'express';

const router = Router();

const WEATHER_SOURCES = {
  openmeteo: 'https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.12&current_weather=true',
  'open-meteo-forecast': 'https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.12&hourly=temperature_2m,precipitation,windspeed_10m&forecast_days=1',
  wttr: 'https://wttr.in/London?format=j1',
  '7timer': 'http://www.7timer.info/bin/api.pl?lon=-0.12&lat=51.5&product=civil&output=json',
};

/**
 * GET /debug/weather?source=<name>
 * Probes a weather API from the server and returns diagnostics.
 * Header: X-Api-Key (TICK_ADMIN_KEY)
 */
router.get('/weather', async (req, res) => {
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.TICK_ADMIN_KEY) {
    return res.status(401).json({ error: 'Invalid or missing X-Api-Key header.' });
  }

  const { source } = req.query;
  const validSources = Object.keys(WEATHER_SOURCES);
  if (!source || !validSources.includes(source)) {
    return res.status(400).json({
      error: `source must be one of: ${validSources.join(', ')}`,
    });
  }

  const url = WEATHER_SOURCES[source];
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const fetchRes = await fetch(url, { signal: controller.signal });
    const duration_ms = Date.now() - start;
    let data = null;
    let error = null;

    try {
      data = await fetchRes.json();
    } catch (parseErr) {
      error = `JSON parse failed: ${parseErr.message}`;
    }

    return res.json({ source, url, status: fetchRes.status, data, error, duration_ms });
  } catch (err) {
    const duration_ms = Date.now() - start;
    const isTimeout = err.name === 'AbortError';
    return res.json({
      source,
      url,
      status: null,
      data: null,
      error: isTimeout ? `Timed out after 10s` : err.message,
      duration_ms,
    });
  } finally {
    clearTimeout(timeout);
  }
});

export default router;
