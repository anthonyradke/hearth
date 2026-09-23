"""FastAPI app. Run: uvicorn hearth.main:app --host 127.0.0.1 --port 8010 (config from $HEARTH_CONFIG)."""
from __future__ import annotations
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from . import __version__, config
from .api import router
from .auth import load_token
from .db import DB
from .sampler import Sampler


def create_app(cfg: config.Config | None = None, db: DB | None = None, start: bool = True) -> FastAPI:
    cfg = cfg or config.load()
    db = db or DB(cfg.db)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if start:
            app.state.sampler.start()
        yield
        app.state.sampler.stop()

    app = FastAPI(title="Hearth", version=__version__, lifespan=lifespan, docs_url=None, redoc_url=None)
    app.state.cfg, app.state.db = cfg, db
    app.state.token = load_token(cfg.token_file)
    app.state.sampler = Sampler(cfg, db)
    app.include_router(router)
    return app


def app() -> FastAPI:
    """uvicorn --factory hearth.main:app"""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    return create_app()
