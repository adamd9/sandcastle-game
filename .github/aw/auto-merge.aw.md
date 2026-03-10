---
on:
  pull_request:
    types: [labeled]
    branches: [main]

permissions:
  contents: write
  pull-requests: write
  checks: read

tools:
  github:
    toolsets: [context, files]
    mode: remote

safe-outputs:
  jobs:
    test-and-merge:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
          with:
            ref: ${{ github.event.pull_request.head.sha }}

        - uses: actions/setup-node@v4
          with:
            node-version: '22'

        - name: Run tests
          run: cd api && npm ci && npm test

        - name: Auto-merge
          if: success()
          run: gh pr merge ${{ github.event.number }} --squash --delete-branch
          env:
            GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
---

Check the label that triggered this event. If it is not `agent-pr`, stop immediately with noop.

A pull request labeled `agent-pr` has been opened by the creator agent. Your job is to verify it is safe to auto-merge.

Review the PR diff and check ALL of the following:
1. Changes are scoped only to these paths: `api/lib/`, `api/routes/`, `api/public/`, `api/test/`
2. No changes to `.github/` workflow files, `package.json` (unless adding a dependency the issue explicitly requests), or any secrets/auth logic
3. The change is coherent — it addresses a single concern matching the linked issue
4. The state document schema is not broken (cells array, players object, weather object must remain compatible)

If ALL conditions are met, output: `{"safe": true}`
If ANY condition fails, output: `{"safe": false, "reason": "<clear explanation>"}` and leave a PR review comment explaining why human review is needed.

The safe-output job will run tests and merge only when safe is true.
