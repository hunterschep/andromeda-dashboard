from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

from ..models import NodeGpuInventory, QueueGpuRequest


def as_list(value: Any) -> list[Any]:
    value = unwrap_slurm_value(value)
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple | set):
        return list(value)
    if isinstance(value, str):
        if not value or value in {"(null)", "None", "N/A"}:
            return []
        return [part.strip() for part in re.split(r"[, ]+", value) if part.strip()]
    return [value]


def pick(mapping: dict[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        if key in mapping and mapping[key] not in (None, ""):
            return mapping[key]
    return default


def parse_int(value: Any, default: int = 0) -> int:
    value = unwrap_slurm_value(value)
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    match = re.search(r"-?\d+", str(value).replace(",", ""))
    return int(match.group(0)) if match else default


def parse_float(value: Any) -> float | None:
    value = unwrap_slurm_value(value)
    if value is None or value == "":
        return None
    if isinstance(value, int | float):
        return float(value)
    match = re.search(r"-?\d+(?:\.\d+)?", str(value).replace(",", ""))
    return float(match.group(0)) if match else None


def parse_memory_mb(value: Any) -> int | None:
    value = unwrap_slurm_value(value)
    if value is None or value == "":
        return None
    if isinstance(value, int | float):
        return int(value)
    text = str(value).strip()
    if not text or text in {"0n", "(null)", "N/A"}:
        return None
    match = re.match(r"(?P<num>\d+(?:\.\d+)?)(?P<unit>[KMGTP]?)", text, re.IGNORECASE)
    if not match:
        return None
    number = float(match.group("num"))
    unit = match.group("unit").upper()
    factor = {"": 1, "K": 1 / 1024, "M": 1, "G": 1024, "T": 1024 * 1024, "P": 1024**3}[unit]
    return int(number * factor)


def parse_duration_seconds(value: Any) -> int | None:
    if isinstance(value, dict) and "number" in value:
        value = unwrap_slurm_value(value)
        return int(value) * 60 if value is not None else None
    value = unwrap_slurm_value(value)
    if value is None or value == "" or value in {"UNLIMITED", "Partition_Limit", "N/A"}:
        return None
    if isinstance(value, int | float):
        return int(value)
    text = str(value).strip()
    if "-" in text:
        days_text, rest = text.split("-", 1)
        days = parse_int(days_text)
    else:
        days, rest = 0, text
    parts = [parse_int(part) for part in rest.split(":")]
    if len(parts) == 3:
        hours, minutes, seconds = parts
    elif len(parts) == 2:
        hours, minutes, seconds = 0, parts[0], parts[1]
    elif len(parts) == 1:
        hours, minutes, seconds = 0, parts[0], 0
    else:
        return None
    return days * 86400 + hours * 3600 + minutes * 60 + seconds


def parse_datetime(value: Any) -> datetime | None:
    value = unwrap_slurm_value(value)
    if isinstance(value, list):
        value = value[0] if value else None
    if isinstance(value, dict):
        return None
    if value is None or value in {"", 0, "0", "Unknown", "N/A", "(null)"}:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, int | float):
        if value <= 0:
            return None
        return datetime.fromtimestamp(float(value), tz=UTC)
    text = str(value).strip()
    if text.isdigit():
        return parse_datetime(int(text))
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    except ValueError:
        return None


def parse_tres(value: Any) -> dict[str, str]:
    value = unwrap_slurm_value(value)
    if value is None or value == "":
        return {}
    if isinstance(value, dict):
        return {str(key): str(item) for key, item in value.items() if item not in (None, "")}
    result: dict[str, str] = {}
    for token in split_csvish(str(value)):
        if "=" in token:
            key, item = token.split("=", 1)
        elif ":" in token and token.startswith("gres/"):
            key, item = token.rsplit(":", 1)
        else:
            continue
        result[key.strip()] = item.strip()
    return result


def split_csvish(text: str) -> list[str]:
    tokens: list[str] = []
    current: list[str] = []
    depth = 0
    for char in text:
        if char == "(":
            depth += 1
        elif char == ")" and depth:
            depth -= 1
        if char == "," and depth == 0:
            token = "".join(current).strip()
            if token:
                tokens.append(token)
            current = []
        else:
            current.append(char)
    token = "".join(current).strip()
    if token:
        tokens.append(token)
    return tokens


def parse_gpu_requests(*values: Any) -> list[QueueGpuRequest]:
    counts: dict[str, int] = {}
    for value in values:
        for gpu_type, count in _gpu_counts_from_gres(value).items():
            counts[gpu_type] = max(counts.get(gpu_type, 0), count)
        for gpu_type, count in _gpu_counts_from_tres(value).items():
            counts[gpu_type] = max(counts.get(gpu_type, 0), count)
    return [
        QueueGpuRequest(type=gpu_type, count=count)
        for gpu_type, count in sorted(counts.items())
        if count > 0
    ]


def parse_gpu_inventory(
    gres: Any, gres_used: Any = None, alloc_tres: Any = None
) -> list[NodeGpuInventory]:
    totals = _gpu_counts_from_gres(gres)
    used = _gpu_counts_from_gres(gres_used)
    for gpu_type, count in _gpu_counts_from_tres(alloc_tres).items():
        used[gpu_type] = max(used.get(gpu_type, 0), count)

    generic_used = used.pop("generic", 0)
    if generic_used and totals:
        remaining = generic_used
        for gpu_type in sorted(totals):
            assign = min(max(totals[gpu_type] - used.get(gpu_type, 0), 0), remaining)
            used[gpu_type] = used.get(gpu_type, 0) + assign
            remaining -= assign
            if remaining <= 0:
                break
        if remaining:
            used["generic"] = remaining

    gpu_types = sorted(set(totals) | set(used))
    return [
        NodeGpuInventory(
            type=gpu_type,
            total=totals.get(gpu_type, 0),
            used=min(used.get(gpu_type, 0), totals.get(gpu_type, used.get(gpu_type, 0))),
            free=max(totals.get(gpu_type, 0) - used.get(gpu_type, 0), 0),
        )
        for gpu_type in gpu_types
    ]


def normalize_node_state(value: Any) -> tuple[str, list[str]]:
    value = unwrap_slurm_value(value)
    raw = value
    if isinstance(value, list):
        raw = "+".join(str(item) for item in value)
    if isinstance(value, dict):
        raw = pick(value, "current", "state", default="")
    text = str(raw or "UNKNOWN").upper()
    parts = [part for part in re.split(r"[+~# ]+", text) if part]
    state = parts[0] if parts else "UNKNOWN"
    return state, parts[1:]


def unwrap_slurm_value(value: Any) -> Any:
    if isinstance(value, dict):
        if value.get("infinite") is True:
            return None
        if "number" in value:
            if value.get("set") is False:
                return None
            return value.get("number")
        if "current" in value:
            return value.get("current")
        if "name" in value and len(value) == 1:
            return value.get("name")
    return value


def parse_exit_code(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, dict):
        return_code = parse_int(value.get("return_code"), default=0)
        signal = value.get("signal", {})
        signal_code = parse_int(signal.get("id") if isinstance(signal, dict) else signal, default=0)
        return f"{return_code}:{signal_code}"
    return str(value)


def _gpu_counts_from_tres(value: Any) -> dict[str, int]:
    counts: dict[str, int] = {}
    for key, item in parse_tres(value).items():
        if not key.startswith("gres/gpu"):
            continue
        parts = key.split(":")
        gpu_type = parts[1].lower() if len(parts) > 1 and parts[1] else "generic"
        count = parse_int(item)
        if count:
            counts[gpu_type] = counts.get(gpu_type, 0) + count
    return counts


def _gpu_counts_from_gres(value: Any) -> dict[str, int]:
    counts: dict[str, int] = {}
    values = value if isinstance(value, list | tuple | set) else [value]
    for item in values:
        if item is None:
            continue
        if isinstance(item, dict):
            gpu_type = str(pick(item, "type", "name", default="generic")).lower()
            count = parse_int(pick(item, "count", "total", default=0))
            if count:
                counts[gpu_type] = counts.get(gpu_type, 0) + count
            continue
        for raw_token in split_csvish(str(item)):
            token = re.sub(r"\([^)]*\)", "", raw_token.strip())
            token = token.replace("=", ":").removeprefix("gres/")
            if not token or "gpu" not in token:
                continue
            parts = [part for part in token.split(":") if part]
            if not parts or parts[0] != "gpu":
                continue
            if len(parts) >= 3:
                gpu_type, count = parts[1].lower(), parse_int(parts[2])
            elif len(parts) == 2:
                gpu_type, count = (
                    ("generic", parse_int(parts[1]))
                    if parts[1].isdigit()
                    else (parts[1].lower(), 1)
                )
            else:
                gpu_type, count = "generic", 1
            if count:
                counts[gpu_type] = counts.get(gpu_type, 0) + count
    return counts
