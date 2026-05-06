from __future__ import annotations

import re

from ..models import AccountLimits, QosLimit
from .common import parse_int, parse_tres


def parse_sacctmgr_qos(text: str) -> list[QosLimit]:
    limits: list[QosLimit] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("-"):
            continue
        parts = [part.strip() for part in line.split("|")]
        if len(parts) >= 4:
            name, max_jobs, max_submit, max_tres = parts[:4]
        else:
            columns = re.split(r"\s{2,}", line)
            if not columns or columns[0].lower() == "name":
                continue
            name = columns[0]
            max_jobs = columns[1] if len(columns) > 1 else ""
            max_submit = columns[2] if len(columns) > 2 else ""
            max_tres = columns[3] if len(columns) > 3 else ""
        if name.lower() == "name":
            continue
        limits.append(
            QosLimit(
                name=name,
                max_jobs_per_user=parse_int(max_jobs) if max_jobs else None,
                max_submit_per_user=parse_int(max_submit) if max_submit else None,
                max_tres_per_user=parse_tres(max_tres.replace(",", ",")) if max_tres else {},
            )
        )
    return limits


def parse_sacctmgr_assoc(text: str) -> AccountLimits:
    rows: list[dict[str, str]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.lower().startswith("cluster|"):
            continue
        parts = [part.strip() for part in line.split("|")]
        if len(parts) >= 4:
            rows.append(
                {"cluster": parts[0], "account": parts[1], "user": parts[2], "qos": parts[3]}
            )
    user = rows[0]["user"] if rows else None
    account = rows[0]["account"] if rows else None
    return AccountLimits(user=user, account=account, raw_rows=rows)
