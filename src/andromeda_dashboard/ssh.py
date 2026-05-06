from __future__ import annotations

import subprocess
import time
from dataclasses import dataclass

from .config import SSHConfig


class SSHCommandError(RuntimeError):
    def __init__(self, message: str, *, returncode: int | None = None, stderr: str = ""):
        super().__init__(message)
        self.returncode = returncode
        self.stderr = stderr


class SSHAuthError(SSHCommandError):
    pass


class SSHTimeoutError(SSHCommandError):
    pass


@dataclass(frozen=True)
class SSHResult:
    command: str
    stdout: str
    stderr: str
    returncode: int
    duration_seconds: float


class ReadOnlySSHRunner:
    """Runs known read-only commands through the configured OpenSSH alias."""

    def __init__(self, config: SSHConfig):
        self.config = config

    def build_args(self, remote_command: str) -> list[str]:
        args = [
            "ssh",
            "-o",
            "BatchMode=yes",
            "-o",
            "PasswordAuthentication=no",
            "-o",
            f"ConnectTimeout={self.config.connect_timeout_seconds}",
        ]
        if self.config.control_master:
            args.extend(
                [
                    "-o",
                    "ControlMaster=auto",
                    "-o",
                    "ControlPersist=120",
                    "-o",
                    f"ControlPath={self.config.control_path}",
                ]
            )
        args.extend([self.config.alias, remote_command])
        return args

    def run(self, remote_command: str, *, timeout_seconds: int | None = None) -> SSHResult:
        timeout = timeout_seconds or self.config.command_timeout_seconds
        start = time.monotonic()
        try:
            completed = subprocess.run(
                self.build_args(remote_command),
                check=False,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired as exc:
            raise SSHTimeoutError(
                f"SSH command timed out after {timeout}s: {remote_command}",
                stderr=(exc.stderr or "") if isinstance(exc.stderr, str) else "",
            ) from exc

        duration = time.monotonic() - start
        result = SSHResult(
            command=remote_command,
            stdout=completed.stdout,
            stderr=completed.stderr,
            returncode=completed.returncode,
            duration_seconds=duration,
        )
        if completed.returncode != 0:
            stderr_lower = completed.stderr.lower()
            message = completed.stderr.strip() or f"ssh exited with {completed.returncode}"
            if "permission denied" in stderr_lower or "publickey" in stderr_lower:
                raise SSHAuthError(
                    message, returncode=completed.returncode, stderr=completed.stderr
                )
            raise SSHCommandError(message, returncode=completed.returncode, stderr=completed.stderr)
        return result
