import express from 'express';
import stateRouter from './routes/state.js';
import moveRouter from './routes/move.js';
import tickRouter from './routes/tick.js';
import rulesRouter from './routes/rules.js';

const app = express();
app.use(express.json());

// CORS — allow GitHub Pages and local dev
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  if (
    origin.endsWith('.github.io') ||
    origin.endsWith('.drop37.com') ||
    origin === 'http://localhost:3000' ||
    origin === 'http://127.0.0.1:3000'
  ) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Api-Key');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use('/rules', rulesRouter);
app.use('/state', stateRouter);
app.use('/move', moveRouter);
app.use('/tick', tickRouter);

app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SandCastle Wars API listening on :${PORT}`));

export default app;
