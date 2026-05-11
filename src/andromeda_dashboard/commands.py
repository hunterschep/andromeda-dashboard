from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CommandSpec:
    key: str
    command: str
    ttl_seconds: int
    json_output: bool = True


NODES = CommandSpec("nodes", "scontrol show nodes --json", 30)
PARTITIONS = CommandSpec("partitions", "scontrol show partition --json", 3600)
SINFO = CommandSpec("sinfo", "sinfo --json", 30)
IDENTITY = CommandSpec("identity", 'printf "%s" "$USER"', 3600, json_output=False)
QUEUE = CommandSpec("queue", "squeue --json", 30)
STARTS = CommandSpec("queue-starts", "squeue --start --json", 30)
SCHEDULER = CommandSpec("scheduler", "sdiag", 60, json_output=False)
SPRIO = CommandSpec("priority-weights", "sprio -w", 60, json_output=False)
SPRIO_JOBS = CommandSpec(
    "priority-jobs",
    'sprio -h -o "%.18i|%.12Y|%.12A|%.12F|%.12J|%.12P|%.12Q|%.12T"',
    60,
    json_output=False,
)
QOS = CommandSpec(
    "qos",
    "sacctmgr show qos format=Name,MaxJobsPU,MaxSubmitPU,MaxTRESPU -P -n",
    3600,
    json_output=False,
)
ASSOC = CommandSpec(
    "assoc",
    'sacctmgr show assoc where user="$USER" format=Cluster,Account,User,QOS -P -n',
    3600,
    json_output=False,
)
STORAGE = CommandSpec("storage", 'acct-chk "$USER"', 300, json_output=False)
