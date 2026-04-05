#!/usr/bin/env node
// Fetches all PRs from both player repos using the `gh` CLI.
// Usage: node fetch-prs.js [output-dir]
//
// Requires: `gh` CLI authenticated (gh auth login)
// Outputs: player-one-prs.json, player-two-prs.json

import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const REPOS = [
  { owner: 'adamd9', repo: 'sandcastle-player-one', outFile: 'player-one-prs.json' },
  { owner: 'adamd9', repo: 'sandcastle-player-two', outFile: 'player-two-prs.json' },
];

const FIELDS = 'number,title,body,createdAt,state,labels';
const PAGE_SIZE = 1000;

const outDir = process.argv[2] || process.cwd();
mkdirSync(outDir, { recursive: true });

for (const { owner, repo, outFile } of REPOS) {
  const fullRepo = `${owner}/${repo}`;
  console.log(`\nFetching PRs from ${fullRepo}...`);

  const cmd = `gh pr list --repo ${fullRepo} --state all --limit ${PAGE_SIZE} --json ${FIELDS}`;
  const raw = execSync(cmd, { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 });
  const prs = JSON.parse(raw);

  // Sort by PR number ascending
  prs.sort((a, b) => a.number - b.number);

  const outPath = join(outDir, outFile);
  writeFileSync(outPath, JSON.stringify(prs, null, 2));

  // Stats
  const dates = prs.map(p => p.createdAt).filter(Boolean).sort();
  const tickCount = prs.filter(p => p.title && /tick/i.test(p.title)).length;

  console.log(`  Total PRs: ${prs.length}`);
  console.log(`  Date range: ${dates[0]?.slice(0, 10) ?? 'N/A'} → ${dates.at(-1)?.slice(0, 10) ?? 'N/A'}`);
  console.log(`  PRs with "tick" in title: ${tickCount}`);
  console.log(`  Saved to: ${outPath}`);
}

console.log('\nDone.');
