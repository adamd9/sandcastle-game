import { Router } from 'express';
import { getState, getHistoryArchive } from '../lib/db.js';
import { generateForecast } from '../lib/forecast.js';
import { computeStructureScore } from '../lib/gameLogic.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const state = await getState();
    const { history: _history, ...response } = state;
    const flags = state.flags || [];
    const courtyard_cells = {
      player1: computeStructureScore(state.cells || [], 'player1', flags).courtyard_cells,
      player2: computeStructureScore(state.cells || [], 'player2', flags).courtyard_cells,
    };
    res.set('Cache-Control', 'no-store');
    res.json({ ...response, forecast: generateForecast(), courtyard_cells });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Must be defined before /:player to avoid being captured as player='history'
router.get('/history', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 0;
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;

    // Try the dedicated history archive first; fall back to inline state history
    // when no archive entries exist (e.g. before the first tick after this change).
    const archive = await getHistoryArchive({ limit, offset });
    if (archive.total > 0) {
      res.set('Cache-Control', 'no-store');
      return res.json({ history: archive.entries, total: archive.total });
    }

    // Fallback: return inline history from the main state document
    const state = await getState();
    const history = limit > 0
      ? (state.history || []).slice(-limit)
      : (state.history || []);
    res.set('Cache-Control', 'no-store');
    res.json({ history, total: (state.history || []).length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:player/my_blocks', async (req, res) => {
  const { player } = req.params;
  if (player !== 'player1' && player !== 'player2') {
    return res.status(400).json({ error: 'player must be player1 or player2' });
  }
  try {
    const state = await getState();
    const blocks = (state.cells || [])
      .filter(c => c.owner === player)
      .map(({ x, y, level, type, health }) => ({ x, y, level, type, health }));
    res.set('Cache-Control', 'no-store');
    res.json({ player, blocks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:player', async (req, res) => {
  const { player } = req.params;
  if (player !== 'player1' && player !== 'player2') {
    return res.status(400).json({ error: 'player must be player1 or player2' });
  }
  try {
    const state = await getState();

    const otherPlayer = player === 'player1' ? 'player2' : 'player1';

    // Latest judgment (if any)
    const lastJudgment = (state.judgments || []).length > 0
      ? state.judgments[state.judgments.length - 1]
      : null;

    const flags = state.flags || [];

    res.set('Cache-Control', 'no-store');
    res.json({
      tick: state.tick,
      weather: state.weather,
      myPlayer: player,
      myState: state.players[player],
      opponentState: state.players[otherPlayer],
      cells: state.cells,
      scores: state.scores ?? { player1: 0, player2: 0 },
      lastJudgment,
      forecast: generateForecast(),
      score_breakdown: {
        [player]: computeStructureScore(state.cells, player, flags),
        [otherPlayer]: computeStructureScore(state.cells, otherPlayer, flags),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:player/history', async (req, res) => {
  const { player } = req.params;
  if (player !== 'player1' && player !== 'player2') {
    return res.status(400).json({ error: 'player must be player1 or player2' });
  }
  try {
    const state = await getState();
    const history = (state.history || []).slice(-10).map(round => ({
      tick: round.tick,
      timestamp: round.timestamp,
      weather: round.weather,
      myMoves: (round.moves?.[player] || []),
      myStats: round[player] || {},
      myWeatherEvents: (round.weatherEvents || []).filter(e => e.owner === player),
      opponentStats: round[player === 'player1' ? 'player2' : 'player1'] || {},
      opponentWeatherEvents: (round.weatherEvents || []).filter(e => e.owner !== player),
      ...(round.judgment && { judgment: round.judgment }),
    }));
    res.set('Cache-Control', 'no-store');
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
