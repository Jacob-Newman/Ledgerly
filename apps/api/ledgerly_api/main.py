from __future__ import annotations

import os
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .analyzer import analyze_uploads


STATIC_DIR = Path(
    os.environ.get("LEDGERLY_STATIC_DIR", Path.cwd() / "dist")
).resolve()

app = FastAPI(
    title="Ledgerly API",
    version="0.1.0",
    description=(
        "Stateless CSV normalization and spending analysis. Uploaded bytes are "
        "processed in the request and are never persisted."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:4173",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:4173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "storage": "none"}


@app.post("/api/analyze")
async def analyze(
    files: Annotated[list[UploadFile], File(description="One or more CSV exports")],
    existing: Annotated[str | None, Form()] = None,
    account_types: Annotated[str | None, Form()] = None,
) -> dict:
    if not files:
        raise HTTPException(status_code=400, detail="Choose at least one CSV file.")
    uploads: list[tuple[str, bytes]] = []
    for upload in files:
        if not upload.filename or not upload.filename.lower().endswith(".csv"):
            raise HTTPException(
                status_code=400,
                detail=f"{upload.filename or 'File'} is not a CSV.",
            )
        content = await upload.read()
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(
                status_code=413,
                detail=f"{upload.filename} is larger than the 10 MB session limit.",
            )
        uploads.append((upload.filename, content))
    try:
        return analyze_uploads(uploads, existing, account_types)
    except (ValueError, TypeError, KeyError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


# The Vite development server handles the frontend during local development.
# A production build creates dist/, which FastAPI serves on the same origin.
if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="frontend")
