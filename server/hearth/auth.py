"""Two layers. (1) A bearer token generated at install. (2) The Tailscale-User-Login header that Tailscale Serve sets
on every tailnet request must match the configured owner, so the token alone isn't enough from another person's
device. Serve strips any client-sent copy of that header, so it can't be forged through Serve."""
from __future__ import annotations
import hmac
from fastapi import HTTPException, Request


def load_token(path: str) -> str:
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return ""


def check(request: Request) -> str:
    """Returns who is asking (their Tailscale login, or "local"). Raises 401/403."""
    app = request.app.state
    token = app.token
    got = request.headers.get("authorization", "")
    if not token or not got.startswith("Bearer ") or not hmac.compare_digest(got[7:].strip(), token):
        raise HTTPException(401, "bad or missing token")
    login = request.headers.get("tailscale-user-login", "")
    owner = app.cfg.owner
    if owner and login != owner:
        raise HTTPException(403, "not the owner's tailnet login")
    return login or "local"
