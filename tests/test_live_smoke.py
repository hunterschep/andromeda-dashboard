from __future__ import annotations

import os

import pytest

from andromeda_dashboard.config import load_settings
from andromeda_dashboard.ssh import ReadOnlySSHRunner

pytestmark = pytest.mark.skipif(
    os.environ.get("ANDROMEDA_LIVE_TEST") != "1",
    reason="live Andromeda smoke test is opt-in",
)


def test_live_read_only_slurm_probes_complete_within_60_seconds():
    settings = load_settings()
    runner = ReadOnlySSHRunner(settings.ssh)
    commands = [
        'hostname; whoami; pwd; sinfo --version; squeue -u "$USER"',
        "sinfo --json >/dev/null",
        "squeue --json >/dev/null",
        "squeue --start --json >/dev/null",
        "scontrol show nodes --json >/dev/null",
        "scontrol show partition --json >/dev/null",
        "sdiag >/dev/null",
        "sprio -w >/dev/null",
        'sprio -h -o "%.18i|%.12Y|%.12A|%.12F|%.12J|%.12P|%.12Q|%.12T" >/dev/null',
    ]
    for command in commands:
        runner.run(command, timeout_seconds=10)
