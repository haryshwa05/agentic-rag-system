"""
Ingestion Pipeline — parse → embed → store (Qdrant + BM25) → record (SQLite).

Job durability: every call to ingest_file() updates the `jobs` table in SQLite
so that on-startup resume can recover any job that was interrupted mid-ingestion.
"""

import asyncio
import uuid
from pathlib import Path
from typing import Callable, Awaitable

from core.config import settings
from core.embedder import get_embedder
from db.qdrant_client import add_chunks, delete_collection, get_or_create_collection
from db.database import (
    upsert_file,
    update_file_complete,
    delete_file_record,
    get_file,
    list_files as db_list_files,
    update_job_status,
    delete_job,
)
from ingestion.parser import parse_file, Chunk
from retrieval import bm25_index

ProgressCallback = Callable[[str, float, str], Awaitable[None]]


async def _parse(file_path: Path, file_id: str) -> list[Chunk]:
    """
    Route to the appropriate parser based on file type.
    PDF: vision parser if vision is enabled, else basic pdfplumber parser.
    CSV/Excel: standard pandas parser.
    The vision parser is async (makes LLM calls); the rest run in a thread.
    """
    suffix = file_path.suffix.lower()

    if suffix == ".pdf" and settings.enable_vision and settings.vision_provider != "none":
        from ingestion.parser_pdf import parse_pdf_with_vision

        return await parse_pdf_with_vision(file_path, file_id)

    return await asyncio.to_thread(parse_file, file_path, file_id)


async def ingest_file(
    file_path: Path,
    file_id: str | None = None,
    *,
    display_name: str | None = None,
    original_filename: str | None = None,
    byte_size: int = 0,
    mime_type: str = "",
    is_private: bool = False,
    public_users: list[str] | None = None,
    on_progress: ProgressCallback | None = None,
) -> dict:
    if file_id is None:
        file_id = str(uuid.uuid4())[:8]

    async def report(stage: str, percent: float, message: str):
        if on_progress:
            await on_progress(stage, percent, message)

    rest = file_path.name
    if file_id and rest.startswith(f"{file_id}_"):
        rest = rest[len(file_id) + 1 :]

    row = await get_file(file_id)
    if display_name is None:
        display_name = (row or {}).get("file_name") or rest
    if original_filename is None:
        original_filename = (row or {}).get("original_filename") or rest

    suffix = file_path.suffix.lower()
    if not byte_size:
        try:
            byte_size = int(file_path.stat().st_size)
        except OSError:
            byte_size = 0

    # Record file + job immediately so both survive a restart
    await upsert_file(
        file_id,
        display_name,
        status="processing",
        original_filename=original_filename,
        byte_size=byte_size,
        extension=suffix,
        mime_type=mime_type,
        is_private=is_private,
        public_users=public_users,
    )
    await update_job_status(file_id, "running")

    try:
        await report("parsing", 5.0, f"Parsing {display_name}…")
        chunks: list[Chunk] = await _parse(file_path, file_id)
        for c in chunks:
            c.metadata["file_name"] = display_name

        if not chunks:
            await report("error", 0.0, "No data found in file.")
            await delete_file_record(file_id)
            await update_job_status(file_id, "failed", "No data found in file.")
            return {
                "file_id": file_id,
                "file_name": display_name,
                "total_chunks": 0,
                "status": "empty",
            }

        await report("parsing", 15.0, f"Parsed {len(chunks)} chunks.")

        # ── Qdrant ────────────────────────────────────────────────────────────
        await report("storing", 18.0, "Creating vector collection…")
        embedder = get_embedder()
        vector_size = embedder.get_dimension()
        get_or_create_collection(file_id, vector_size=vector_size)

        # ── Embed + store in batches ───────────────────────────────────────────
        batch_size = settings.embedding_batch_size
        total_chunks = len(chunks)
        total_batches = (total_chunks + batch_size - 1) // batch_size

        for batch_idx in range(total_batches):
            start = batch_idx * batch_size
            end = min(start + batch_size, total_chunks)
            batch = chunks[start:end]

            progress = 20.0 + (batch_idx / total_batches) * 60.0
            await report("embedding", progress, f"Embedding batch {batch_idx + 1}/{total_batches}…")

            texts = [c.text for c in batch]
            embeddings = await embedder.embed_texts(texts)

            add_chunks(
                file_id,
                ids=[f"{file_id}__{start + i}" for i in range(len(batch))],
                embeddings=embeddings,
                documents=texts,
                metadatas=[c.metadata for c in batch],
            )

        # ── Build BM25 index ───────────────────────────────────────────────────
        await report("indexing", 83.0, "Building keyword search index…")
        data_chunks = [c for c in chunks if c.metadata.get("sheet_name") != "summary"]
        await asyncio.to_thread(
            bm25_index.build_and_save,
            file_id,
            [c.text for c in data_chunks],
            [c.metadata for c in data_chunks],
        )

        # ── Finalise ───────────────────────────────────────────────────────────
        sheets = list(set(c.metadata.get("sheet_name", "default") for c in chunks))
        total_rows = chunks[-1].metadata.get("row_end", 0) - 1 if chunks else 0
        await update_file_complete(file_id, total_chunks, total_rows, sheets)
        await update_job_status(file_id, "complete")

        result = {
            "file_id": file_id,
            "file_name": display_name,
            "total_chunks": total_chunks,
            "total_rows_processed": total_rows,
            "sheets": sheets,
            "status": "complete",
        }
        await report("complete", 100.0, f"Done! {total_chunks} chunks indexed.")
        return result

    except Exception as e:
        await report("error", 0.0, f"Ingestion failed: {e}")
        await delete_file_record(file_id)
        await update_job_status(file_id, "failed", str(e))
        raise


async def delete_file(file_id: str) -> bool:
    bm25_index.delete(file_id)
    await delete_file_record(file_id)
    await delete_job(file_id)
    return delete_collection(file_id)


async def list_files() -> list[dict]:
    return await db_list_files()
