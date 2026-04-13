"""
Authentication endpoints:
  POST   /api/auth/register              — admin creates a user (admin only)
  POST   /api/auth/login                 — returns JWT token
  GET    /api/auth/me                    — returns current user info
  GET    /api/auth/users                 — list all users (admin only)
  PATCH  /api/auth/users/{user_id}/activate  — admin toggles active
  DELETE /api/auth/users/{user_id}           — admin deletes user
"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm

from core.auth import (
    create_access_token,
    get_current_user,
    hash_password,
    require_admin,
    verify_password,
)
from models.schemas import TokenResponse, UserCreate, UserInfo

auth_router = APIRouter(prefix="/auth", tags=["Auth"])


@auth_router.post("/register", response_model=UserInfo, status_code=201)
async def register_user(
    body: UserCreate,
    _admin: dict = Depends(require_admin),
):
    """Admin creates a new user account."""
    from db.database import create_user, get_user_by_username
    existing = await get_user_by_username(body.username)
    if existing:
        raise HTTPException(status_code=409, detail="Username already taken.")
    hashed = hash_password(body.password)
    user = await create_user(body.username, body.email, hashed, body.role)
    user.pop("hashed_password", None)
    return UserInfo(**user)


@auth_router.post("/login", response_model=TokenResponse)
async def login(form: OAuth2PasswordRequestForm = Depends()):
    """
    Login with username + password (OAuth2 form).
    Returns a JWT access token valid for jwt_expire_minutes.
    The frontend sends it as:  Authorization: Bearer <token>
    """
    from db.database import get_user_by_username
    user = await get_user_by_username(form.username)
    if not user or not verify_password(form.password, user["hashed_password"]):
        raise HTTPException(status_code=401, detail="Incorrect username or password.")
    if not user.get("is_active"):
        raise HTTPException(status_code=403, detail="Account is inactive.")
    token = create_access_token(user["user_id"], user["role"])
    return TokenResponse(
        access_token=token,
        user_id=user["user_id"],
        username=user["username"],
        role=user["role"],
    )


@auth_router.get("/me", response_model=UserInfo)
async def get_me(current_user: dict = Depends(get_current_user)):
    """Returns the currently logged-in user's info."""
    return UserInfo(**current_user)


@auth_router.get("/users", response_model=list[UserInfo])
async def list_all_users(_admin: dict = Depends(require_admin)):
    """List all users. Admin only."""
    from db.database import list_users
    users = await list_users()
    return [UserInfo(**u) for u in users]


@auth_router.patch("/users/{user_id}/activate")
async def toggle_user_active(
    user_id: str,
    body: dict,
    _admin: dict = Depends(require_admin),
):
    """Enable or disable a user account. Admin only."""
    from db.database import update_user_active
    is_active = bool(body.get("is_active", True))
    ok = await update_user_active(user_id, is_active)
    if not ok:
        raise HTTPException(status_code=404, detail="User not found.")
    return {"user_id": user_id, "is_active": is_active}


@auth_router.delete("/users/{user_id}")
async def delete_user_account(
    user_id: str,
    _admin: dict = Depends(require_admin),
):
    """Delete a user account. Admin only."""
    from db.database import delete_user
    ok = await delete_user(user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="User not found.")
    return {"deleted": True}
