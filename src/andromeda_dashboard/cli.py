from __future__ import annotations

from pathlib import Path

import typer
import uvicorn
from rich.console import Console
from rich.table import Table

from .api import create_app
from .config import DEFAULT_CONFIG_PATH, load_settings, write_default_config
from .ssh import ReadOnlySSHRunner, SSHCommandError

app = typer.Typer(help="Local read-only dashboard for Andromeda Slurm resources.")
console = Console()


@app.command("init-config")
def init_config(
    path: Path = typer.Option(DEFAULT_CONFIG_PATH, "--path", help="Config file path."),
    overwrite: bool = typer.Option(False, "--overwrite", help="Overwrite existing config."),
) -> None:
    written = write_default_config(path, overwrite=overwrite)
    console.print(f"Config ready at [bold]{written}[/bold]")


@app.command("config-status")
def config_status(
    path: Path = typer.Option(DEFAULT_CONFIG_PATH, "--path", help="Config file path."),
) -> None:
    settings = load_settings(path)
    status = {
        "config_path": str(settings.config_path),
        "config_exists": str(settings.config_path.exists()),
        "ssh_alias": settings.ssh.alias,
        "bind": f"{settings.server.host}:{settings.server.port}",
        "default_scope": settings.privacy.default_scope,
        "lab_users": str(len(settings.lab.users)),
        "cache_path": str(settings.cache_path),
        "debug": str(settings.privacy.debug),
    }
    table = Table("Field", "Value")
    for key, value in status.items():
        table.add_row(key, value)
    console.print(table)


@app.command("check-ssh")
def check_ssh(
    path: Path = typer.Option(DEFAULT_CONFIG_PATH, "--path", help="Config file path."),
) -> None:
    settings = load_settings(path)
    runner = ReadOnlySSHRunner(settings.ssh)
    command = 'hostname; whoami; pwd; sinfo --version; squeue -u "$USER"'
    try:
        result = runner.run(command, timeout_seconds=settings.ssh.command_timeout_seconds)
    except SSHCommandError as exc:
        console.print(f"SSH check failed: {exc}")
        raise typer.Exit(1) from exc
    console.print(result.stdout.strip())


@app.command("probe")
def probe(
    path: Path = typer.Option(DEFAULT_CONFIG_PATH, "--path", help="Config file path."),
) -> None:
    settings = load_settings(path)
    runner = ReadOnlySSHRunner(settings.ssh)
    commands = [
        'hostname; whoami; pwd; sinfo --version; squeue -u "$USER"',
        "sinfo --json >/dev/null",
        "squeue --json >/dev/null",
        "squeue --start --json >/dev/null",
        "scontrol show nodes --json >/dev/null",
        "scontrol show partition --json >/dev/null",
        "sacct --json -S now-1days -n -X >/dev/null",
        "sdiag >/dev/null",
        "sprio -w >/dev/null",
        "sacctmgr show qos format=Name,MaxJobsPU,MaxSubmitPU,MaxTRESPU -P -n >/dev/null",
        'sacctmgr show assoc where user="$USER" format=Cluster,Account,User,QOS -P -n >/dev/null',
    ]
    for command in commands:
        console.print(f"[bold]$ ssh {settings.ssh.alias!s} {command!r}[/bold]")
        result = runner.run(command, timeout_seconds=settings.ssh.command_timeout_seconds)
        if result.stdout.strip():
            console.print(result.stdout.strip())
    console.print("Probe completed.")


@app.command("serve")
def serve(
    path: Path = typer.Option(DEFAULT_CONFIG_PATH, "--path", help="Config file path."),
) -> None:
    settings = load_settings(path)
    uvicorn.run(
        create_app(settings),
        host=settings.server.host,
        port=settings.server.port,
        log_level="info",
    )
