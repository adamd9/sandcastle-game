import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Router } from 'express';
import { z } from 'zod';
import { getState, saveState } from '../lib/db.js';
import { validateMove, applyMove, validateCommit, commitTurn } from '../lib/gameLogic.js';
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
      'Get the current game state including all cell positions, health values, weather, tick number, and action budgets.',
      {},
      async () => {
        const state = await getState();
        return { content: [{ type: 'text', text: JSON.stringify(state, null, 2) }] };
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
      'submit_move',
      'Submit a single move action. Returns how many actions you have used this tick and how many remain. Call up to 12 times per tick.',
      {
        action: z.enum(['PLACE', 'REMOVE', 'REINFORCE'])
          .describe('PLACE adds a new block; REMOVE deletes one of your blocks; REINFORCE adds 20 health (max 100) to one of your blocks.'),
        x: z.number().int().min(0).max(19)
          .describe('Grid x coordinate (0–19). You must stay within your zone.'),
        y: z.number().int().min(0).max(19)
          .describe('Grid y coordinate (0–19).'),
        block_type: z.enum(['dry_sand', 'wet_sand', 'packed_sand']).optional()
          .describe('Block type — required for PLACE. packed_sand has the highest health (100).'),
      },
      async ({ action, x, y, block_type }) => {
        const state = await getState();
        const moveAction = { action, x, y, type: block_type };
        const result = validateMove(state, player, moveAction);

        if (!result.valid) {
          return {
            content: [{ type: 'text', text: `Move rejected: ${result.reason}` }],
            isError: true,
          };
        }

        const newState = applyMove(structuredClone(state), player, moveAction);
        await saveState(newState);

        const used = newState.players[player].actionsThisTick;
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: true,
              action,
              x,
              y,
              actionsThisTick: used,
              actionsRemaining: ACTIONS_PER_TICK - used,
            }),
          }],
        };
      },
    );

    server.tool(
      'end_turn',
      'Commit your turn for the current tick. After committing, no further moves can be made until the next tick. The opponent and game history can see whether you committed.',
      {},
      async () => {
        const state = await getState();
        const result = validateCommit(state, player);

        if (!result.valid) {
          return {
            content: [{ type: 'text', text: `Cannot commit: ${result.reason}` }],
            isError: true,
          };
        }

        const newState = commitTurn(structuredClone(state), player);
        await saveState(newState);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: true,
              player,
              turnCommitted: true,
              actionsUsed: newState.players[player].actionsThisTick,
            }),
          }],
        };
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
