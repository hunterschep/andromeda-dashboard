# Architecture

The dashboard is intentionally split around data ownership boundaries. No maintained source file
should exceed 300 LOC; `scripts/check_loc.py` enforces that limit in tests.

## Backend

- `api.py` exposes normalized HTTP contracts.
- `collector.py` owns SSH command execution, cache reuse, and snapshot composition.
- `models.py` defines stable API types.
- `normalizers/` converts Slurm and text command output into stable models:
  - `common.py`: Slurm value coercion, time/memory/TRES parsing, GPU parsing.
  - `resources.py`: nodes, GPU pools, partitions, and cluster summary.
  - `queue.py`: queue scope filtering, privacy anonymization, and pending reason labels.
  - `history.py`: accounting rows and wait/runtime medians.
  - `accounting.py`: `sacctmgr` association and QOS limits.
  - `scheduler.py`: `sdiag` and `sprio -w` parsing.

The frontend should prefer `/api/snapshot` for page hydration. The older individual endpoints stay
available for diagnostics and narrow integrations.

## Frontend

- `App.tsx` orchestrates state, filters, and section composition only.
- `hooks/useDashboardSnapshot.ts` owns data loading and error state.
- `lib/dashboard.ts` owns derived dashboard calculations and command helpers.
- `components/` contains focused render surfaces:
  - `Shell.tsx`: sidebar and topbar.
  - `common.tsx`: shared controls and empty/status primitives.
  - `Sections.tsx`: typed section wrappers for nodes and queue.
  - `Nodes.tsx`, `Resources.tsx`, `Queue.tsx`, `Jobs.tsx`, `Tools.tsx`: domain panels.
- `styles.css` only imports domain CSS files from `styles/`.

## File Size Rule

Run the guard before committing architecture changes:

```bash
python scripts/check_loc.py
```

If a file approaches the limit, split by responsibility before adding behavior. The intended split
is vertical by feature or parser domain, not arbitrary chunks.
