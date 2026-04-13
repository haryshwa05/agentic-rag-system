"""
Async PostgreSQL persistence — file metadata + durable ingestion job queue.

Connection pooling: asyncpg manages a pool of connections (min_size=2,
max_size=10). Each DB operation acquires one connection, executes, and
returns it to the pool. This keeps concurrency manageable without
over-subscribing PostgreSQL.

All tables are created at startup with CREATE TABLE IF NOT EXISTS —
safe to call on every restart; idempotent by design.
"""

import datetime
import json
import uuid as _uuid
from typing import Optional

import asyncpg

from core.config import settings

_pool: asyncpg.Pool | None = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _check_pool() -> None:
    if _pool is None:
        raise RuntimeError("init_db() must be called before any database operation.")


def _record_to_dict(record: asyncpg.Record) -> dict:
    """Convert an asyncpg Record to a plain Python dict."""
    return dict(record)


def _normalize_file_row(record: asyncpg.Record) -> dict:
    """Convert asyncpg Record to dict, parse JSON fields, coerce types."""
    out = _record_to_dict(record)

    for json_field in ("sheets", "public_users"):
        raw = out.get(json_field)
        if isinstance(raw, str):
            try:
                out[json_field] = json.loads(raw or "[]")
            except json.JSONDecodeError:
                out[json_field] = []
        if out.get(json_field) is None:
            out[json_field] = []

    out["is_private"] = bool(out.get("is_private", False))

    for key in ("total_chunks", "total_rows", "byte_size"):
        if key in out and out[key] is not None:
            try:
                out[key] = int(out[key])
            except (TypeError, ValueError):
                out[key] = 0

    # Convert PostgreSQL timestamps to ISO strings for JSON serialisation
    for ts_key in ("created_at", "updated_at"):
        val = out.get(ts_key)
        if isinstance(val, datetime.datetime):
            out[ts_key] = val.isoformat()

    return out


def _ts_to_iso(d: dict, *keys: str) -> dict:
    """In-place convert datetime values to isoformat strings."""
    for key in keys:
        val = d.get(key)
        if isinstance(val, datetime.datetime):
            d[key] = val.isoformat()
    return d


# ── Initialisation ────────────────────────────────────────────────────────────

async def init_db() -> None:
    """
    Create the asyncpg connection pool and all tables.
    Reads DATABASE_URL from settings.database_url.
    Hard-fails with a helpful RuntimeError if PostgreSQL is unreachable.
    """
    global _pool

    try:
        _pool = await asyncpg.create_pool(
            settings.database_url,
            min_size=2,
            max_size=10,
            command_timeout=30,
        )
    except Exception as e:
        raise RuntimeError(
            f"\n\n[postgres] FATAL: Cannot connect to PostgreSQL.\n"
            f"  URL   : {settings.database_url}\n"
            f"  Error : {e}\n\n"
            f"  Fix   : docker-compose up -d   (starts PostgreSQL + Qdrant)\n"
            f"  Or check DATABASE_URL in backend/.env\n"
        ) from e

    async with _pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS files (
                file_id           TEXT PRIMARY KEY,
                file_name         TEXT NOT NULL,
                original_filename TEXT,
                extension         TEXT DEFAULT '',
                byte_size         INTEGER DEFAULT 0,
                mime_type         TEXT DEFAULT '',
                total_chunks      INTEGER DEFAULT 0,
                total_rows        INTEGER DEFAULT 0,
                sheets            TEXT DEFAULT '[]',
                status            TEXT DEFAULT 'processing',
                is_private        BOOLEAN DEFAULT FALSE,
                public_users      TEXT DEFAULT '[]',
                created_at        TIMESTAMP DEFAULT NOW(),
                updated_at        TIMESTAMP DEFAULT NOW()
            )
        """)

        await conn.execute("""
            CREATE TABLE IF NOT EXISTS jobs (
                file_id    TEXT PRIMARY KEY,
                file_name  TEXT NOT NULL,
                file_path  TEXT NOT NULL,
                status     TEXT DEFAULT 'pending',
                error      TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """)

        await conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                user_id          TEXT PRIMARY KEY,
                username         TEXT NOT NULL UNIQUE,
                email            TEXT NOT NULL UNIQUE,
                hashed_password  TEXT NOT NULL,
                role             TEXT DEFAULT 'user',
                is_active        BOOLEAN DEFAULT TRUE,
                created_at       TIMESTAMP DEFAULT NOW(),
                updated_at       TIMESTAMP DEFAULT NOW()
            )
        """)

        await conn.execute("""
            CREATE TABLE IF NOT EXISTS agents (
                agent_id    TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                description TEXT DEFAULT '',
                image       TEXT DEFAULT '',
                status      TEXT DEFAULT 'Development',
                tags        TEXT DEFAULT '[]',
                created_by  TEXT DEFAULT '',
                is_private  BOOLEAN DEFAULT FALSE,
                model       TEXT DEFAULT '',
                created_at  TIMESTAMP DEFAULT NOW(),
                updated_at  TIMESTAMP DEFAULT NOW()
            )
        """)

        await conn.execute("""
            CREATE TABLE IF NOT EXISTS agent_members (
                agent_id  TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
                user_id   TEXT NOT NULL REFERENCES users(user_id)   ON DELETE CASCADE,
                added_at  TIMESTAMP DEFAULT NOW(),
                PRIMARY KEY (agent_id, user_id)
            )
        """)

        await conn.execute("""
            CREATE TABLE IF NOT EXISTS agent_files (
                agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
                file_id  TEXT NOT NULL REFERENCES files(file_id)  ON DELETE CASCADE,
                added_at TIMESTAMP DEFAULT NOW(),
                PRIMARY KEY (agent_id, file_id)
            )
        """)

        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_agent_files_agent
                ON agent_files(agent_id)
        """)

        await conn.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                conversation_id TEXT PRIMARY KEY,
                file_id         TEXT,
                title           TEXT DEFAULT 'New conversation',
                history_summary TEXT DEFAULT '',
                created_at      TIMESTAMP DEFAULT NOW(),
                updated_at      TIMESTAMP DEFAULT NOW()
            )
        """)

        await conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                message_id      TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL
                    REFERENCES conversations(conversation_id) ON DELETE CASCADE,
                role            TEXT NOT NULL,
                content         TEXT NOT NULL,
                created_at      TIMESTAMP DEFAULT NOW()
            )
        """)

        # Migrations — run before any indexes that depend on migrated columns
        await conn.execute("""
            DO $$ BEGIN
                ALTER TABLE conversations ADD COLUMN agent_id TEXT;
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$;
        """)

        await conn.execute("""
            ALTER TABLE agents
                ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES users(user_id)
        """)

        await conn.execute("""
            ALTER TABLE conversations
                ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(user_id)
        """)

        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_messages_conversation
                ON messages(conversation_id, created_at ASC)
        """)

        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_conversations_file
                ON conversations(file_id, updated_at DESC)
        """)

        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_conversations_agent
                ON conversations(agent_id, updated_at DESC)
        """)

        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)
        """)

        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)
        """)

        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_agent_members_user
                ON agent_members(user_id)
        """)


async def close_db() -> None:
    """Close the connection pool gracefully on application shutdown."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


# ── Files table ───────────────────────────────────────────────────────────────

async def upsert_file(
    file_id: str,
    file_name: str,
    status: str = "processing",
    *,
    original_filename: Optional[str] = None,
    byte_size: int = 0,
    extension: str = "",
    mime_type: str = "",
    is_private: bool = False,
    public_users: Optional[list] = None,
) -> None:
    _check_pool()
    async with _pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO files (
                file_id, file_name, status, original_filename,
                byte_size, extension, mime_type,
                is_private, public_users, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
            ON CONFLICT (file_id) DO UPDATE SET
                file_name         = EXCLUDED.file_name,
                status            = EXCLUDED.status,
                original_filename = EXCLUDED.original_filename,
                byte_size         = EXCLUDED.byte_size,
                extension         = EXCLUDED.extension,
                mime_type         = EXCLUDED.mime_type,
                is_private        = EXCLUDED.is_private,
                public_users      = EXCLUDED.public_users,
                updated_at        = NOW()
            """,
            file_id,
            file_name,
            status,
            original_filename or file_name,
            byte_size,
            extension,
            mime_type,
            is_private,
            json.dumps(public_users or []),
        )


async def update_file_complete(
    file_id: str, total_chunks: int, total_rows: int, sheets: list
) -> None:
    _check_pool()
    async with _pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE files
            SET total_chunks = $1,
                total_rows   = $2,
                sheets       = $3,
                status       = 'complete',
                updated_at   = NOW()
            WHERE file_id = $4
            """,
            total_chunks,
            total_rows,
            json.dumps(sheets),
            file_id,
        )


async def update_file_display_name(file_id: str, display_name: str) -> bool:
    _check_pool()
    async with _pool.acquire() as conn:
        tag = await conn.execute(
            """
            UPDATE files SET file_name = $1, updated_at = NOW()
            WHERE file_id = $2
            """,
            display_name,
            file_id,
        )
        return int(tag.split()[-1]) > 0


async def delete_file_record(file_id: str) -> None:
    _check_pool()
    async with _pool.acquire() as conn:
        await conn.execute("DELETE FROM files WHERE file_id = $1", file_id)


async def list_files() -> list[dict]:
    _check_pool()
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM files WHERE status = 'complete' ORDER BY created_at DESC"
        )
        return [_normalize_file_row(r) for r in rows]


async def get_file(file_id: str) -> Optional[dict]:
    _check_pool()
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM files WHERE file_id = $1", file_id
        )
        return _normalize_file_row(row) if row else None


# ── Jobs table (durable ingestion queue) ──────────────────────────────────────

async def upsert_job(file_id: str, file_name: str, file_path: str) -> None:
    _check_pool()
    async with _pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO jobs (file_id, file_name, file_path, status, updated_at)
            VALUES ($1, $2, $3, 'pending', NOW())
            ON CONFLICT (file_id) DO UPDATE SET
                file_name  = EXCLUDED.file_name,
                file_path  = EXCLUDED.file_path,
                status     = 'pending',
                error      = NULL,
                updated_at = NOW()
            """,
            file_id,
            file_name,
            file_path,
        )


async def update_job_status(
    file_id: str, status: str, error: Optional[str] = None
) -> None:
    _check_pool()
    async with _pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE jobs SET status = $1, error = $2, updated_at = NOW()
            WHERE file_id = $3
            """,
            status,
            error,
            file_id,
        )


async def list_pending_jobs() -> list[dict]:
    _check_pool()
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT * FROM jobs
            WHERE status IN ('pending', 'running')
            ORDER BY created_at ASC
            """
        )
        result = []
        for r in rows:
            d = _record_to_dict(r)
            _ts_to_iso(d, "created_at", "updated_at")
            result.append(d)
        return result


async def delete_job(file_id: str) -> None:
    _check_pool()
    async with _pool.acquire() as conn:
        await conn.execute("DELETE FROM jobs WHERE file_id = $1", file_id)


# ── Conversations ─────────────────────────────────────────────────────────────

async def create_conversation(
    file_id: Optional[str],
    title: str = "New conversation",
    user_id: Optional[str] = None,
) -> dict:
    _check_pool()
    conversation_id = str(_uuid.uuid4())
    async with _pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO conversations (conversation_id, file_id, title, user_id)
            VALUES ($1, $2, $3, $4)
            """,
            conversation_id,
            file_id,
            title,
            user_id,
        )
    return {
        "conversation_id": conversation_id,
        "file_id": file_id,
        "agent_id": None,
        "title": title,
        "message_count": 0,
        "created_at": None,
        "updated_at": None,
    }


async def list_conversations(
    file_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> list[dict]:
    _check_pool()
    async with _pool.acquire() as conn:
        conditions = []
        params: list = []
        if file_id:
            params.append(file_id)
            conditions.append(f"c.file_id = ${len(params)}")
        if user_id:
            params.append(user_id)
            conditions.append(f"(c.user_id IS NULL OR c.user_id = ${len(params)})")
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        rows = await conn.fetch(
            f"""
            SELECT c.*, COUNT(m.message_id)::int AS message_count
            FROM conversations c
            LEFT JOIN messages m ON c.conversation_id = m.conversation_id
            {where}
            GROUP BY c.conversation_id
            ORDER BY c.updated_at DESC
            """,
            *params,
        )
        result = []
        for r in rows:
            d = _record_to_dict(r)
            _ts_to_iso(d, "created_at", "updated_at")
            result.append(d)
        return result


async def get_conversation(conversation_id: str) -> Optional[dict]:
    _check_pool()
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM conversations WHERE conversation_id = $1",
            conversation_id,
        )
        if not row:
            return None
        d = _record_to_dict(row)
        _ts_to_iso(d, "created_at", "updated_at")
        return d


async def update_conversation_title(conversation_id: str, title: str) -> bool:
    _check_pool()
    async with _pool.acquire() as conn:
        tag = await conn.execute(
            """
            UPDATE conversations SET title = $1, updated_at = NOW()
            WHERE conversation_id = $2
            """,
            title[:120],
            conversation_id,
        )
        return int(tag.split()[-1]) > 0


async def delete_conversation(conversation_id: str) -> bool:
    """Messages are cascade-deleted via the FK constraint."""
    _check_pool()
    async with _pool.acquire() as conn:
        tag = await conn.execute(
            "DELETE FROM conversations WHERE conversation_id = $1",
            conversation_id,
        )
        return int(tag.split()[-1]) > 0


async def get_history_summary(conversation_id: str) -> str:
    """Return the compressed history summary for a conversation (empty string if none)."""
    _check_pool()
    async with _pool.acquire() as conn:
        val = await conn.fetchval(
            "SELECT history_summary FROM conversations WHERE conversation_id = $1",
            conversation_id,
        )
        return val or ""


async def update_history_summary(conversation_id: str, summary: str) -> None:
    """Persist an updated history summary for a conversation."""
    _check_pool()
    async with _pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE conversations
            SET history_summary = $1, updated_at = NOW()
            WHERE conversation_id = $2
            """,
            summary,
            conversation_id,
        )


# ── Messages ──────────────────────────────────────────────────────────────────

async def save_message(conversation_id: str, role: str, content: str) -> str:
    """
    Insert a message and bump the conversation's updated_at in one transaction.
    """
    _check_pool()
    message_id = str(_uuid.uuid4())
    async with _pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO messages (message_id, conversation_id, role, content)
                VALUES ($1, $2, $3, $4)
                """,
                message_id,
                conversation_id,
                role,
                content,
            )
            await conn.execute(
                """
                UPDATE conversations SET updated_at = NOW()
                WHERE conversation_id = $1
                """,
                conversation_id,
            )
    return message_id


async def get_messages(conversation_id: str) -> list[dict]:
    _check_pool()
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT * FROM messages WHERE conversation_id = $1
            ORDER BY created_at ASC
            """,
            conversation_id,
        )
        result = []
        for r in rows:
            d = _record_to_dict(r)
            _ts_to_iso(d, "created_at")
            result.append(d)
        return result


async def count_messages(conversation_id: str) -> int:
    _check_pool()
    async with _pool.acquire() as conn:
        val = await conn.fetchval(
            "SELECT COUNT(*) FROM messages WHERE conversation_id = $1",
            conversation_id,
        )
        return int(val) if val is not None else 0


# ── Agents ────────────────────────────────────────────────────────────────────

def _normalize_agent_row(record: asyncpg.Record, file_ids: list[str] | None = None) -> dict:
    out = _record_to_dict(record)
    raw_tags = out.get("tags")
    if isinstance(raw_tags, str):
        try:
            out["tags"] = json.loads(raw_tags or "[]")
        except json.JSONDecodeError:
            out["tags"] = []
    if out.get("tags") is None:
        out["tags"] = []
    out["is_private"] = bool(out.get("is_private", False))
    out["file_ids"] = file_ids or []
    _ts_to_iso(out, "created_at", "updated_at")
    return out


async def create_agent(
    name: str,
    description: str = "",
    image: str = "",
    status: str = "Development",
    tags: Optional[list] = None,
    created_by: str = "",
    is_private: bool = False,
    model: str = "",
    file_ids: Optional[list[str]] = None,
) -> dict:
    _check_pool()
    agent_id = str(_uuid.uuid4())[:12]
    async with _pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO agents
                    (agent_id, name, description, image, status,
                     tags, created_by, is_private, model)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                """,
                agent_id, name, description, image, status,
                json.dumps(tags or []), created_by, is_private, model,
            )
            if file_ids:
                for fid in file_ids:
                    await conn.execute(
                        "INSERT INTO agent_files (agent_id, file_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
                        agent_id, fid,
                    )
    return await get_agent(agent_id)


async def list_agents() -> list[dict]:
    _check_pool()
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT a.*,
                   COUNT(DISTINCT af.file_id)::int     AS file_count,
                   COUNT(DISTINCT c.conversation_id)::int AS conversation_count
            FROM agents a
            LEFT JOIN agent_files   af ON af.agent_id = a.agent_id
            LEFT JOIN conversations c  ON c.agent_id  = a.agent_id
            GROUP BY a.agent_id
            ORDER BY a.updated_at DESC
            """
        )
        result = []
        for r in rows:
            agent_id = r["agent_id"]
            file_rows = await conn.fetch(
                "SELECT file_id FROM agent_files WHERE agent_id = $1", agent_id
            )
            d = _normalize_agent_row(r, [fr["file_id"] for fr in file_rows])
            d["file_count"] = r["file_count"]
            d["conversation_count"] = r["conversation_count"]
            result.append(d)
        return result


async def get_agent(agent_id: str) -> Optional[dict]:
    _check_pool()
    async with _pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM agents WHERE agent_id = $1", agent_id)
        if not row:
            return None
        file_rows = await conn.fetch(
            "SELECT file_id FROM agent_files WHERE agent_id = $1", agent_id
        )
        d = _normalize_agent_row(row, [r["file_id"] for r in file_rows])
        count_row = await conn.fetchrow(
            "SELECT COUNT(*)::int AS c FROM conversations WHERE agent_id = $1", agent_id
        )
        d["conversation_count"] = count_row["c"] if count_row else 0
        d["file_count"] = len(d["file_ids"])
        return d


async def update_agent(
    agent_id: str,
    *,
    name: Optional[str] = None,
    description: Optional[str] = None,
    image: Optional[str] = None,
    status: Optional[str] = None,
    tags: Optional[list] = None,
    created_by: Optional[str] = None,
    is_private: Optional[bool] = None,
    model: Optional[str] = None,
) -> Optional[dict]:
    _check_pool()
    fields, values = [], []
    mapping = {
        "name": name, "description": description, "image": image,
        "status": status, "created_by": created_by,
        "is_private": is_private, "model": model,
    }
    for col, val in mapping.items():
        if val is not None:
            fields.append(f"{col} = ${len(values)+1}")
            values.append(val)
    if tags is not None:
        fields.append(f"tags = ${len(values)+1}")
        values.append(json.dumps(tags))
    if not fields:
        return await get_agent(agent_id)
    fields.append(f"updated_at = NOW()")
    values.append(agent_id)
    async with _pool.acquire() as conn:
        await conn.execute(
            f"UPDATE agents SET {', '.join(fields)} WHERE agent_id = ${len(values)}",
            *values,
        )
    return await get_agent(agent_id)


async def delete_agent(agent_id: str) -> bool:
    _check_pool()
    async with _pool.acquire() as conn:
        tag = await conn.execute("DELETE FROM agents WHERE agent_id = $1", agent_id)
        return int(tag.split()[-1]) > 0


async def add_files_to_agent(agent_id: str, file_ids: list[str]) -> None:
    _check_pool()
    async with _pool.acquire() as conn:
        for fid in file_ids:
            await conn.execute(
                "INSERT INTO agent_files (agent_id, file_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
                agent_id, fid,
            )
        await conn.execute(
            "UPDATE agents SET updated_at = NOW() WHERE agent_id = $1", agent_id
        )


async def remove_file_from_agent(agent_id: str, file_id: str) -> bool:
    _check_pool()
    async with _pool.acquire() as conn:
        tag = await conn.execute(
            "DELETE FROM agent_files WHERE agent_id = $1 AND file_id = $2",
            agent_id, file_id,
        )
        return int(tag.split()[-1]) > 0


async def list_agents_for_user(user_id: str) -> list[dict]:
    """Return agents the user can access (member, owner, or public), enriched."""
    _check_pool()
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT a.*,
                   COUNT(DISTINCT af.file_id)::int          AS file_count,
                   COUNT(DISTINCT c.conversation_id)::int   AS conversation_count
            FROM agents a
            LEFT JOIN agent_files   af ON af.agent_id = a.agent_id
            LEFT JOIN conversations c  ON c.agent_id  = a.agent_id
            LEFT JOIN agent_members m  ON a.agent_id  = m.agent_id AND m.user_id = $1
            WHERE a.owner_id = $1
               OR m.user_id  IS NOT NULL
               OR a.is_private = FALSE
            GROUP BY a.agent_id
            ORDER BY a.updated_at DESC
            """,
            user_id,
        )
        result = []
        for r in rows:
            agent_id = r["agent_id"]
            file_rows = await conn.fetch(
                "SELECT file_id FROM agent_files WHERE agent_id = $1", agent_id
            )
            d = _normalize_agent_row(r, [fr["file_id"] for fr in file_rows])
            d["file_count"] = r["file_count"]
            d["conversation_count"] = r["conversation_count"]
            result.append(d)
        return result


async def user_can_access_agent(user_id: str, agent_id: str) -> bool:
    """True if user is the owner, a member, or the agent is public."""
    async with _pool.acquire() as conn:
        val = await conn.fetchval(
            """
            SELECT 1 FROM agents a
            LEFT JOIN agent_members m
              ON a.agent_id = m.agent_id AND m.user_id = $1
            WHERE a.agent_id = $2
              AND (a.owner_id = $1 OR m.user_id IS NOT NULL OR a.is_private = FALSE)
            LIMIT 1
            """,
            user_id, agent_id,
        )
    return val is not None


async def get_agent_file_ids(agent_id: str) -> list[str]:
    _check_pool()
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT file_id FROM agent_files WHERE agent_id = $1", agent_id
        )
        return [r["file_id"] for r in rows]


async def create_agent_conversation(
    agent_id: str,
    title: str = "New conversation",
    user_id: Optional[str] = None,
) -> dict:
    _check_pool()
    conversation_id = str(_uuid.uuid4())
    async with _pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO conversations (conversation_id, agent_id, title, user_id)
            VALUES ($1, $2, $3, $4)
            """,
            conversation_id, agent_id, title, user_id,
        )
    return {
        "conversation_id": conversation_id,
        "agent_id": agent_id,
        "file_id": None,
        "title": title,
        "message_count": 0,
        "created_at": None,
        "updated_at": None,
    }


async def list_agent_conversations(
    agent_id: str,
    user_id: Optional[str] = None,
) -> list[dict]:
    _check_pool()
    async with _pool.acquire() as conn:
        if user_id:
            rows = await conn.fetch(
                """
                SELECT c.*, COUNT(m.message_id)::int AS message_count
                FROM conversations c
                LEFT JOIN messages m ON c.conversation_id = m.conversation_id
                WHERE c.agent_id = $1
                  AND (c.user_id IS NULL OR c.user_id = $2)
                GROUP BY c.conversation_id
                ORDER BY c.updated_at DESC
                """,
                agent_id, user_id,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT c.*, COUNT(m.message_id)::int AS message_count
                FROM conversations c
                LEFT JOIN messages m ON c.conversation_id = m.conversation_id
                WHERE c.agent_id = $1
                GROUP BY c.conversation_id
                ORDER BY c.updated_at DESC
                """,
                agent_id,
            )
        result = []
        for r in rows:
            d = _record_to_dict(r)
            _ts_to_iso(d, "created_at", "updated_at")
            result.append(d)
        return result


# ── Users ─────────────────────────────────────────────────────────────────────

async def create_user(
    username: str,
    email: str,
    hashed_password: str,
    role: str = "user",
) -> dict:
    _check_pool()
    user_id = str(_uuid.uuid4())
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO users (user_id, username, email, hashed_password, role)
            VALUES ($1, $2, $3, $4, $5) RETURNING *
            """,
            user_id, username, email, hashed_password, role,
        )
    d = _record_to_dict(row)
    _ts_to_iso(d, "created_at", "updated_at")
    return d


async def get_user_by_username(username: str) -> Optional[dict]:
    _check_pool()
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM users WHERE username = $1", username
        )
    if not row:
        return None
    d = _record_to_dict(row)
    _ts_to_iso(d, "created_at", "updated_at")
    return d


async def get_user_by_id(user_id: str) -> Optional[dict]:
    _check_pool()
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM users WHERE user_id = $1", user_id
        )
    if not row:
        return None
    d = _record_to_dict(row)
    _ts_to_iso(d, "created_at", "updated_at")
    return d


async def list_users() -> list[dict]:
    _check_pool()
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT user_id, username, email, role, is_active, created_at
            FROM users ORDER BY created_at DESC
            """
        )
    result = []
    for r in rows:
        d = _record_to_dict(r)
        _ts_to_iso(d, "created_at")
        result.append(d)
    return result


async def update_user_active(user_id: str, is_active: bool) -> bool:
    _check_pool()
    async with _pool.acquire() as conn:
        tag = await conn.execute(
            "UPDATE users SET is_active = $1, updated_at = NOW() WHERE user_id = $2",
            is_active, user_id,
        )
    return int(tag.split()[-1]) > 0


async def delete_user(user_id: str) -> bool:
    _check_pool()
    async with _pool.acquire() as conn:
        tag = await conn.execute(
            "DELETE FROM users WHERE user_id = $1", user_id
        )
    return int(tag.split()[-1]) > 0


# ── Agent members ─────────────────────────────────────────────────────────────

async def add_agent_member(agent_id: str, user_id: str) -> None:
    _check_pool()
    async with _pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO agent_members (agent_id, user_id)
            VALUES ($1, $2) ON CONFLICT DO NOTHING
            """,
            agent_id, user_id,
        )


async def remove_agent_member(agent_id: str, user_id: str) -> bool:
    _check_pool()
    async with _pool.acquire() as conn:
        tag = await conn.execute(
            "DELETE FROM agent_members WHERE agent_id = $1 AND user_id = $2",
            agent_id, user_id,
        )
    return int(tag.split()[-1]) > 0


async def list_agent_members(agent_id: str) -> list[dict]:
    _check_pool()
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT u.user_id, u.username, u.email, u.role, m.added_at
            FROM agent_members m
            JOIN users u ON m.user_id = u.user_id
            WHERE m.agent_id = $1
            ORDER BY m.added_at DESC
            """,
            agent_id,
        )
    result = []
    for r in rows:
        d = _record_to_dict(r)
        _ts_to_iso(d, "added_at")
        result.append(d)
    return result
