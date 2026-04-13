import sys
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import settings
from api.routes import router
from api.auth_routes import auth_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ───────────────────────────────────────────────────────────────
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    settings.bm25_dir.mkdir(parents=True, exist_ok=True)

    print("DataRAG v2 starting…")

    # ── PostgreSQL ─────────────────────────────────────────────────────────────
    from db.database import init_db
    try:
        await init_db()
        print(f"  Database  : PostgreSQL connected")
    except RuntimeError as e:
        print(str(e))
        sys.exit(1)

    # Seed default users — each is created only if they don't already exist
    from db.database import get_user_by_username, create_user
    from core.auth import hash_password
    _seed_users = [
        ("admin",  "admin@localhost",  "changeme123", "admin"),
        ("thiru",  "thiru@localhost",  "thiru123",    "user"),
        ("subanu", "subanu@localhost", "subanu123",   "user"),
    ]
    for _uname, _email, _pwd, _role in _seed_users:
        if not await get_user_by_username(_uname):
            await create_user(_uname, _email, hash_password(_pwd), _role)
            if _role == "admin":
                print(f"  Seeded    : {_uname} (admin) — CHANGE PASSWORD before production")
            else:
                print(f"  Seeded    : {_uname} ({_role}), password: {_pwd}")

    # ── Qdrant ─────────────────────────────────────────────────────────────────
    from db.qdrant_client import get_qdrant_client
    try:
        get_qdrant_client().get_collections()
        print(f"  Qdrant    : OK ({settings.qdrant_url})")
    except RuntimeError as e:
        print(str(e))
        sys.exit(1)

    print(f"  Embedding : {settings.embedding_provider}")
    print(f"  LLM       : {settings.llm_provider}")
    print(f"  Reranker  : {'enabled' if settings.enable_reranker else 'disabled'}")
    print(f"  Vision    : {'enabled (' + settings.vision_provider + ')' if settings.enable_vision else 'disabled'}")
    print(f"  Uploads   : {settings.upload_dir}")
    print(f"  Docs      : http://{settings.host}:{settings.port}/docs")

    # Warm up cross-encoder in background
    if settings.enable_reranker:
        from retrieval.reranker import warmup
        asyncio.create_task(warmup())

    # ── Resume any ingestion jobs interrupted by a restart ────────────────────
    from db.database import list_pending_jobs, update_job_status
    from ingestion.pipeline import ingest_file

    pending = await list_pending_jobs()
    if pending:
        print(f"  Resuming {len(pending)} interrupted ingestion job(s)…")
        for job in pending:
            fp = Path(job["file_path"])
            if fp.exists():
                print(f"    → Resuming: {job['file_name']} ({job['file_id']})")
                asyncio.create_task(
                    ingest_file(file_path=fp, file_id=job["file_id"])
                )
            else:
                print(f"    ✗ File missing, skipping: {job['file_name']}")
                await update_job_status(
                    job["file_id"], "failed", "File not found on disk after restart"
                )

    yield

    # ── Shutdown ──────────────────────────────────────────────────────────────
    from db.database import close_db
    await close_db()


app = FastAPI(
    title="DataRAG API",
    description=(
        "Backend for document Q&A (RAG), optional web search, and chart generation. "
        "JSON API base path: `/api`. Interactive docs: `/docs`, `/redoc`."
    ),
    version="2.0.0",
    lifespan=lifespan,
    openapi_tags=[
        {
            "name": "System",
            "description": "Health and API discovery.",
        },
        {
            "name": "Files",
            "description": (
                "Upload CSV / Excel / PDF, list indexed documents, fetch full metadata, "
                "rename the user-visible label, and delete. "
                "`file_name` is always the display name; storage on disk uses `file_id`."
            ),
        },
        {
            "name": "RAG (chat)",
            "description": (
                "Ask questions about an indexed file (`file_id`). "
                "`POST /query` returns the full answer and sources as JSON."
            ),
        },
        {
            "name": "Conversations",
            "description": "Named, persisted chat sessions (ChatGPT-style). Each conversation stores its full message history.",
        },
        {
            "name": "Web search",
            "description": "Search the web and return a synthesized answer as JSON. No `file_id` required.",
        },
        {
            "name": "Charts",
            "description": "Return chart specs (Plotly JSON) and a short intro for financial / economic questions.",
        },
    ],
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")
app.include_router(auth_router, prefix="/api")


@app.get("/", include_in_schema=False)
async def root():
    return {
        "app": "DataRAG",
        "version": "2.0.0",
        "docs": "/docs",
        "health": "/api/health",
    }
