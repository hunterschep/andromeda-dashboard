# LGTM

This repo is ready to ship when the checklist below passes on a clean worktree.

## Required Checks

```bash
.venv/bin/pytest
.venv/bin/ruff check .
npm test --prefix frontend -- --run
npm run build --prefix frontend
npm audit --prefix frontend
```

## Optional Live Smoke

Run only when `ssh andromeda` already works with key or agent auth:

```bash
ANDROMEDA_LIVE_TEST=1 .venv/bin/pytest tests/test_live_smoke.py
```

## Acceptance Criteria

- Fresh clone can create a virtualenv, install backend/frontend dependencies, and start the app.
- Dashboard binds to `127.0.0.1` by default.
- SSH uses only the configured `andromeda` alias with batch/key auth.
- No plaintext passwords, SSH keys, tokens, or submit lines are stored or displayed.
- One failed Slurm command degrades to cached data where available.
- Mine/lab/cluster queue scopes preserve privacy defaults.
- Node, GPU, partition, queue, job, history, scheduler, QOS, cache, command-helper, and JSON
  export surfaces load without runtime errors.
- The UI remains readable at desktop and narrow widths.
