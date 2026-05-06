# Andromeda Compute Dashboard

Local, read-only dashboard for Boston College Andromeda Slurm resources.

The app runs on `127.0.0.1` and collects data through the configured OpenSSH alias
`andromeda`. It does not store passwords or SSH keys. Each lab member can clone the repo,
use their own SSH config or agent, and run the dashboard locally.

## What It Includes

- FastAPI backend with normalized Slurm models and local SQLite stale-cache fallback.
- React/Vite dashboard for resources, fleet state, GPU pools, partitions, queue pressure,
  visible users, jobs, history, insights, scheduler health, QOS/account limits, command
  helpers, cache diagnostics, auto-refresh, and JSON snapshot export.
- CLI for config setup, SSH validation, read-only probe runs, and serving the app.
- Test fixtures covering Slurm JSON quirks, GRES variants, stale fallback, privacy behavior,
  API contracts, frontend filters, empty states, and responsive navigation.
- CI for backend tests/lint and frontend tests/build.
- Architecture notes and a LOC guard keep maintained files small and reviewable.

## Quick Start From A Fresh Clone

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e ".[dev]"
npm install --prefix frontend

andromeda-dashboard init-config
andromeda-dashboard check-ssh
andromeda-dashboard serve
```

In a second terminal:

```bash
npm run dev --prefix frontend
```

Open `http://127.0.0.1:5173`.

For the built single-server path:

```bash
npm run build --prefix frontend
andromeda-dashboard serve
```

Open `http://127.0.0.1:8765`.

## SSH Requirements

The dashboard only runs read-only Slurm commands through:

```bash
ssh andromeda '<slurm command>'
```

Configure `~/.ssh/config` or your SSH agent so that `ssh andromeda` succeeds with key-based
auth. Password storage is intentionally unsupported.

Minimal SSH config shape:

```sshconfig
Host andromeda
  HostName <andromeda-login-host>
  User YOUR_BC_USERNAME
  IdentityFile ~/.ssh/YOUR_KEY
  IdentitiesOnly yes
```

The app uses `BatchMode=yes` and `PasswordAuthentication=no`. If key or VPN auth fails, fix
local SSH access first; the app will not fall back to password prompts.

## Configuration

Default config path:

```text
~/.config/andromeda-dashboard/config.toml
```

Example:

```toml
[ssh]
alias = "andromeda"
connect_timeout_seconds = 8
command_timeout_seconds = 25
control_master = true

[server]
host = "127.0.0.1"
port = 8765

[privacy]
debug = false
default_scope = "mine"

[lab]
users = ["alice", "bob"]

[cache]
path = "~/.cache/andromeda-dashboard/cache.sqlite3"

[history]
default_days = 7

[slurm]
# Optional. Leave unset to auto-detect the remote Andromeda username.
# user = "your_andromeda_username"
```

The dashboard auto-detects the remote Slurm username through the configured SSH alias. Set
`slurm.user` only if your SSH environment reports a different value than Slurm uses.

## API

- `GET /api/health`
- `GET /api/config/status`
- `GET /api/resources`
- `GET /api/partitions`
- `GET /api/queue?scope=mine|lab|cluster`
- `GET /api/jobs/mine`
- `GET /api/history?days=7|30`
- `GET /api/insights`
- `GET /api/snapshot?scope=mine|lab|cluster&days=7|30`

All endpoints return normalized app types rather than raw Slurm JSON. If one Slurm command
fails, the API returns cached data when available and includes a stale/error warning.
The frontend uses `/api/snapshot` for the main page load so overlapping Slurm probes are
normalized once and cache diagnostics cover every data source the dashboard depends on.

## Slurm Data Sources

The collector uses read-only CLI probes over SSH: `scontrol show nodes --json`,
`scontrol show partition --json`, `sinfo --json`, `squeue --json`,
`squeue --start --json`, `sacct --json`, `sacctmgr show assoc`,
`sacctmgr show qos`, `sdiag`, and `sprio -w`.

Cache TTLs:

- Live queue/resources: 30 seconds.
- Scheduler health: 60 seconds.
- Accounting history: 15 minutes.
- Partition/static metadata and account limits: 1 hour.

## Power User Dashboard Tools

- Node explorer with partition, state, GPU type, feature/name filters, free CPU/memory/GPU,
  a compact 284-node fleet grid, grouped summaries, a default first-80 table view, and
  drain/down reasons.
- Partition matrix for fast CPU/GPU/memory/time scanning before opening the detailed table.
- Queue explorer with mine/lab/cluster privacy scopes, partition/GPU/state/reason/search
  filters, Slurm start estimates, dependencies, node placement, and pending reason labels.
- Queue pressure panel with running/pending totals, pending CPU/GPU demand, top pending
  reasons, partition load, GPU asks, and visible-user workload.
- My Jobs panel with elapsed/limit/request/node details and one-click copy for
  `scontrol show job -dd`.
- Runtime rows for active jobs and a recent accounting table with wait/runtime/state.
- Scheduler panel with `sdiag` cycle/backfill values and `sprio -w` priority weights.
- Account limits panel with visible `sacctmgr` association and QOS limits.
- Read-only command helpers for identity probes, quotas, node/queue JSON, start estimates,
  accounting history, scheduler health, and QOS checks.
- Cache diagnostics showing freshness, TTL, capture time, and last command error.
- Manual, 30-second, and 60-second refresh modes with last-loaded and stale-cache status.
- JSON snapshot export for bug reports, lab discussion, or offline inspection.

## Privacy Defaults

- Binds to `127.0.0.1`.
- Shows own jobs by default.
- Supports optional `lab.users` for lab-scoped views.
- Anonymizes non-lab users in cluster queue views unless `privacy.debug = true`.
- Does not expose `sacct.submit_line` unless debug mode is enabled.

## Live Smoke Test

The live smoke test is opt-in and uses only lightweight read-only probes:

```bash
ANDROMEDA_LIVE_TEST=1 pytest tests/test_live_smoke.py
```

It requires working `ssh andromeda` auth and validates that Slurm JSON commands respond.

## Development

```bash
python scripts/check_loc.py
pytest
ruff check .
npm test --prefix frontend
npm run build --prefix frontend
npm audit --prefix frontend
```

The FastAPI server serves the built frontend from `frontend/dist` when present. During
frontend development, Vite proxies `/api` to `http://127.0.0.1:8765`.

See `docs/architecture.md` for the backend/frontend module boundaries and file-size rule.

## LGTM Checklist

Before merging or tagging a release:

```bash
.venv/bin/pytest
.venv/bin/ruff check .
python scripts/check_loc.py
npm test --prefix frontend -- --run
npm run build --prefix frontend
npm audit --prefix frontend
```

Optional live validation:

```bash
ANDROMEDA_LIVE_TEST=1 .venv/bin/pytest tests/test_live_smoke.py
```

Release is LGTM when the checks pass, `git status --short` is clean, the dashboard loads
locally, and no command path stores credentials or writes to Andromeda.
