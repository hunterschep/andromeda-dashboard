# Andromeda Compute Dashboard

Local, read-only dashboard for Boston College Andromeda Slurm resources.

The app runs on `127.0.0.1` and collects data through the configured OpenSSH alias
`andromeda`. It does not store passwords or SSH keys. Each lab member can clone the repo,
use their own SSH config or agent, and run the dashboard locally.

## Quick Start

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

## SSH Requirements

The dashboard only runs read-only Slurm commands through:

```bash
ssh andromeda '<slurm command>'
```

Configure `~/.ssh/config` or your SSH agent so that `ssh andromeda` succeeds with key-based
auth. Password storage is intentionally unsupported.

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
```

## API

- `GET /api/health`
- `GET /api/config/status`
- `GET /api/resources`
- `GET /api/partitions`
- `GET /api/queue?scope=mine|lab|cluster`
- `GET /api/jobs/mine`
- `GET /api/history?days=7|30`
- `GET /api/insights`

All endpoints return normalized app types rather than raw Slurm JSON. If one Slurm command
fails, the API returns cached data when available and includes a stale/error warning.

## Slurm Data Sources

The collector uses read-only CLI probes over SSH: `scontrol show nodes --json`,
`scontrol show partition --json`, `sinfo --json`, `squeue --json`,
`squeue --start --json`, `sacct --json`, `sacctmgr show assoc`,
`sacctmgr show qos`, `sdiag`, and `sprio -w`.

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
pytest
npm test --prefix frontend
npm run build --prefix frontend
```

The FastAPI server serves the built frontend from `frontend/dist` when present. During
frontend development, Vite proxies `/api` to `http://127.0.0.1:8765`.
