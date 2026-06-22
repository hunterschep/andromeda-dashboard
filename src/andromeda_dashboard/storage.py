from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .models import CacheMeta


class StorageVolume(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    path: str | None = None
    used_gb: float | None = None
    quota_gb: float | None = None
    percent_used: int | None = None
    files_used: int | None = None
    files_quota: int | None = None
    file_percent_used: int | None = None
    severity: Literal["info", "warning", "critical"] = "info"


class StorageResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    volumes: list[StorageVolume] = Field(default_factory=list)
    raw: str = ""
    cache: list[CacheMeta] = Field(default_factory=list)


def parse_storage_quota(raw: str) -> StorageResponse:
    volumes = [volume for line in raw.splitlines() if (volume := parse_storage_line(line))]
    return StorageResponse(volumes=volumes, raw=raw)


def parse_storage_line(line: str) -> StorageVolume | None:
    text = line.strip()
    if is_storage_noise(text):
        return None
    if "|" in text:
        parts = [part.strip() for part in text.split("|") if part.strip()]
        if len(parts) >= 3:
            return storage_volume(
                parts[0],
                parts[1],
                parts[2],
                parts[3] if len(parts) > 3 else None,
                parts[4] if len(parts) > 4 else None,
            )
    parts = [part.strip() for part in re.split(r"\s*\|\s*|\s{2,}|\t+", text) if part.strip()]
    if len(parts) < 3:
        parts = text.split()
    path_index = next((index for index, part in enumerate(parts) if part.startswith("/")), None)
    if path_index is None:
        return None
    if path_index == 0 and len(parts) >= 3:
        return storage_volume(
            parts[0],
            parts[1],
            parts[2],
            parts[3] if len(parts) > 3 else None,
            parts[4] if len(parts) > 4 else None,
        )
    if len(parts) >= path_index + 5:
        return storage_volume(
            parts[path_index],
            parts[path_index + 1],
            parts[path_index + 2],
            percent_raw=parts[path_index + 4],
        )
    return None


def is_storage_noise(text: str) -> bool:
    if not text or text.startswith("#"):
        return True
    lowered = text.lower()
    if "quota" in lowered and "used" in lowered:
        return True
    return lowered.endswith(":") or lowered.startswith(
        ("pinky output", "login name", "uid=", "user account")
    )


def storage_volume(
    path: str,
    used_raw: str,
    quota_raw: str,
    files_raw: str | None = None,
    files_quota_raw: str | None = None,
    percent_raw: str | None = None,
) -> StorageVolume | None:
    used = parse_size_gb(used_raw)
    quota = parse_size_gb(quota_raw)
    if used is None or quota is None:
        return None
    files_used = parse_count(files_raw) if files_raw else None
    files_quota = parse_count(files_quota_raw) if files_quota_raw else None
    percent = parse_count(percent_raw) if percent_raw else percent_used(used, quota)
    file_percent = percent_used(files_used, files_quota)
    risk_percent = max(
        (value for value in [percent, file_percent] if value is not None),
        default=None,
    )
    return StorageVolume(
        name=name_from_path(path),
        path=path,
        used_gb=round(used, 1),
        quota_gb=round(quota, 1),
        percent_used=percent,
        files_used=files_used,
        files_quota=files_quota,
        file_percent_used=file_percent,
        severity=severity(risk_percent),
    )


def parse_size_gb(value: str) -> float | None:
    match = re.search(r"(\d+(?:\.\d+)?)\s*([KMGTPE]?)", value.replace(",", ""), re.I)
    if not match:
        return None
    factor = {
        "": 1 / 1024,
        "K": 1 / 1024**2,
        "M": 1 / 1024,
        "G": 1,
        "T": 1024,
        "P": 1024**2,
        "E": 1024**3,
    }
    return float(match.group(1)) * factor[match.group(2).upper()]


def parse_count(value: str) -> int | None:
    match = re.search(r"\d+", value.replace(",", ""))
    return int(match.group(0)) if match else None


def percent_used(used: float | int | None, quota: float | int | None) -> int | None:
    if used is None or quota in (None, 0):
        return None
    return round((used / quota) * 100)


def severity(percent: int | None) -> Literal["info", "warning", "critical"]:
    if percent is not None and percent >= 95:
        return "critical"
    if percent is not None and percent >= 85:
        return "warning"
    return "info"


def name_from_path(path: str) -> str:
    lowered = path.lower()
    for name in ("scratch", "projects", "project", "home"):
        if name in lowered:
            return name
    return path.rstrip("/").split("/")[-1] or path
