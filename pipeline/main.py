"""PDF Ingestion Pipeline - FastAPI service."""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

from routers import ingest, status

app = FastAPI(title="Constellations PDF Pipeline", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ingest.router)
app.include_router(status.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
