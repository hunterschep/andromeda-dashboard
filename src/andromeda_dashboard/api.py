from __future__ import annotations

from pathlib import Path
from typing import Literal

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import __version__
from .collector import SlurmCollector
from .config import Settings, load_settings
from .models import HealthResponse


def create_app(
    settings: Settings | None = None, collector: SlurmCollector | None = None
) -> FastAPI:
    settings = settings or load_settings()
    collector = collector or SlurmCollector(settings)
    app = FastAPI(title="Andromeda Compute Dashboard", version=__version__)
    app.state.settings = settings
    app.state.collector = collector

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    def health() -> HealthResponse:
        return HealthResponse(version=__version__)

    @app.get("/api/config/status")
    def config_status():
        return app.state.collector.config_status()

    @app.get("/api/resources")
    def resources():
        return app.state.collector.get_resources()

    @app.get("/api/partitions")
    def partitions():
        return app.state.collector.get_partitions()

    @app.get("/api/queue")
    def queue(scope: Literal["mine", "lab", "cluster"] = Query("mine")):
        return app.state.collector.get_queue(scope=scope)

    @app.get("/api/jobs/mine")
    def my_jobs():
        return app.state.collector.get_queue(scope="mine")

    @app.get("/api/history")
    def history(days: int = Query(7)):
        return app.state.collector.get_history(days=days)

    @app.get("/api/insights")
    def insights():
        return app.state.collector.get_insights()

    dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    if dist.exists():
        app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")

    return app


app = create_app()
