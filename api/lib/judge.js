// Visual scoring — sends rendered castle images to an OpenAI vision model
// and returns a judgment of which castle is more impressive.

import { JUDGE_MODEL } from './rules.js';

/**
 * Judge two castles visually using an OpenAI vision model.
 * @param {Buffer} p1Image — PNG of Player 1's zone
 * @param {Buffer} p2Image — PNG of Player 2's zone
 * @returns {{ winner: 'player1'|'player2'|'tie', reasoning: string }}
 */
export async function judgeCastles(p1Image, p2Image) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { winner: 'tie', reasoning: 'Visual judging unavailable — no OPENAI_API_KEY configured.' };
  }

  try {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey });

    const response = await client.responses.create({
      model: JUDGE_MODEL,
      input: [
        {
          role: 'system',
          content: `You are a sandcastle architecture judge. You will see two top-down images of sandcastles built on a grid — one by Player 1 (gold/tan blocks) and one by Player 2 (green blocks). Darker blocks are higher level (more impressive structures). Block opacity indicates health.

Evaluate each castle on:
1. **Creativity & Design** — Is there an interesting shape, symmetry, or architectural concept?
2. **Structural Complexity** — Height variation (darker blocks = taller), use of levels, density
3. **Aesthetic Appeal** — Does it look like a deliberate structure or random blocks?
4. **Defensive Design** — Are outer walls protecting inner structures?

Respond with EXACTLY this JSON format (no markdown, no code fences):
{"winner": "player1" or "player2" or "tie", "reasoning": "One sentence explaining why"}`,
        },
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'Judge these two sandcastles. Image 1 is Player 1\'s castle, Image 2 is Player 2\'s castle.' },
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
      return { winner: 'tie', reasoning: `Invalid winner value: ${parsed.winner}` };
    }

    return {
      winner: parsed.winner,
      reasoning: String(parsed.reasoning || 'No reasoning provided.').slice(0, 500),
    };
  } catch (err) {
    console.error('Visual judging failed:', err.message);
    return { winner: 'tie', reasoning: `Judge error: ${err.message}` };
  }
}
