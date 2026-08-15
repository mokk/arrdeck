import base64
import hashlib
import ipaddress
import secrets
import time

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from ...cache import cache

router = APIRouter(prefix="/auth", tags=["auth"])

SESSION_COOKIE = "arrdeck_session"
SESSION_MAX_AGE = 180 * 86400
CHALLENGE_TTL = 300


def is_lan(request: Request) -> bool:
    # Source IPs are useless here: Docker Desktop NATs every inbound connection,
    # so even external traffic arrives from a private gateway address. Decide by
    # the requested hostname instead — the router only forwards 80/443 to the
    # reverse proxy, which routes by domain, so a request addressed to a private
    # IP literal or localhost can only be a direct LAN connection to :3500.
    host = request.headers.get("host", "").split(":")[0]
    if host == "localhost":
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_private or ip.is_loopback


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def has_session(request: Request) -> bool:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return False
    return request.app.state.db.session_valid(
        _token_hash(token), int(time.time()), SESSION_MAX_AGE
    )


def is_request_allowed(request: Request) -> bool:
    return is_lan(request) or has_session(request)


def _rp_id(request: Request) -> str:
    host = request.headers.get("host", "localhost")
    return host.split(":")[0]


def _origin(request: Request) -> str:
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    return f"{proto}://{request.headers.get('host', 'localhost')}"


def _start_session(request: Request, response: Response) -> None:
    token = secrets.token_urlsafe(32)
    request.app.state.db.session_add(_token_hash(token), int(time.time()))
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=(request.headers.get("x-forwarded-proto") or request.url.scheme) == "https",
    )


SETUP_CODE_KEY = "setup_code"
SETUP_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _setup_code(db) -> str:
    code = db.kv_get(SETUP_CODE_KEY)
    if not code:
        code = "".join(secrets.choice(SETUP_CODE_ALPHABET) for _ in range(8))
        db.kv_set(SETUP_CODE_KEY, code)
    return code


def _rotate_setup_code(db) -> None:
    db.kv_set(SETUP_CODE_KEY, "".join(secrets.choice(SETUP_CODE_ALPHABET) for _ in range(8)))


def _code_ok(request: Request, code: str) -> bool:
    if not code:
        return False
    stored = _setup_code(request.app.state.db)
    return secrets.compare_digest(code.strip().upper(), stored)


class RegisterOptionsIn(BaseModel):
    code: str = ""


class VerifyIn(BaseModel):
    credential: dict
    name: str = ""
    code: str = ""


@router.get("/state")
def auth_state(request: Request) -> dict:
    return {
        "authenticated": has_session(request),
        "lan": is_lan(request),
        "has_credentials": len(request.app.state.db.cred_list()) > 0,
    }


@router.get("/setup-code")
def setup_code(request: Request) -> dict:
    # Passkeys are bound to the domain they're created on, so registration has
    # to happen over https on the public hostname. This code — readable only
    # from the LAN address or a signed-in session — authorizes that.
    if not is_request_allowed(request):
        raise HTTPException(401, "unauthorized")
    return {"code": _setup_code(request.app.state.db)}


@router.post("/register/options")
def register_options(request: Request, body: RegisterOptionsIn | None = None) -> Response:
    if not (is_request_allowed(request) or _code_ok(request, body.code if body else "")):
        raise HTTPException(403, "passkeys can only be added with the setup code or a signed-in session")
    options = generate_registration_options(
        rp_id=_rp_id(request),
        rp_name="arrdeck",
        user_id=b"arrdeck-admin",
        user_name="arrdeck",
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
        exclude_credentials=[
            PublicKeyCredentialDescriptor(id=base64url_to_bytes(c["credential_id"]))
            for c in request.app.state.db.cred_list()
        ],
    )
    cache.set("webauthn:register", base64.b64encode(options.challenge).decode())
    return Response(content=options_to_json(options), media_type="application/json")


@router.post("/register/verify")
def register_verify(body: VerifyIn, request: Request, response: Response) -> dict:
    if not (is_request_allowed(request) or _code_ok(request, body.code)):
        raise HTTPException(403, "not allowed")
    challenge_b64 = cache.get("webauthn:register", CHALLENGE_TTL)
    if challenge_b64 is None:
        raise HTTPException(400, "registration challenge expired — try again")
    try:
        verification = verify_registration_response(
            credential=body.credential,
            expected_challenge=base64.b64decode(challenge_b64),
            expected_origin=_origin(request),
            expected_rp_id=_rp_id(request),
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"registration failed: {exc}") from exc
    db = request.app.state.db
    db.cred_add(
        base64.urlsafe_b64encode(verification.credential_id).decode().rstrip("="),
        base64.b64encode(verification.credential_public_key).decode(),
        body.name.strip() or "passkey",
        int(time.time()),
    )
    _rotate_setup_code(db)  # single-use: a fresh code is issued after each registration
    _start_session(request, response)
    return {"ok": True}


@router.post("/login/options")
def login_options(request: Request) -> Response:
    creds = request.app.state.db.cred_list()
    if not creds:
        raise HTTPException(400, "no passkeys registered yet")
    options = generate_authentication_options(
        rp_id=_rp_id(request),
        allow_credentials=[
            PublicKeyCredentialDescriptor(id=base64url_to_bytes(c["credential_id"]))
            for c in creds
        ],
        user_verification=UserVerificationRequirement.PREFERRED,
    )
    cache.set("webauthn:login", base64.b64encode(options.challenge).decode())
    return Response(content=options_to_json(options), media_type="application/json")


@router.post("/login/verify")
def login_verify(body: VerifyIn, request: Request, response: Response) -> dict:
    challenge_b64 = cache.get("webauthn:login", CHALLENGE_TTL)
    if challenge_b64 is None:
        raise HTTPException(400, "login challenge expired — try again")
    db = request.app.state.db
    raw_id = body.credential.get("rawId") or body.credential.get("id") or ""
    stored = next(
        (c for c in db.cred_list() if c["credential_id"].rstrip("=") == raw_id.rstrip("=")),
        None,
    )
    if stored is None:
        raise HTTPException(400, "unknown credential")
    try:
        verification = verify_authentication_response(
            credential=body.credential,
            expected_challenge=base64.b64decode(challenge_b64),
            expected_origin=_origin(request),
            expected_rp_id=_rp_id(request),
            credential_public_key=base64.b64decode(stored["public_key"]),
            credential_current_sign_count=stored["sign_count"],
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(401, f"sign-in failed: {exc}") from exc
    db.cred_update_count(stored["credential_id"], verification.new_sign_count)
    _start_session(request, response)
    return {"ok": True}


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        request.app.state.db.session_delete(_token_hash(token))
    response.delete_cookie(SESSION_COOKIE)


@router.get("/credentials")
def credentials(request: Request) -> list[dict]:
    if not is_request_allowed(request):
        raise HTTPException(401, "unauthorized")
    return [
        {"id": c["id"], "name": c["name"], "created": c["created"]}
        for c in request.app.state.db.cred_list()
    ]


@router.delete("/credentials/{cred_id}", status_code=204)
def delete_credential(cred_id: int, request: Request) -> None:
    if not is_request_allowed(request):
        raise HTTPException(401, "unauthorized")
    request.app.state.db.cred_delete(cred_id)
