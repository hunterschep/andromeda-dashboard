from __future__ import annotations

import getpass
import os
import tomllib
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

DEFAULT_CONFIG_PATH = Path("~/.config/andromeda-dashboard/config.toml").expanduser()
DEFAULT_CACHE_PATH = Path("~/.cache/andromeda-dashboard/cache.sqlite3").expanduser()


class SSHConfig(BaseModel):
    alias: str = "andromeda"
    connect_timeout_seconds: int = 8
    command_timeout_seconds: int = 25
    control_master: bool = True
    control_path: str = "~/.ssh/andromeda-dashboard-%r@%h:%p"

    @field_validator("alias")
    @classmethod
    def alias_must_be_safe(cls, value: str) -> str:
        if not value or any(char.isspace() for char in value):
            raise ValueError("ssh.alias must be a single OpenSSH host alias")
        return value


class ServerConfig(BaseModel):
    host: str = "127.0.0.1"
    port: int = 8765


class PrivacyConfig(BaseModel):
    debug: bool = False
    default_scope: Literal["mine", "lab", "cluster"] = "mine"


class LabConfig(BaseModel):
    users: list[str] = Field(default_factory=list)


class CacheConfig(BaseModel):
    path: str = str(DEFAULT_CACHE_PATH)


class HistoryConfig(BaseModel):
    default_days: int = 7


class SlurmConfig(BaseModel):
    user: str | None = None


class Settings(BaseModel):
    ssh: SSHConfig = Field(default_factory=SSHConfig)
    server: ServerConfig = Field(default_factory=ServerConfig)
    privacy: PrivacyConfig = Field(default_factory=PrivacyConfig)
    lab: LabConfig = Field(default_factory=LabConfig)
    cache: CacheConfig = Field(default_factory=CacheConfig)
    history: HistoryConfig = Field(default_factory=HistoryConfig)
    slurm: SlurmConfig = Field(default_factory=SlurmConfig)
    config_path: Path = DEFAULT_CONFIG_PATH

    @property
    def current_user(self) -> str:
        return self.slurm.user or os.environ.get("USER") or getpass.getuser()

    @property
    def cache_path(self) -> Path:
        return Path(self.cache.path).expanduser()


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def default_config_dict() -> dict[str, Any]:
    return Settings().model_dump(exclude={"config_path"})


def load_settings(path: Path | None = None) -> Settings:
    config_path = (path or DEFAULT_CONFIG_PATH).expanduser()
    data = default_config_dict()
    if config_path.exists():
        with config_path.open("rb") as handle:
            data = _deep_merge(data, tomllib.load(handle))
    return Settings(**data, config_path=config_path)


def write_default_config(path: Path | None = None, overwrite: bool = False) -> Path:
    config_path = (path or DEFAULT_CONFIG_PATH).expanduser()
    if config_path.exists() and not overwrite:
        return config_path
    config_path.parent.mkdir(parents=True, exist_ok=True)
    text = """[ssh]
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
users = []

[cache]
path = "~/.cache/andromeda-dashboard/cache.sqlite3"

[history]
default_days = 7
"""
    config_path.write_text(text, encoding="utf-8")
    return config_path
