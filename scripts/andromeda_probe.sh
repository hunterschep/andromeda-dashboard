#!/usr/bin/env bash
set -euo pipefail

ssh andromeda 'hostname; whoami; pwd; sinfo --version; squeue -u "$USER"; sinfo --json >/dev/null; squeue --json >/dev/null; squeue --start --json >/dev/null; scontrol show nodes --json >/dev/null; scontrol show partition --json >/dev/null; sacct --json -S now-1days -n -X >/dev/null; sdiag >/dev/null; sprio -w >/dev/null; sprio -h -o "%.18i|%.12Y|%.12A|%.12F|%.12J|%.12P|%.12Q|%.12T" >/dev/null; sacctmgr show qos format=Name,MaxJobsPU,MaxSubmitPU,MaxTRESPU -P -n >/dev/null; sacctmgr show assoc where user="$USER" format=Cluster,Account,User,QOS -P -n >/dev/null; printf "read-only probes ok\n"'
