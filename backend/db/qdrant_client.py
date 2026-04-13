"""
Qdrant vector store — Qdrant-only, no ChromaDB fallback, no silent memory fallback.

Production rules:
  - QDRANT_USE_MEMORY=false (default) → must connect to Qdrant Docker or crash.
  - QDRANT_USE_MEMORY=true            → in-memory only, for dev/testing.

Start Qdrant:
  docker run -d -p 6333:6333 -v qdrant_storage:/qdrant/storage qdrant/qdrant
"""

from __future__ import annotations

from qdrant_client import QdrantClient
from qdrant_client.http.exceptions import UnexpectedResponse
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
    MatchValue,
    PointStruct,
    VectorParams,
)

from core.config import settings

_client: QdrantClient | None = None


def get_qdrant_client() -> QdrantClient:
    """
    Return the singleton QdrantClient.

    QDRANT_USE_MEMORY=true  → in-memory (dev only, data lost on restart)
    QDRANT_USE_MEMORY=false → connects to QDRANT_URL, hard-fails if unreachable.
                              No silent fallback — data loss must never be silent.
    """
    global _client
    if _client is not None:
        return _client

    if settings.qdrant_use_memory:
        _client = QdrantClient(":memory:")
        print("[qdrant] Using in-memory store (dev mode)")
        return _client

    try:
        candidate = QdrantClient(url=settings.qdrant_url, timeout=5)
        candidate.get_collections()
        _client = candidate
        print(f"[qdrant] Connected to {settings.qdrant_url}")
        return _client
    except Exception as e:
        raise RuntimeError(
            f"\n\n[qdrant] FATAL: Cannot connect to Qdrant at "
            f"{settings.qdrant_url}\n"
            f"  Error: {e}\n\n"
            f"  Fix: run docker-compose up -d in your project root\n"
            f"  Or set QDRANT_USE_MEMORY=true in .env for dev.\n"
        ) from e


def _collection_name(file_id: str) -> str:
    return f"file_{file_id}"


def get_or_create_collection(file_id: str, vector_size: int = 384) -> None:
    client = get_qdrant_client()
    name = _collection_name(file_id)
    try:
        client.create_collection(
            collection_name=name,
            vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE),
        )
    except (UnexpectedResponse, ValueError, Exception) as e:
        # 409 = already exists — that's fine, nothing to do
        msg = str(e).lower()
        if getattr(e, "status_code", None) == 409 or "already exists" in msg or "409" in msg:
            return
        raise


def add_chunks(
    file_id: str,
    ids: list[str],
    embeddings: list[list[float]],
    documents: list[str],
    metadatas: list[dict],
) -> None:
    client = get_qdrant_client()
    name = _collection_name(file_id)
    points: list[PointStruct] = []
    for str_id, emb, doc, meta in zip(ids, embeddings, documents, metadatas):
        int_id = abs(hash(str_id)) % (10**12)
        payload = {**meta, "document": doc, "_chunk_id": str_id}
        points.append(PointStruct(id=int_id, vector=emb, payload=payload))
    client.upsert(collection_name=name, points=points)


def search_collection(
    file_id: str,
    query_embedding: list[float],
    n_results: int,
    where: dict | None = None,
) -> dict:
    client = get_qdrant_client()
    name = _collection_name(file_id)

    if n_results < 1:
        return {"ids": [[]], "documents": [[]], "metadatas": [[]], "distances": [[]]}

    qdrant_filter = None
    if where:
        qdrant_filter = Filter(
            must=[
                FieldCondition(key=k, match=MatchValue(value=v))
                for k, v in where.items()
            ]
        )

    try:
        resp = client.query_points(
            collection_name=name,
            query=query_embedding,
            limit=n_results,
            query_filter=qdrant_filter,
            with_payload=True,
        )
        hits = resp.points
    except Exception:
        return {"ids": [[]], "documents": [[]], "metadatas": [[]], "distances": [[]]}

    ids_out, docs_out, metas_out, dists_out = [], [], [], []
    for h in hits:
        pl = h.payload or {}
        ids_out.append(pl.get("_chunk_id", str(h.id)))
        docs_out.append(pl.get("document", ""))
        metas_out.append({k: v for k, v in pl.items() if k not in ("document", "_chunk_id")})
        dists_out.append(1.0 - float(h.score or 0.0))

    return {
        "ids":       [ids_out],
        "documents": [docs_out],
        "metadatas": [metas_out],
        "distances": [dists_out],
    }


def get_collection_documents(
    file_id: str,
    where: dict | None = None,
    include: list[str] | None = None,
) -> dict:
    client = get_qdrant_client()
    name = _collection_name(file_id)

    qdrant_filter = None
    if where:
        qdrant_filter = Filter(
            must=[
                FieldCondition(key=k, match=MatchValue(value=v))
                for k, v in where.items()
            ]
        )

    want_docs = include is None or "documents" in include
    want_meta = include is None or "metadatas" in include

    ids_list, documents_list, metadatas_list = [], [], []
    offset = None

    while True:
        try:
            points, next_offset = client.scroll(
                collection_name=name,
                scroll_filter=qdrant_filter,
                limit=256,
                offset=offset,
                with_payload=True,
                with_vectors=False,
            )
        except Exception:
            break

        for p in points:
            pl = p.payload or {}
            ids_list.append(pl.get("_chunk_id", str(p.id)))
            if want_docs:
                documents_list.append(pl.get("document", ""))
            if want_meta:
                metadatas_list.append(
                    {k: v for k, v in pl.items() if k not in ("document", "_chunk_id")}
                )

        if next_offset is None:
            break
        offset = next_offset

    out: dict = {"ids": ids_list}
    if want_docs:
        out["documents"] = documents_list
    if want_meta:
        out["metadatas"] = metadatas_list
    return out


def delete_collection(file_id: str) -> bool:
    client = get_qdrant_client()
    try:
        client.delete_collection(collection_name=_collection_name(file_id))
        return True
    except Exception:
        return False


def scroll_chunks(
    file_id: str,
    limit: int = 50,
    offset: int = 0,
    sheet_name: str | None = None,
) -> dict:
    """
    Return a paginated window of raw chunks stored in Qdrant for a file.
    Used by the debug inspector endpoint.

    Returns {"total": int, "chunks": [{"chunk_id", "text", "metadata"}, ...]}
    """
    client = get_qdrant_client()
    name = _collection_name(file_id)

    qdrant_filter = None
    if sheet_name:
        qdrant_filter = Filter(
            must=[FieldCondition(key="sheet_name", match=MatchValue(value=sheet_name))]
        )

    # Qdrant scroll with integer offset requires walking through pages.
    # For moderate collections (< 50k chunks) this is fast enough for debugging.
    try:
        # Count total matching points
        count_result = client.count(
            collection_name=name,
            count_filter=qdrant_filter,
            exact=True,
        )
        total = int(count_result.count)
    except Exception:
        total = 0

    if total == 0 or offset >= total:
        return {"total": total, "chunks": []}

    # Walk to the right page
    page_offset = None
    skipped = 0
    chunks_out = []

    while True:
        try:
            points, next_offset = client.scroll(
                collection_name=name,
                scroll_filter=qdrant_filter,
                limit=min(limit, 256),
                offset=page_offset,
                with_payload=True,
                with_vectors=False,
            )
        except Exception:
            break

        for p in points:
            if skipped < offset:
                skipped += 1
                continue
            if len(chunks_out) >= limit:
                break
            pl = p.payload or {}
            chunks_out.append({
                "chunk_id": pl.get("_chunk_id", str(p.id)),
                "text": pl.get("document", ""),
                "sheet_name": pl.get("sheet_name", "default"),
                "row_start": pl.get("row_start", 0),
                "row_end": pl.get("row_end", 0),
                "file_name": pl.get("file_name", ""),
                "chunk_type": pl.get("chunk_type", "data"),
            })

        if len(chunks_out) >= limit or next_offset is None:
            break
        page_offset = next_offset

    return {"total": total, "chunks": chunks_out}


def list_collections() -> list[str]:
    client = get_qdrant_client()
    try:
        return [
            c.name for c in client.get_collections().collections
            if c.name.startswith("file_")
        ]
    except Exception:
        return []


def collection_count(file_id: str) -> int:
    client = get_qdrant_client()
    try:
        return int(client.count(collection_name=_collection_name(file_id), exact=True).count)
    except Exception:
        return 0