import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Router } from 'express';
import { z } from 'zod';
import { getState, saveState } from '../lib/db.js';
import { validateMove, applyMove, commitTurn } from '../lib/gameLogic.js';
import {
  GRID_WIDTH, GRID_HEIGHT, ZONES, ACTIONS_PER_TICK,
  BLOCK_TYPES, VALID_ACTIONS, REINFORCE_AMOUNT, MAX_HEALTH,
  rainDamage, windDamage,
} from '../lib/rules.js';

function resolvePlayer(key) {
  if (key && key === process.env.PLAYER1_API_KEY) return 'player1';
  if (key && key === process.env.PLAYER2_API_KEY) return 'player2';
  return null;
}

const RULES_DOC = {
  grid: { width: GRID_WIDTH, height: GRID_HEIGHT },
  zones: ZONES,
  actions_per_tick: ACTIONS_PER_TICK,
  block_types: BLOCK_TYPES,
  valid_actions: VALID_ACTIONS,
  reinforce_amount: REINFORCE_AMOUNT,
  max_health: MAX_HEALTH,
  weather_effects: {
    rain: `Each cell loses floor(rain_mm * 2) health per tick`,
    wind: `Cells on the windward edge lose an additional floor(wind_speed_kph / 5) health per tick`,
  },
  turn_commitment: {
    description: 'Use the end_turn tool to commit your turn. Once committed, no further moves are allowed until the next tick. The game records whether each player committed in the round history. Your opponent can see your commitment status via get_state.',
  },
  endpoints: {
    'GET /rules':            'This document.',
    'GET /state':            'Full game state with last 10 rounds of history.',
    'GET /state/:player':    'Player-filtered state: only that player\'s moves, their weather damage, and opponent stats.',
    'POST /turn':            'Submit all moves for this tick as a batch. Body: { moves: [{action, x, y, block_type?}] }. Header: X-Api-Key.',
    'POST /suggest':         'Submit a game improvement suggestion. Body: { title, description }. Creates a GitHub issue. Header: X-Api-Key.',
    'POST /tick':            'Advance the game by one tick (admin only). Header: X-Api-Key.',
    'GET /health':           'Health check.',
  },
  history_format: {
    description: 'state.history contains up to 20 rounds. Each round has:',
    fields: {
      tick: 'Tick number when this round was recorded',
      weather: '{ rain_mm, wind_speed_kph, wind_direction }',
      moves: '{ player1: [{action, x, y, block_type}], player2: [...] } — moves made that tick',
      player1: '{ actions, committed, blocks } — player1 summary for the round',
      player2: '{ actions, committed, blocks } — player2 summary for the round',
      weatherEvents: 'Array of damage events: [{ type: "damaged"|"destroyed", x, y, owner, block_type, rain_damage, wind_damage, total_damage, health_before, health_after }]',
    },
  },
  mcp_tools: {
    get_state: 'Get current game state with recent turn history and weather events, structured for AI consumption.',
    get_rules: 'Get these rules.',
    submit_turn: 'Submit all moves for this tick as a batch array. Auto-commits your turn.',
    suggest_improvement: 'Submit a game improvement suggestion that gets raised as a GitHub issue.',
  },
};

export function createMcpRouter() {
  const router = Router();

  router.post('/', async (req, res) => {
    const player = resolvePlayer(req.headers['x-api-key']);
    if (!player) {
      res.status(401).json({ error: 'Invalid or missing X-Api-Key header.' });
      return;
    }

    // StreamableHTTPServerTransport (via @hono/node-server) reads rawHeaders,
    // not req.headers. Inject Accept if the client omitted it so the transport
    // doesn't reject with 406.
    if (!req.headers.accept?.includes('text/event-stream')) {
      req.headers.accept = 'application/json, text/event-stream';
      req.rawHeaders.push('accept', 'application/json, text/event-stream');
    }

    const server = new McpServer({ name: 'sandcastle-game', version: '1.0.0' });

    server.tool(
      'get_state',
      'Get the current game state including board, weather, your action budget, and recent turn history with weather damage events. Use this before planning your moves.',
      {},
      async () => {
        const state = await getState();
        const recentHistory = (state.history || []).slice(-5).map(round => ({
          tick: round.tick,
          weather: round.weather,
          myMoves: round.moves?.[player] || [],
          opponentMoves: round.moves?.[player === 'player1' ? 'player2' : 'player1'] || [],
          myStats: round[player] || {},
          opponentStats: round[player === 'player1' ? 'player2' : 'player1'] || {},
          weatherDamageToMyBlocks: (round.weatherEvents || []).filter(e => e.owner === player),
          weatherDamageToOpponentBlocks: (round.weatherEvents || []).filter(e => e.owner !== player),
        }));

        const response = {
          current_state: {
            tick: state.tick,
            weather: state.weather,
            my_player: player,
            my_actions_used: state.players[player].actionsThisTick,
            my_actions_remaining: 12 - state.players[player].actionsThisTick,
            my_turn_committed: state.players[player].turnCommitted,
            opponent_turn_committed: state.players[player === 'player1' ? 'player2' : 'player1'].turnCommitted,
            my_blocks: state.cells.filter(c => c.owner === player).map(c => ({ x: c.x, y: c.y, type: c.type, health: c.health })),
            opponent_blocks: state.cells.filter(c => c.owner !== player).map(c => ({ x: c.x, y: c.y, type: c.type, health: c.health })),
          },
          recent_history: recentHistory,
        };

        return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
      },
    );

    server.tool(
      'get_rules',
      'Get the game rules: grid dimensions, player zones, block types, action constraints, and weather damage formulas.',
      {},
      async () => ({
        content: [{ type: 'text', text: JSON.stringify(RULES_DOC, null, 2) }],
      }),
    );

    server.tool(
      'submit_turn',
      'Submit all your moves for this tick in a single call. Accepts up to 12 moves as an array. Auto-commits your turn — no separate end_turn call needed.',
      {
        moves: z.array(z.object({
          action: z.enum(['PLACE', 'REMOVE', 'REINFORCE'])
            .describe('PLACE adds a new block; REMOVE deletes one of your blocks; REINFORCE adds 20 health (max 100) to one of your blocks.'),
          x: z.number().int().min(0).max(19)
            .describe('Grid x coordinate (0–19). You must stay within your zone.'),
          y: z.number().int().min(0).max(19)
            .describe('Grid y coordinate (0–19).'),
          block_type: z.enum(['dry_sand', 'wet_sand', 'packed_sand']).optional()
            .describe('Block type — required for PLACE. packed_sand has the highest health (100).'),
        })).min(1).max(ACTIONS_PER_TICK)
          .describe('Array of moves to apply this tick, in order. Max 12.'),
      },
      async ({ moves }) => {
        let state = await getState();

        if (state.players[player].turnCommitted) {
          return {
            content: [{ type: 'text', text: 'Turn already committed this tick.' }],
            isError: true,
          };
        }

        // Validate all moves up-front
        for (let i = 0; i < moves.length; i++) {
          const { action, x, y, block_type } = moves[i];
          const result = validateMove(state, player, { action, x, y, type: block_type });
          if (!result.valid) {
            return {
              content: [{ type: 'text', text: `Move ${i + 1} rejected: ${result.reason}` }],
              isError: true,
            };
          }
        }

        // Apply all moves then auto-commit
        let newState = structuredClone(state);
        for (const { action, x, y, block_type } of moves) {
          newState = applyMove(newState, player, { action, x, y, type: block_type });
        }
        newState = commitTurn(newState, player);
        await saveState(newState);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: true,
              applied: moves.length,
              actionsUsed: newState.players[player].actionsThisTick,
              turnCommitted: true,
            }),
          }],
        };
      },
    );

    server.tool(
      'suggest_improvement',
      'Submit a suggestion to improve the game. Creates a GitHub issue for the game developers to review. Use this when you notice something that could make the game better — new block types, rule changes, balance tweaks, etc.',
      {
        title: z.string().min(1).max(200).describe('Short title for the suggestion (max 200 chars)'),
        description: z.string().min(10).max(2000).describe('Detailed description of the improvement (10-2000 chars)'),
      },
      async ({ title, description }) => {
        try {
          const state = await getState();
          const issueTitle = `[Player Suggestion] ${title.trim()}`;
          const issueBody = `## Player Suggestion\n\n**Submitted by:** ${player}\n**Current Tick:** ${state.tick}\n\n### Description\n\n${description.trim()}\n\n---\n*This suggestion was automatically submitted by the ${player} AI agent.*`;
          
          const token = process.env.SUGGESTIONS_GITHUB_TOKEN;
          if (!token) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'SUGGESTIONS_GITHUB_TOKEN not configured on server' }) }] };
          }
          
          const response = await fetch('https://api.github.com/repos/adamd9/sandcastle-game/issues', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
              'Content-Type': 'application/json',
              'User-Agent': 'sandcastle-game-api',
            },
            body: JSON.stringify({ title: issueTitle, body: issueBody, labels: ['game-improvement'] }),
          });
          
          if (!response.ok) {
            const err = await response.text();
            return { content: [{ type: 'text', text: JSON.stringify({ error: `GitHub API error: ${err}` }) }] };
          }
          
          const issue = await response.json();
          return {
            content: [{ type: 'text', text: JSON.stringify({ ok: true, issue_number: issue.number, issue_url: issue.html_url }) }],
          };
        } catch (err) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] };
        }
      },
    );

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — new transport per request
      enableJsonResponse: true,      // return JSON, not SSE, for test/agent compatibility
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // MCP spec: respond to GET with 405 (no SSE streaming needed for stateless)
  router.get('/', (_req, res) => {
    res.status(405).json({ error: 'Use POST for MCP requests.' });
  });

  return router;
}
