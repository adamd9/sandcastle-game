import { Router } from 'express';
import { getState } from '../lib/db.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const state = await getState();
    const response = { ...state };
    if (response.history) {
      response.history = response.history.slice(-10);
    }
    res.set('Cache-Control', 'no-store');
    res.json(response);
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
    const filteredHistory = (state.history || []).slice(-10).map(round => ({
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

    // Latest judgment (if any)
    const lastJudgment = (state.judgments || []).length > 0
      ? state.judgments[state.judgments.length - 1]
      : null;

    res.set('Cache-Control', 'no-store');
    res.json({
      tick: state.tick,
      weather: state.weather,
      myPlayer: player,
      myState: state.players[player],
      opponentState: state.players[player === 'player1' ? 'player2' : 'player1'],
      cells: state.cells,
      scores: state.scores ?? { player1: 0, player2: 0 },
      lastJudgment,
      recentHistory: filteredHistory,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
