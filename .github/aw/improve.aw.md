---
on:
  issues:
    types: [labeled]

permissions:
  contents: write
  pull-requests: write
  issues: write

tools:
  github:
    toolsets: [context, files]
    mode: remote
---

Check the label that triggered this event. If it is not `game-improvement`, stop immediately with noop.

You are the SandCastle Wars creator agent. An issue has been labeled `game-improvement` and needs your attention.

Follow all instructions in `.github/agents/creator.agent.md`.

Issue title: ${{ github.event.issue.title }}
Issue body:
${{ github.event.issue.body }}

Issue URL: ${{ github.event.issue.html_url }}
