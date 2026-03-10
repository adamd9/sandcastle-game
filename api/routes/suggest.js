import { Router } from 'express';
import { getState } from '../lib/db.js';

const router = Router();

function resolvePlayer(key) {
  if (key && key === process.env.PLAYER1_API_KEY) return 'player1';
  if (key && key === process.env.PLAYER2_API_KEY) return 'player2';
  return null;
}

async function createGitHubIssue(title, body) {
  const token = process.env.SUGGESTIONS_GITHUB_TOKEN;
  if (!token) throw new Error('SUGGESTIONS_GITHUB_TOKEN not configured');
  
  const response = await fetch('https://api.github.com/repos/adamd9/sandcastle-game/issues', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'sandcastle-game-api',
    },
    body: JSON.stringify({
      title,
      body,
      labels: ['game-improvement'],
    }),
  });
  
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`GitHub API error ${response.status}: ${err}`);
  }
  return response.json();
}

router.post('/', async (req, res) => {
  const player = resolvePlayer(req.headers['x-api-key']);
  if (!player) return res.status(401).json({ error: 'Invalid or missing X-Api-Key header.' });

  const { title, description } = req.body;
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return res.status(400).json({ error: 'title is required' });
  }
  if (!description || typeof description !== 'string' || description.trim().length === 0) {
    return res.status(400).json({ error: 'description is required' });
  }

  try {
    const state = await getState();
    const issueTitle = `[Player Suggestion] ${title.trim()}`;
    const issueBody = `## Player Suggestion\n\n**Submitted by:** ${player}\n**Current Tick:** ${state.tick}\n\n### Description\n\n${description.trim()}\n\n---\n*This suggestion was automatically submitted by the ${player} AI agent.*`;
    
    const issue = await createGitHubIssue(issueTitle, issueBody);
    
    res.json({
      ok: true,
      issue_number: issue.number,
      issue_url: issue.html_url,
      player,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
