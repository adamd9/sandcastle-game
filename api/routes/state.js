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
      weather: round.weather,
      myMoves: (round.moves?.[player] || []),
      myStats: round[player] || {},
      myWeatherEvents: (round.weatherEvents || []).filter(e => e.owner === player),
      opponentStats: round[player === 'player1' ? 'player2' : 'player1'] || {},
    }));

    res.json({
      tick: state.tick,
      weather: state.weather,
      myPlayer: player,
      myState: state.players[player],
      opponentState: state.players[player === 'player1' ? 'player2' : 'player1'],
      cells: state.cells,
      recentHistory: filteredHistory,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
