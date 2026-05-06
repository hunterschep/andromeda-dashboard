from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("check_loc", ROOT / "scripts" / "check_loc.py")
assert SPEC and SPEC.loader
check_loc = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check_loc)


def test_maintained_files_stay_small():
    assert check_loc.violations(ROOT, check_loc.DEFAULT_MAX_LOC) == []
