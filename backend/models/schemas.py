"""
API Models — request and response schemas.

FastAPI uses these for validation, OpenAPI /docs, and typed responses.
"""

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class QueryRequest(BaseModel):
    """Body for RAG, web search, and chart endpoints."""

    question: str = Field(..., description="User question or prompt.")
    file_id: str | None = Field(
        None,
        description="Indexed document id. Used when querying a single file directly.",
    )
    agent_id: str | None = Field(
        None,
        description="Agent id. When set, retrieval spans all files attached to this agent.",
    )
    sheet_name: str | None = Field(
        None,
        description="Optional Excel sheet name to scope retrieval.",
    )
    chat_history: list[dict[str, Any]] | None = Field(
        None,
        description="Prior turns as {role, content}. Ignored when conversation_id is set.",
    )
    conversation_id: str | None = Field(
        None,
        description=(
            "Persist this exchange in a named conversation. "
            "When set, history is loaded from the database and the answer is saved automatically."
        ),
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "question": "Who had the highest sales in the South region?",
                    "agent_id": "agent-id-here",
                    "conversation_id": "uuid-here",
                }
            ]
        }
    }


class FileMetadata(BaseModel):
    """Full metadata for one uploaded / indexed file."""

    file_id: str = Field(..., description="Stable 8-character id (prefix of UUID).")
    file_name: str = Field(
        ...,
        description="User-visible label (editable via PATCH /files/{file_id}).",
    )
    original_filename: str | None = Field(
        None,
        description="Original basename from the browser upload (immutable).",
    )
    extension: str = Field("", description="Lowercase extension, e.g. .xlsx")
    byte_size: int = Field(0, description="Uploaded file size in bytes.")
    mime_type: str = Field("", description="Client-provided Content-Type if any.")
    total_chunks: int = Field(0, description="Number of indexed chunks.")
    total_rows: int = Field(0, description="Approximate row span for tabular data.")
    sheets: list[str] = Field(
        default_factory=list,
        description="Excel tab names (CSV/PDF use a single placeholder). Omitted when empty.",
    )
    status: str = Field(
        ...,
        description="processing | complete | (legacy rows may show other values).",
    )
    is_private: bool = Field(
        False,
        description="When true, only users listed in public_users may access this file.",
    )
    public_users: list[str] = Field(
        default_factory=list,
        description="Usernames who can access this file. Meaningful when is_private=true.",
    )
    created_at: str | None = Field(
        None, description="When the file record was created (SQLite / ISO timestamp)."
    )
    updated_at: str | None = Field(
        None, description="Last metadata change (rename, ingest complete, etc.)."
    )

    model_config = ConfigDict(
        from_attributes=True,
        json_schema_extra={
            "example": {
                "file_id": "a1b2c3d4",
                "file_name": "Sales.xlsx",
                "original_filename": "Sales.xlsx",
                "extension": ".xlsx",
                "byte_size": 102400,
                "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "total_chunks": 42,
                "total_rows": 500,
                "sheets": ["Summary", "Detail"],
                "status": "complete",
                "created_at": "2026-01-01T12:00:00",
                "updated_at": "2026-01-01T12:00:00",
            }
        },
    )


class FileListResponse(BaseModel):
    """GET /files — all fully indexed documents."""

    files: list[FileMetadata] = Field(..., description="Indexed files, newest first.")


class RenameFileRequest(BaseModel):
    """PATCH /files/{file_id} — set a new display name."""

    display_name: str = Field(
        ...,
        min_length=1,
        max_length=200,
        description="New label shown in the UI (not the on-disk storage name).",
    )

    model_config = {
        "json_schema_extra": {
            "examples": [{"display_name": "Q4 Sales workbook"}]
        }
    }


class RenameFileResponse(BaseModel):
    file_id: str
    file_name: str = Field(..., description="Echo of the new display name.")
    message: str = "Renamed."


class QueryResponse(BaseModel):
    """RAG answer JSON (`POST /query`)."""

    answer: str
    sources: list[dict] = []
    chunks_searched: int = 0


class WebSearchResponse(BaseModel):
    """Web search answer JSON (`POST /search`)."""

    answer: str
    sources: list[dict] = Field(default_factory=list)


class ChartResponse(BaseModel):
    """Chart + intro JSON (`POST /chart`)."""

    answer: str
    chart: dict | None = None


class DeleteResponse(BaseModel):
    file_id: str
    deleted: bool
    message: str


class ConversationCreate(BaseModel):
    """POST /conversations — start a new conversation (file-scoped legacy)."""

    file_id: str | None = Field(None, description="Associate with a file (optional).")
    agent_id: str | None = Field(None, description="Associate with an agent (preferred).")
    title: str = Field("New conversation", max_length=120, description="Initial title.")


class ConversationInfo(BaseModel):
    """One conversation record."""

    conversation_id: str
    file_id: str | None = None
    agent_id: str | None = None
    title: str = "New conversation"
    message_count: int = 0
    created_at: str | None = None
    updated_at: str | None = None

    model_config = ConfigDict(from_attributes=True)


# ── Agent schemas ─────────────────────────────────────────────────────────────

class AgentCreate(BaseModel):
    """POST /agents — create a new agent."""

    name: str = Field(..., min_length=1, max_length=120, description="Display name.")
    description: str = Field("", max_length=500, description="Short description.")
    image: str = Field("", description="URL or base64 avatar image.")
    status: str = Field("Development", description="Development | Approved | Archived")
    tags: list[str] = Field(default_factory=list, description="Label tags.")
    created_by: str = Field("", max_length=80, description="Author name.")
    is_private: bool = Field(False, description="Restrict visibility.")
    model: str = Field("", description="LLM model label shown in UI.")
    file_ids: list[str] = Field(default_factory=list, description="Files to attach on creation.")

    model_config = {
        "json_schema_extra": {
            "examples": [{
                "name": "Flexcube User Manual",
                "description": "Flexcube Helper Agent",
                "status": "Approved",
                "tags": ["Approved", "AI Assisted"],
                "created_by": "Karthik",
                "model": "Qwen 3.5 Cloud",
                "file_ids": ["abc12345"],
            }]
        }
    }


class AgentUpdate(BaseModel):
    """PATCH /agents/{agent_id}."""

    name: str | None = None
    description: str | None = None
    image: str | None = None
    status: str | None = None
    tags: list[str] | None = None
    created_by: str | None = None
    is_private: bool | None = None
    model: str | None = None


class AgentFilesUpdate(BaseModel):
    """POST /agents/{agent_id}/files — attach files."""

    file_ids: list[str] = Field(..., min_length=1)


class AgentInfo(BaseModel):
    """Full agent record returned by the API."""

    agent_id: str
    name: str
    description: str = ""
    image: str = ""
    status: str = "Development"
    tags: list[str] = Field(default_factory=list)
    created_by: str = ""
    is_private: bool = False
    model: str = ""
    file_ids: list[str] = Field(default_factory=list)
    file_count: int = 0
    conversation_count: int = 0
    created_at: str | None = None
    updated_at: str | None = None

    model_config = ConfigDict(from_attributes=True)


class AgentListResponse(BaseModel):
    agents: list[AgentInfo]


class AgentConversationCreate(BaseModel):
    title: str = Field("New conversation", max_length=120)


class ConversationListResponse(BaseModel):
    conversations: list[ConversationInfo]


class MessageInfo(BaseModel):
    """One persisted message."""

    message_id: str
    conversation_id: str
    role: str
    content: str
    created_at: str | None = None

    model_config = ConfigDict(from_attributes=True)


class ConversationMessagesResponse(BaseModel):
    conversation_id: str
    messages: list[MessageInfo]


# ── Auth / User schemas ───────────────────────────────────────────────────────

class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: str = Field(..., description="Valid email address")
    password: str = Field(..., min_length=8, max_length=100)
    role: str = Field("user", description="user | admin")


class UserInfo(BaseModel):
    user_id: str
    username: str
    email: str
    role: str
    is_active: bool
    created_at: str | None = None

    model_config = ConfigDict(from_attributes=True)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    username: str
    role: str


class AgentMemberAdd(BaseModel):
    user_id: str = Field(..., description="User to add as agent member")


# ── Chunk inspector ───────────────────────────────────────────────────────────

class ChunkInfo(BaseModel):
    """One indexed chunk from Qdrant — returned by the debug inspector."""

    chunk_id: str
    text: str
    sheet_name: str = "default"
    row_start: int = 0
    row_end: int = 0
    file_name: str = ""
    chunk_type: str = "data"


class ChunkListResponse(BaseModel):
    """GET /files/{file_id}/chunks — paginated chunk inspector."""

    file_id: str
    total: int = Field(..., description="Total chunks stored (matching any sheet filter).")
    limit: int
    offset: int
    chunks: list[ChunkInfo]
