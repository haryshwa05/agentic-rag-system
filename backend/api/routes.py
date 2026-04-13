"""
API Routes — upload, query, file management.

OpenAPI tags group endpoints for /docs (Swagger UI) and ReDoc.
"""

from __future__ import annotations

import asyncio
import json
import re
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse

from core.auth import get_current_user, require_admin
from core.config import settings
from core.rate_limit import rate_limiter
from db.database import (
    get_file, update_file_display_name,
    create_agent, list_agents, get_agent, update_agent, delete_agent,
    add_files_to_agent, remove_file_from_agent, get_agent_file_ids,
    create_agent_conversation, list_agent_conversations,
    list_agents_for_user, user_can_access_agent,
)
from generation.chart_generator import complete_chart
from generation.generator import generate_answer_full
from generation.web_searcher import complete_web_search
from ingestion.pipeline import delete_file, ingest_file, list_files
from models.schemas import (
    AgentConversationCreate,
    AgentCreate,
    AgentFilesUpdate,
    AgentInfo,
    AgentListResponse,
    AgentMemberAdd,
    AgentUpdate,
    ChartResponse,
    ChunkInfo,
    ChunkListResponse,
    ConversationCreate,
    ConversationInfo,
    ConversationListResponse,
    ConversationMessagesResponse,
    DeleteResponse,
    FileListResponse,
    FileMetadata,
    MessageInfo,
    QueryRequest,
    QueryResponse,
    RenameFileRequest,
    RenameFileResponse,
    WebSearchResponse,
)

router = APIRouter()

ALLOWED_EXTENSIONS = {".csv", ".xlsx", ".xls", ".pdf"}
_CHUNK = 1 << 16  # 64 KB read chunks

_DISPLAY_BAD = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _safe_original_filename(name: str) -> str:
    base = Path(name).name.replace("..", "").strip()
    return (base[:255] if base else "upload") or "upload"


def _sanitize_display_name(name: Optional[str], fallback: str) -> str:
    if not name or not str(name).strip():
        return fallback
    s = _DISPLAY_BAD.sub("", str(name).strip())
    s = " ".join(s.split())
    return (s[:200] if s else fallback) or fallback


def _row_to_metadata(row: dict) -> FileMetadata:
    return FileMetadata.model_validate(row)


# ── Files ─────────────────────────────────────────────────────────────────────


@router.post(
    "/upload",
    tags=["Files"],
    summary="Upload and index a document",
    response_description="SSE stream: progress events, then final JSON with file_id and stats.",
)
async def upload_file(
    request: Request,
    file: UploadFile = File(..., description="CSV, Excel (.xlsx/.xls), or PDF."),
    display_name: Optional[str] = Form(
        None,
        description="Optional friendly name shown in the UI (defaults to the file name).",
    ),
    is_private: bool = Form(
        False,
        description="When true, only users in public_users may access this file.",
    ),
    public_users: Optional[str] = Form(
        None,
        description='JSON array of usernames, e.g. ["Alice","Bob"]. Empty = no restriction.',
    ),
    _admin: dict = Depends(require_admin),
):
    rate_limiter.check(request, limit=10)

    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided.")

    original_base = _safe_original_filename(file.filename)
    suffix = Path(original_base).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{suffix}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    fallback_label = original_base
    label = _sanitize_display_name(display_name, fallback_label)

    # Parse public_users JSON string from form
    parsed_users: list[str] = []
    if public_users:
        try:
            val = json.loads(public_users)
            if isinstance(val, list):
                parsed_users = [str(u).strip() for u in val if str(u).strip()]
        except (json.JSONDecodeError, ValueError):
            # Treat as comma-separated fallback
            parsed_users = [u.strip() for u in public_users.split(",") if u.strip()]

    file_id = str(uuid.uuid4())[:8]
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    storage_name = f"{file_id}_{original_base}"
    file_path = settings.upload_dir / storage_name
    max_bytes = settings.max_file_size_mb * 1024 * 1024
    mime_type = file.content_type or ""

    total_bytes = 0
    try:
        with open(file_path, "wb") as fout:
            while True:
                chunk = await file.read(_CHUNK)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > max_bytes:
                    file_path.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=400,
                        detail=f"File too large (>{settings.max_file_size_mb} MB).",
                    )
                fout.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        file_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")

    from db.database import upsert_job

    await upsert_job(file_id, original_base, str(file_path))

    async def event_stream():
        queue: asyncio.Queue = asyncio.Queue()

        async def progress_cb(stage: str, percent: float, message: str):
            await queue.put(
                {
                    "stage": stage,
                    "percent": round(percent, 1),
                    "message": message,
                    "file_id": file_id,
                }
            )

        async def run():
            try:
                result = await ingest_file(
                    file_path=file_path,
                    file_id=file_id,
                    display_name=label,
                    original_filename=original_base,
                    byte_size=total_bytes,
                    mime_type=mime_type,
                    is_private=is_private,
                    public_users=parsed_users,
                    on_progress=progress_cb,
                )
                await queue.put({"stage": "done", "result": result})
            except Exception as e:
                await queue.put({"stage": "error", "message": str(e)})

        task = asyncio.create_task(run())
        idle_timeout_s = 180
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=idle_timeout_s)
            except asyncio.TimeoutError:
                if task.done():
                    err = None
                    try:
                        _ = task.result()
                    except Exception as e:
                        err = str(e)
                    msg = err or "Upload stream ended unexpectedly."
                    payload = {"error": msg, "message": msg, "stage": "error"}
                    yield f"data: {json.dumps(payload)}\n\n"
                    break
                msg = f"No upload progress for {idle_timeout_s}s. Please retry."
                payload = {"error": msg, "message": msg, "stage": "error"}
                yield f"data: {json.dumps(payload)}\n\n"
                task.cancel()
                break

            if event.get("stage") == "done":
                yield f"data: {json.dumps(event.get('result', {}))}\n\n"
                break
            elif event.get("stage") == "error":
                msg = event.get("message") or event.get("error") or "Unknown error"
                yield f"data: {json.dumps({'error': msg, 'message': msg, 'stage': 'error'})}\n\n"
                break
            else:
                yield f"data: {json.dumps(event)}\n\n"
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get(
    "/files",
    tags=["Files"],
    summary="List indexed documents",
    response_model=FileListResponse,
)
async def get_files():
    try:
        raw = await list_files()
        return FileListResponse(files=[_row_to_metadata(r) for r in raw])
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/files/{file_id}",
    tags=["Files"],
    summary="Get file metadata",
    response_model=FileMetadata,
    responses={404: {"description": "Unknown file_id"}},
)
async def get_file_metadata(file_id: str):
    row = await get_file(file_id)
    if not row:
        raise HTTPException(status_code=404, detail="File not found.")
    return _row_to_metadata(row)


@router.patch(
    "/files/{file_id}",
    tags=["Files"],
    summary="Rename display label",
    response_model=RenameFileResponse,
    responses={404: {"description": "Unknown file_id"}},
)
async def rename_file(file_id: str, body: RenameFileRequest):
    row = await get_file(file_id)
    if not row:
        raise HTTPException(status_code=404, detail="File not found.")

    new_name = _sanitize_display_name(body.display_name, row.get("file_name") or "Untitled")
    ok = await update_file_display_name(file_id, new_name)
    if not ok:
        raise HTTPException(status_code=500, detail="Rename failed.")
    return RenameFileResponse(file_id=file_id, file_name=new_name, message="Renamed.")


@router.delete(
    "/files/{file_id}",
    tags=["Files"],
    summary="Delete indexed document",
    response_model=DeleteResponse,
)
async def remove_file(file_id: str, _admin: dict = Depends(require_admin)):
    try:
        deleted = await delete_file(file_id)
        if settings.upload_dir.exists():
            for f in settings.upload_dir.iterdir():
                if f.name.startswith(file_id):
                    f.unlink()
        return DeleteResponse(
            file_id=file_id,
            deleted=deleted,
            message="File deleted." if deleted else "File not found.",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/files/{file_id}/chunks",
    tags=["Files"],
    summary="Inspect indexed chunks (debug)",
    response_model=ChunkListResponse,
)
async def get_file_chunks(
    file_id: str,
    limit: int = 50,
    offset: int = 0,
    sheet_name: Optional[str] = None,
):
    """
    Returns raw text chunks stored in Qdrant for one file.
    Use this endpoint for debugging: inspect exactly what text the LLM
    is searching over and how the file was split into chunks.

    - `limit` / `offset`: pagination (max 200 per page).
    - `sheet_name`: filter to one sheet / tab.
    """
    row = await get_file(file_id)
    if not row:
        raise HTTPException(status_code=404, detail="File not found.")
    limit = min(max(1, limit), 200)
    offset = max(0, offset)
    try:
        from db.qdrant_client import scroll_chunks
        result = await asyncio.to_thread(
            scroll_chunks, file_id, limit, offset, sheet_name
        )
        chunks = [ChunkInfo(**c) for c in result["chunks"]]
        return ChunkListResponse(
            file_id=file_id,
            total=result["total"],
            limit=limit,
            offset=offset,
            chunks=chunks,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Conversations ─────────────────────────────────────────────────────────────


@router.post(
    "/conversations",
    tags=["Conversations"],
    summary="Create a new conversation",
    response_model=ConversationInfo,
    status_code=201,
)
async def create_conv(
    body: ConversationCreate,
    current_user: dict = Depends(get_current_user),
):
    from db.database import create_conversation
    row = await create_conversation(
        body.file_id,
        body.title or "New conversation",
        user_id=current_user["user_id"],
    )
    return ConversationInfo(**row)


@router.get(
    "/conversations",
    tags=["Conversations"],
    summary="List conversations (optionally filtered by file_id)",
    response_model=ConversationListResponse,
)
async def list_convs(
    file_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    from db.database import list_conversations
    uid = None if current_user.get("role") == "admin" else current_user["user_id"]
    rows = await list_conversations(file_id, user_id=uid)
    return ConversationListResponse(
        conversations=[ConversationInfo(**r) for r in rows]
    )


@router.get(
    "/conversations/{conversation_id}/messages",
    tags=["Conversations"],
    summary="Get all messages in a conversation",
    response_model=ConversationMessagesResponse,
)
async def get_conv_messages(
    conversation_id: str,
    current_user: dict = Depends(get_current_user),
):
    from db.database import get_conversation, get_messages
    conv = await get_conversation(conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    # Enforce ownership — admin bypasses; conversations without user_id are legacy/shared
    if current_user.get("role") != "admin":
        conv_owner = conv.get("user_id")
        if conv_owner and conv_owner != current_user["user_id"]:
            raise HTTPException(status_code=403, detail="Access denied.")
    msgs = await get_messages(conversation_id)
    return ConversationMessagesResponse(
        conversation_id=conversation_id,
        messages=[MessageInfo(**m) for m in msgs],
    )


@router.patch(
    "/conversations/{conversation_id}",
    tags=["Conversations"],
    summary="Rename a conversation",
)
async def rename_conv(conversation_id: str, body: dict):
    from db.database import get_conversation, update_conversation_title
    conv = await get_conversation(conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    title = str(body.get("title", "")).strip()[:120] or "New conversation"
    await update_conversation_title(conversation_id, title)
    return {"conversation_id": conversation_id, "title": title}


@router.delete(
    "/conversations/{conversation_id}",
    tags=["Conversations"],
    summary="Delete a conversation and all its messages",
)
async def delete_conv(conversation_id: str):
    from db.database import delete_conversation
    deleted = await delete_conversation(conversation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return {"deleted": True}


# ── Auto-title helper ─────────────────────────────────────────────────────────

async def _auto_title(conversation_id: str, question: str) -> None:
    """Generate a short title for a new conversation from the first question."""
    try:
        from core.llm import get_llm
        llm = get_llm()
        raw = await llm.generate_answer(
            question=question,
            context="",
            system_prompt=(
                "Summarise the following question as a conversation title in 4–6 words. "
                "Return ONLY the title text, no quotes, no punctuation at the end."
            ),
        )
        title = raw.strip().strip('"').strip("'")[:100] or question[:60]
        from db.database import update_conversation_title
        await update_conversation_title(conversation_id, title)
    except Exception:
        pass  # non-critical — default title stays


# ── RAG (chat) ────────────────────────────────────────────────────────────────


@router.post(
    "/query",
    tags=["RAG (chat)"],
    summary="RAG answer (JSON)",
    response_model=QueryResponse,
)
async def query_answer(
    request: Request,
    body: QueryRequest,
    current_user: dict = Depends(get_current_user),
):
    rate_limiter.check(request, limit=30)
    try:
        chat_history = body.chat_history

        if body.conversation_id:
            from db.database import get_conversation
            conv = await get_conversation(body.conversation_id)
            if not conv:
                raise HTTPException(
                    status_code=404, detail="Conversation not found."
                )
            from generation.generator import get_effective_history
            chat_history = await get_effective_history(body.conversation_id)

        # Resolve file scope: agent overrides single file_id
        effective_file_id = body.file_id
        agent_file_ids: list[str] | None = None
        if body.agent_id and current_user.get("role") != "admin":
            allowed = await user_can_access_agent(current_user["user_id"], body.agent_id)
            if not allowed:
                raise HTTPException(
                    status_code=403,
                    detail="You do not have access to this agent.",
                )
            agent_file_ids = await get_agent_file_ids(body.agent_id)
            if len(agent_file_ids) == 1:
                effective_file_id = agent_file_ids[0]
            elif len(agent_file_ids) > 1:
                effective_file_id = None  # searcher will receive file_ids list

        async with asyncio.timeout(120):
            result = await generate_answer_full(
                question=body.question,
                file_id=effective_file_id,
                file_ids=agent_file_ids if (agent_file_ids and len(agent_file_ids) > 1) else None,
                sheet_name=body.sheet_name,
                chat_history=chat_history,
            )

        if body.conversation_id:
            from db.database import save_message, count_messages
            from generation.generator import maybe_compress_history
            is_first = (await count_messages(body.conversation_id)) == 0
            await save_message(body.conversation_id, "user", body.question)
            await save_message(
                body.conversation_id, "assistant", result["answer"]
            )
            asyncio.create_task(
                maybe_compress_history(body.conversation_id)
            )
            if is_first:
                asyncio.create_task(
                    _auto_title(body.conversation_id, body.question)
                )

        return QueryResponse(**result)
    except HTTPException:
        raise
    except TimeoutError:
        raise HTTPException(
            status_code=504,
            detail="Query timed out after 120s. Retry with a shorter question or a local model.",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Web search ────────────────────────────────────────────────────────────────


@router.post(
    "/search",
    tags=["Web search"],
    summary="Web search + answer (JSON)",
    response_model=WebSearchResponse,
)
async def search_answer(
    request: Request,
    body: QueryRequest,
    current_user: dict = Depends(get_current_user),
):
    rate_limiter.check(request, limit=30)
    try:
        async with asyncio.timeout(120):
            result = await complete_web_search(body.question)
        return WebSearchResponse(**result)
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Search timed out after 120s.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Charts ────────────────────────────────────────────────────────────────────


@router.post(
    "/chart",
    tags=["Charts"],
    summary="Chart generation (JSON)",
    response_model=ChartResponse,
)
async def chart_answer(
    request: Request,
    body: QueryRequest,
    current_user: dict = Depends(get_current_user),
):
    rate_limiter.check(request, limit=20)
    try:
        async with asyncio.timeout(180):
            result = await complete_chart(body.question)
        return ChartResponse(**result)
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Chart request timed out after 180s.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Agents ────────────────────────────────────────────────────────────────────


@router.post(
    "/agents",
    tags=["Agents"],
    summary="Create a new agent",
    response_model=AgentInfo,
    status_code=201,
)
async def create_agent_endpoint(
    body: AgentCreate,
    current_user: dict = Depends(require_admin),
):
    try:
        agent = await create_agent(
            name=body.name,
            description=body.description,
            image=body.image,
            status=body.status,
            tags=body.tags,
            created_by=body.created_by,
            is_private=body.is_private,
            model=body.model,
            file_ids=body.file_ids,
        )
        return AgentInfo(**agent)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/agents",
    tags=["Agents"],
    summary="List all agents",
    response_model=AgentListResponse,
)
async def list_agents_endpoint(current_user: dict = Depends(get_current_user)):
    try:
        # Admin sees every agent; regular users only see agents they can access
        if current_user.get("role") == "admin":
            agents = await list_agents()
        else:
            agents = await list_agents_for_user(current_user["user_id"])
        return AgentListResponse(agents=[AgentInfo(**a) for a in agents])
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/agents/{agent_id}",
    tags=["Agents"],
    summary="Get agent by id",
    response_model=AgentInfo,
    responses={404: {"description": "Agent not found"}},
)
async def get_agent_endpoint(
    agent_id: str,
    current_user: dict = Depends(get_current_user),
):
    agent = await get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found.")
    if current_user.get("role") != "admin":
        if not await user_can_access_agent(current_user["user_id"], agent_id):
            raise HTTPException(status_code=404, detail="Agent not found.")
    return AgentInfo(**agent)


@router.patch(
    "/agents/{agent_id}",
    tags=["Agents"],
    summary="Update agent metadata",
    response_model=AgentInfo,
    responses={404: {"description": "Agent not found"}},
)
async def update_agent_endpoint(
    agent_id: str,
    body: AgentUpdate,
    _admin: dict = Depends(require_admin),
):
    agent = await get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found.")
    updated = await update_agent(
        agent_id,
        name=body.name,
        description=body.description,
        image=body.image,
        status=body.status,
        tags=body.tags,
        created_by=body.created_by,
        is_private=body.is_private,
        model=body.model,
    )
    return AgentInfo(**updated)


@router.delete(
    "/agents/{agent_id}",
    tags=["Agents"],
    summary="Delete an agent (conversations are preserved, file attachments removed)",
    response_model=DeleteResponse,
)
async def delete_agent_endpoint(
    agent_id: str,
    _admin: dict = Depends(require_admin),
):
    deleted = await delete_agent(agent_id)
    return DeleteResponse(
        file_id=agent_id,
        deleted=deleted,
        message="Agent deleted." if deleted else "Agent not found.",
    )


@router.get(
    "/agents/{agent_id}/files",
    tags=["Agents"],
    summary="List files attached to agent",
    response_model=FileListResponse,
)
async def get_agent_files(agent_id: str):
    agent = await get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found.")
    from db.database import get_file as _get_file
    result = []
    for fid in agent["file_ids"]:
        row = await _get_file(fid)
        if row:
            result.append(_row_to_metadata(row))
    return FileListResponse(files=result)


@router.post(
    "/agents/{agent_id}/files",
    tags=["Agents"],
    summary="Attach one or more files to an agent",
    response_model=AgentInfo,
)
async def attach_files_to_agent(
    agent_id: str,
    body: AgentFilesUpdate,
    _admin: dict = Depends(require_admin),
):
    agent = await get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found.")
    await add_files_to_agent(agent_id, body.file_ids)
    updated = await get_agent(agent_id)
    return AgentInfo(**updated)


@router.delete(
    "/agents/{agent_id}/files/{file_id}",
    tags=["Agents"],
    summary="Detach a file from an agent",
)
async def detach_file_from_agent(
    agent_id: str,
    file_id: str,
    _admin: dict = Depends(require_admin),
):
    removed = await remove_file_from_agent(agent_id, file_id)
    if not removed:
        raise HTTPException(status_code=404, detail="File not attached to this agent.")
    return {"agent_id": agent_id, "file_id": file_id, "detached": True}


@router.get(
    "/agents/{agent_id}/conversations",
    tags=["Agents"],
    summary="List conversations for an agent",
    response_model=ConversationListResponse,
)
async def list_agent_convs(
    agent_id: str,
    current_user: dict = Depends(get_current_user),
):
    agent = await get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found.")
    uid = None if current_user.get("role") == "admin" else current_user["user_id"]
    rows = await list_agent_conversations(agent_id, user_id=uid)
    return ConversationListResponse(
        conversations=[ConversationInfo(**r) for r in rows]
    )


@router.post(
    "/agents/{agent_id}/conversations",
    tags=["Agents"],
    summary="Create a conversation for an agent",
    response_model=ConversationInfo,
    status_code=201,
)
async def create_agent_conv(
    agent_id: str,
    body: AgentConversationCreate,
    current_user: dict = Depends(get_current_user),
):
    agent = await get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found.")
    row = await create_agent_conversation(
        agent_id, body.title, user_id=current_user["user_id"]
    )
    return ConversationInfo(**row)


# ── Agent members ─────────────────────────────────────────────────────────────


@router.get(
    "/agents/{agent_id}/members",
    tags=["Agents"],
    summary="List users who can access this agent",
)
async def list_members(
    agent_id: str,
    _admin: dict = Depends(require_admin),
):
    from db.database import list_agent_members
    return await list_agent_members(agent_id)


@router.post(
    "/agents/{agent_id}/members",
    tags=["Agents"],
    summary="Grant a user access to this agent",
    status_code=201,
)
async def add_member(
    agent_id: str,
    body: AgentMemberAdd,
    _admin: dict = Depends(require_admin),
):
    from db.database import add_agent_member
    await add_agent_member(agent_id, body.user_id)
    return {"agent_id": agent_id, "user_id": body.user_id, "added": True}


@router.delete(
    "/agents/{agent_id}/members/{user_id}",
    tags=["Agents"],
    summary="Revoke a user's access to this agent",
)
async def remove_member(
    agent_id: str,
    user_id: str,
    _admin: dict = Depends(require_admin),
):
    from db.database import remove_agent_member
    ok = await remove_agent_member(agent_id, user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Member not found.")
    return {"deleted": True}


# ── System ────────────────────────────────────────────────────────────────────


@router.get(
    "/health",
    tags=["System"],
    summary="Health check",
)
async def health_check():
    return {"status": "healthy"}
