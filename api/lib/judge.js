// Visual scoring — sends rendered castle images to an OpenAI vision model
// and returns a judgment of which castle is more impressive.

import { JUDGE_MODEL } from './rules.js';

/**
 * Judge two castles visually using an OpenAI vision model.
 * @param {Buffer} p1Image — PNG of Player 1's zone
 * @param {Buffer} p2Image — PNG of Player 2's zone
 * @param {object} [context]
 * @param {Array}  [context.p1Flags] — Player 1's flag objects (with label, x, y)
 * @param {Array}  [context.p2Flags] — Player 2's flag objects (with label, x, y)
 * @param {number} [context.tick]
 * @returns {{ winner: 'player1'|'player2'|'tie', reasoning: string, p1_feedback: string, p2_feedback: string }}
 */
export async function judgeCastles(p1Image, p2Image, { p1Flags = [], p2Flags = [], tick = null } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { winner: 'tie', reasoning: 'Visual judging unavailable — no OPENAI_API_KEY configured.', p1_feedback: '', p2_feedback: '' };
  }

  // Build a text summary of named structures for each player
  const formatFlags = (flags, player) => {
    if (!flags.length) return `${player} has not named any structures.`;
    const unique = [...new Map(flags.map(f => [`${f.x},${f.y}`, f])).values()];
    return `${player} named structures (flag labels visible on the image): ${unique.map(f => `"${f.label}"`).join(', ')}`;
  };
  const flagContext = `${formatFlags(p1Flags, 'Player 1')}\n${formatFlags(p2Flags, 'Player 2')}`;
  const tickNote = tick !== null ? `This is tick ${tick}.` : '';

  try {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey });

    const response = await client.responses.create({
      model: JUDGE_MODEL,
      input: [
        {
          role: 'system',
          content: `You are an expert sandcastle architecture judge with a keen eye for design, strategy, and construction quality. You will see two top-down grid images — Player 1's zone and Player 2's zone. Each zone is 10×20 cells.

**Visual key:**
- Gold/tan blocks = Player 1. Green blocks = Player 2. Darker = higher level (taller structure). More opaque = healthier block.
- Coloured pennant flags with text labels mark named structures (blue pennants = P1, pink = P2).
- Block sizes within a cell shrink as levels increase (L0=full cell, L3=small centre square).

**Scoring criteria — evaluate each player independently, then compare:**
1. **Architectural Vision** — Does the layout suggest a deliberate design (castle keep, outer walls, towers, moat gap)? Or is it just a mass of blocks?
2. **Structural Complexity** — Use of multiple levels, variety of block types, interesting 3D height profile.
3. **Defensive Thinking** — Are high-value inner structures protected by outer layers? Smart use of the coastal/wall position?
4. **Named Structures** — Do the flag labels correspond to identifiable structures in the image? Are structures named thoughtfully? Names that match visible shapes earn credit.
5. **Resilience** — Block health (opacity). Heavily damaged structures are less impressive.

**Your response must be valid JSON only (no markdown, no code fences) in exactly this shape:**
{
  "winner": "player1" or "player2" or "tie",
  "reasoning": "2-4 sentence comparative analysis explaining WHY one castle is superior — cite specific structures, flag names, and visible features. Be direct and specific.",
  "p1_feedback": "2-3 sentences of constructive feedback for Player 1 — what's working, what to improve, what strategy to consider next tick.",
  "p2_feedback": "2-3 sentences of constructive feedback for Player 2 — same format."
}`,
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `Judge these two sandcastles. Image 1 is Player 1's zone, Image 2 is Player 2's zone. ${tickNote}\n\n${flagContext}`,
            },
            {
              type: 'input_image',
              image_url: `data:image/png;base64,${p1Image.toString('base64')}`,
            },
            {
              type: 'input_image',
              image_url: `data:image/png;base64,${p2Image.toString('base64')}`,
            },
          ],
        },
      ],
    });

    const text = response.output_text.trim();
    const parsed = JSON.parse(text);

    if (!['player1', 'player2', 'tie'].includes(parsed.winner)) {
      return { winner: 'tie', reasoning: `Invalid winner value: ${parsed.winner}`, p1_feedback: '', p2_feedback: '' };
    }

    return {
      winner: parsed.winner,
      reasoning: String(parsed.reasoning || 'No reasoning provided.').slice(0, 1500),
      p1_feedback: String(parsed.p1_feedback || '').slice(0, 800),
      p2_feedback: String(parsed.p2_feedback || '').slice(0, 800),
    };
  } catch (err) {
    console.error('Visual judging failed:', err.message);
    return { winner: 'tie', reasoning: `Judge error: ${err.message}`, p1_feedback: '', p2_feedback: '' };
  }
}
