import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Router } from 'express';
import { z } from 'zod';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getState, saveState } from '../lib/db.js';
import { validateMove, applyMove, commitTurn } from '../lib/gameLogic.js';
import { renderBoard } from '../lib/renderer.js';
import {
  GRID_WIDTH, GRID_HEIGHT, ZONES, ACTIONS_PER_TICK,
  BLOCK_TYPES, VALID_ACTIONS, REINFORCE_AMOUNT, MAX_HEALTH,
  WATER_ROWS, MAX_LEVEL, FLAGS_MAX_LABEL_LENGTH, FLAG_MIN_SPACING,
  rainDamage, windDamage,
} from '../lib/rules.js';

function resolvePlayer(key) {
  if (key && key === process.env.PLAYER1_API_KEY) return 'player1';
  if (key && key === process.env.PLAYER2_API_KEY) return 'player2';
  return null;
}

// Returns true if there is at least one empty cell (no blocks at any level) on
// the Bresenham line between (x1,y1) and (x2,y2), meaning the two flags are
// separated by a gap in the sandcastle structure.
function flagsSeparatedByGap(state, x1, y1, x2, y2) {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1;
  const sy = y1 < y2 ? 1 : -1;
  let x = x1, y = y1, err = dx - dy;
  const steps = Math.max(dx, dy);
  for (let i = 0; i < steps - 1; i++) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx)  { err += dx; y += sy; }
    if (!state.cells.some(c => c.x === x && c.y === y)) return true;
  }
  return false;
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
    base_damage: 'Every cell takes 5 damage per tick regardless of weather.',
    rain: 'Each cell loses an additional floor(rain_mm * 10) health per tick when it rains.',
    wind: 'Cells on the windward edge lose an additional floor(wind_speed_kph / 3) health per tick.',
    tip: 'Build exterior walls to shield interior blocks from wind. Reinforce frequently. Avoid building in the water zone (y=0–2) — it is ocean.',
  },
  water_zone: {
    rows: `y=0 to y=${WATER_ROWS - 1}`,
    description: 'Ocean — no building. Wave events surge from here.',
  },
  levels: {
    max_level: MAX_LEVEL,
    description: 'Each (x,y) cell can stack up to 4 blocks (levels 0–3). Must place L0 before L1. Removing a level destroys all levels above (cascade).',
    weather_interaction: 'Normal/storm damage hits only the TOP level. Wave surge destroys L0 in affected rows → cascades all levels above.',
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
  goal: {
    statement: 'Your goal is to build a beautiful, impressive, elaborate sandcastle — not just survive weather. Think outer defensive walls, inner towers, courtyards, ramparts. Aim for a castle that would look impressive from above. Function AND aesthetics matter.',
    scoring_hint: 'While there is no formal scoring yet, your castle will be judged on: (1) structural integrity under weather — does it survive? (2) architectural complexity — is it more than a flat block? (3) strategic depth — have you protected your inner blocks with outer walls?',
  },
  strategy_hints: {
    outer_walls: 'Build your outer perimeter first using packed_sand (highest HP). Outer walls on the windward edge take wind bonus damage — reinforce them frequently.',
    inner_structures: 'Once walls are up, use inner cells for towers and internal features using wet_sand or packed_sand.',
    wind_protection: 'Wind only damages cells on the grid edge facing the wind direction. Interior blocks are shielded. Outer walls act as sacrificial protection.',
    zone: 'Your zone is columns {x_min} to {x_max}, rows 0 to 19. You have 200 cells to work with.',
    recommended_pattern: 'Consider: outer ring of packed_sand walls (rows 0,19 and your zone boundary columns), then inner structures. A thick outer wall absorbs weather while your castle grows inside.',
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
          ...(round.judgment && { judgment: round.judgment }),
        }));

        const lastJudgment = (state.judgments || []).length > 0
          ? state.judgments[state.judgments.length - 1]
          : null;

        const response = {
          current_state: {
            tick: state.tick,
            weather: state.weather,
            my_player: player,
            my_actions_used: state.players[player].actionsThisTick,
            my_actions_remaining: 12 - state.players[player].actionsThisTick,
            my_turn_committed: state.players[player].turnCommitted,
            opponent_turn_committed: state.players[player === 'player1' ? 'player2' : 'player1'].turnCommitted,
            my_blocks: state.cells.filter(c => c.owner === player).map(c => ({ x: c.x, y: c.y, level: c.level, type: c.type, health: c.health })),
            opponent_blocks: state.cells.filter(c => c.owner !== player).map(c => ({ x: c.x, y: c.y, level: c.level, type: c.type, health: c.health })),
            scores: state.scores ?? { player1: 0, player2: 0 },
            last_judgment: lastJudgment,
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
            .describe('Block type — required for PLACE. packed_sand has the highest health (60).'),
          level: z.number().int().min(0).max(3).optional().default(0)
            .describe('Vertical level to act on: 0=ground, 1=first floor, 2=tower, 3=spire. Default: 0 for PLACE. Must place L0 before L1, etc.'),
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
          const { action, x, y, block_type, level } = moves[i];
          const result = validateMove(state, player, { action, x, y, type: block_type, level });
          if (!result.valid) {
            return {
              content: [{ type: 'text', text: `Move ${i + 1} rejected: ${result.reason}` }],
              isError: true,
            };
          }
        }

        // Apply all moves then auto-commit
        let newState = structuredClone(state);
        for (const { action, x, y, block_type, level } of moves) {
          newState = applyMove(newState, player, { action, x, y, type: block_type, level });
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
          
          const token = process.env.SUGGESTIONS_GITHUB_TOKEN || process.env.TICK_ADMIN_KEY;
          if (!token) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'No GitHub token configured (set SUGGESTIONS_GITHUB_TOKEN or TICK_ADMIN_KEY)' }) }] };
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

    server.tool(
      'place_flag',
      'Place a named flag on one of your blocks to label a structure (e.g., "main wall", "castle tower"). Replaces any existing flag at the same position.',
      {
        x: z.number().int().min(0).max(19).describe('Grid x coordinate'),
        y: z.number().int().min(0).max(19).describe('Grid y coordinate'),
        level: z.number().int().min(0).max(3).optional().default(0).describe('Block level (0–3). Default: 0'),
        label: z.string().min(1).max(FLAGS_MAX_LABEL_LENGTH).describe(`Flag label (max ${FLAGS_MAX_LABEL_LENGTH} chars)`),
      },
      async ({ x, y, level, label }) => {
        const state = await getState();
        const cell = state.cells.find(c => c.x === x && c.y === y && c.level === level);
        if (!cell) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: `No block at (${x},${y}) level ${level}.` }) }], isError: true };
        }
        if (cell.owner !== player) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: `Cell (${x},${y}) level ${level} belongs to ${cell.owner}, not you.` }) }], isError: true };
        }
        // Enforce flag spacing: no two flags within FLAG_MIN_SPACING grid units unless separated by empty cells
        const tooClose = (state.flags || []).find(f => {
          if (f.x === x && f.y === y) return false; // same cell — will be replaced
          const dist = Math.sqrt(Math.pow(x - f.x, 2) + Math.pow(y - f.y, 2));
          return dist < FLAG_MIN_SPACING && !flagsSeparatedByGap(state, x, y, f.x, f.y);
        });
        if (tooClose) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: `Too close to existing flag "${tooClose.label}" at (${tooClose.x},${tooClose.y}). Flags must be at least ${FLAG_MIN_SPACING} grid units apart unless separated by empty space.` }) }], isError: true };
        }
        const trimmedLabel = String(label).slice(0, FLAGS_MAX_LABEL_LENGTH);
        const newState = structuredClone(state);
        newState.flags = (newState.flags || []).filter(f => !(f.x === x && f.y === y && f.level === level));
        const flag = { id: `flag_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, x, y, level, owner: player, label: trimmedLabel };
        newState.flags.push(flag);
        await saveState(newState);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, flag }) }] };
      },
    );

    server.tool(
      'remove_flag',
      'Remove a flag you previously placed on a block.',
      {
        x: z.number().int().min(0).max(19).describe('Grid x coordinate'),
        y: z.number().int().min(0).max(19).describe('Grid y coordinate'),
        level: z.number().int().min(0).max(3).optional().default(0).describe('Block level (0–3). Default: 0'),
      },
      async ({ x, y, level }) => {
        const state = await getState();
        const flag = (state.flags || []).find(f => f.x === x && f.y === y && f.level === level);
        if (!flag) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: `No flag at (${x},${y}) level ${level}.` }) }], isError: true };
        }
        if (flag.owner !== player) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: `Flag at (${x},${y}) level ${level} belongs to ${flag.owner}, not you.` }) }], isError: true };
        }
        const newState = structuredClone(state);
        newState.flags = newState.flags.filter(f => !(f.x === x && f.y === y && f.level === level));
        await saveState(newState);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
      },
    );

    server.tool(
      'get_board_image',
      'Get a rendered PNG image of the game board. Use this to visually see your castle and your opponent\'s castle. Returns a base64-encoded PNG image.',
      {
        view: z.enum(['my_castle', 'opponent_castle', 'full_board']).optional().default('full_board')
          .describe('Which part of the board to render: my_castle, opponent_castle, or full_board.'),
      },
      async ({ view }) => {
        const state = await getState();
        let renderView = 'full';
        if (view === 'my_castle') renderView = player;
        else if (view === 'opponent_castle') renderView = player === 'player1' ? 'player2' : 'player1';

        const buf = await renderBoard(state, { view: renderView, cellSize: 30 });
        return {
          content: [
            { type: 'image', data: buf.toString('base64'), mimeType: 'image/png' },
            { type: 'text', text: `Board rendered (view: ${view}, tick: ${state.tick}, cells: ${state.cells.length}).` },
          ],
        };
      },
    );

    server.tool(
      'post_turn_summary',
      'Post a turn summary with a screenshot of your castle and your commentary. Call this after submitting your turn. The screenshot and commentary are posted to the game log GitHub issue.',
      {
        commentary: z.string().min(1).max(280)
          .describe('1-2 sentences about your move this turn (max 280 chars).'),
      },
      async ({ commentary }) => {
        try {
          const state = await getState();
          const buf = await renderBoard(state, { view: player, cellSize: 30 });

          // Save screenshot locally
          const __dir = dirname(fileURLToPath(import.meta.url));
          const screenshotsDir = join(__dir, '..', 'public', 'screenshots');
          if (!existsSync(screenshotsDir)) mkdirSync(screenshotsDir, { recursive: true });
          const filename = `tick-${state.tick}-${player}.png`;
          writeFileSync(join(screenshotsDir, filename), buf);

          // Try to post to GitHub issue
          const token = process.env.SUGGESTIONS_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
          const issueNumber = process.env.GAME_LOG_ISSUE_NUMBER;
          const publicUrl = process.env.GAME_PUBLIC_URL;

          if (token && issueNumber && publicUrl) {
            const imageUrl = `${publicUrl}/screenshots/${filename}`;
            const playerLabel = player === 'player1' ? '🏖️ Player 1' : '🌿 Player 2';
            const body = `### ${playerLabel} — Tick ${state.tick}\n\n![${player} castle](${imageUrl})\n\n> ${commentary.trim()}\n\n*Blocks: ${state.cells.filter(c => c.owner === player).length} | Score: ${(state.scores?.[player]) ?? 0}*`;

            await fetch(`https://api.github.com/repos/adamd9/sandcastle-game/issues/${issueNumber}/comments`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type': 'application/json',
                'User-Agent': 'sandcastle-game-api',
              },
              body: JSON.stringify({ body }),
            });
          }

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                ok: true,
                screenshot: filename,
                posted_to_github: !!(token && issueNumber && publicUrl),
              }),
            }],
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
            isError: true,
          };
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
