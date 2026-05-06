from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .models import CacheMeta


@dataclass(frozen=True)
class CachedPayload:
    key: str
    payload: Any
    captured_at: datetime | None
    ttl_seconds: int
    is_stale: bool
    errors: list[str]

    @property
    def meta(self) -> CacheMeta:
        return CacheMeta(
            key=self.key,
            captured_at=self.captured_at,
            ttl_seconds=self.ttl_seconds,
            is_stale=self.is_stale,
            errors=self.errors,
        )


class SQLiteCache:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    def _init_db(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS cache_entries (
                    key TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    captured_at REAL NOT NULL,
                    expires_at REAL NOT NULL
                )
                """
            )
            connection.commit()

    def get(
        self, key: str, ttl_seconds: int, *, include_stale: bool = True
    ) -> CachedPayload | None:
        now = time.time()
        with self._connect() as connection:
            row = connection.execute(
                "SELECT key, payload, captured_at, expires_at FROM cache_entries WHERE key = ?",
                (key,),
            ).fetchone()
        if row is None:
            return None
        is_stale = row["expires_at"] < now
        if is_stale and not include_stale:
            return None
        payload = json.loads(row["payload"])
        captured_at = datetime.fromtimestamp(float(row["captured_at"]), tz=UTC)
        return CachedPayload(
            key=row["key"],
            payload=payload,
            captured_at=captured_at,
            ttl_seconds=ttl_seconds,
            is_stale=is_stale,
            errors=[],
        )

    def set(self, key: str, payload: Any, ttl_seconds: int) -> CachedPayload:
        now = time.time()
        serialized = json.dumps(payload, separators=(",", ":"), sort_keys=True)
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO cache_entries (key, payload, captured_at, expires_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    payload = excluded.payload,
                    captured_at = excluded.captured_at,
                    expires_at = excluded.expires_at
                """,
                (key, serialized, now, now + ttl_seconds),
            )
            connection.commit()
        return CachedPayload(
            key=key,
            payload=payload,
            captured_at=datetime.fromtimestamp(now, tz=UTC),
            ttl_seconds=ttl_seconds,
            is_stale=False,
            errors=[],
        )
