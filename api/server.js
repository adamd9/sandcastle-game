import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import stateRouter from './routes/state.js';
import moveRouter from './routes/move.js';
import turnRouter from './routes/turn.js';
import tickRouter from './routes/tick.js';
import rulesRouter from './routes/rules.js';
import endTurnRouter from './routes/end-turn.js';
import godRouter from './routes/god.js';
import hooksRouter from './routes/hooks.js';
import suggestRouter from './routes/suggest.js';
import debugRouter from './routes/debug.js';
import renderRouter from './routes/render.js';
import { createMcpRouter } from './routes/mcp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

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

app.use('/mcp', createMcpRouter());
app.use('/rules', rulesRouter);
app.get('/rules.md', (_req, res) => res.redirect('/rules/md')); // friendly alias
app.use('/state', stateRouter);
app.use('/move', moveRouter);
app.use('/turn', turnRouter);
app.use('/tick', tickRouter);
app.use('/end-turn', endTurnRouter);
app.use('/god', godRouter);
app.use('/hooks', hooksRouter);
app.use('/suggest', suggestRouter);
app.use('/debug', debugRouter);
app.use('/render', renderRouter);



app.get('/health', (_req, res) => res.json({ ok: true }));

// Only bind the port when run directly — not when imported by Vitest test files
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`SandCastle Wars API listening on :${PORT}`);
    if (process.env.ENABLE_SCHEDULER !== 'false') {
      import('./lib/scheduler.js').then(({ initScheduler }) => initScheduler(app));
    }
  });
}

export default app;
