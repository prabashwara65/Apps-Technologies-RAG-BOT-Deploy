"""Current-user profile and avatar endpoints."""

from __future__ import annotations

from typing import Annotated, NoReturn
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, Response, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from app.core.rate_limit import enforce_rate_limit
from app.core import storage
from app.repositories.sqlalchemy_users import SQLAlchemyUserAccountRepository

from app.api.dependencies import get_auth_service, get_current_user, get_session
from app.domain.accounts import UserAccount
from app.schemas.auth import (
    ChangePasswordRequest,
    ProfileResponse,
    ProfileUpdateRequest,
    TotpConfirmRequest,
    TotpSetupResponse,
    TwoFactorUpdateRequest,
)
from app.services.auth import AuthError, AuthErrorCode, AuthService

router = APIRouter(prefix="/me", tags=["profile"])

_AVATAR_MEDIA_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


def _fail(error: AuthError) -> NoReturn:
    mapping = {
        AuthErrorCode.UNAUTHENTICATED: status.HTTP_401_UNAUTHORIZED,
        AuthErrorCode.INVALID_DISPLAY_NAME: status.HTTP_422_UNPROCESSABLE_ENTITY,
        AuthErrorCode.INVALID_THEME: status.HTTP_422_UNPROCESSABLE_ENTITY,
        AuthErrorCode.INVALID_AVATAR: status.HTTP_422_UNPROCESSABLE_ENTITY,
        AuthErrorCode.AVATAR_TOO_LARGE: 413,
        AuthErrorCode.INVALID_OTP: status.HTTP_422_UNPROCESSABLE_ENTITY,
        AuthErrorCode.INVALID_TWO_FACTOR: status.HTTP_422_UNPROCESSABLE_ENTITY,
        AuthErrorCode.TOTP_NOT_PENDING: status.HTTP_422_UNPROCESSABLE_ENTITY,
    }
    raise HTTPException(
        status_code=mapping.get(error.code, status.HTTP_400_BAD_REQUEST),
        detail=str(error),
    ) from error


@router.get("", response_model=ProfileResponse)
def read_profile(
    user: Annotated[UserAccount, Depends(get_current_user)],
) -> ProfileResponse:
    return ProfileResponse.from_account(user)


@router.patch("", response_model=ProfileResponse)
def update_profile(
    payload: ProfileUpdateRequest,
    user: Annotated[UserAccount, Depends(get_current_user)],
    auth: Annotated[AuthService, Depends(get_auth_service)],
) -> ProfileResponse:
    try:
        updated = auth.update_profile(
            user,
            display_name=payload.display_name,
            theme=payload.theme,
        )
    except AuthError as error:
        _fail(error)
    return ProfileResponse.from_account(updated)


@router.post("/two-factor", response_model=ProfileResponse)
def update_two_factor(
    payload: TwoFactorUpdateRequest,
    user: Annotated[UserAccount, Depends(get_current_user)],
    auth: Annotated[AuthService, Depends(get_auth_service)],
) -> ProfileResponse:
    try:
        updated = auth.set_two_factor_method(user, payload.method)
    except AuthError as error:
        _fail(error)
    return ProfileResponse.from_account(updated)


@router.post("/two-factor/totp", response_model=TotpSetupResponse)
def begin_totp(
    user: Annotated[UserAccount, Depends(get_current_user)],
    auth: Annotated[AuthService, Depends(get_auth_service)],
) -> TotpSetupResponse:
    try:
        setup = auth.begin_totp_setup(user)
    except AuthError as error:
        _fail(error)
    return TotpSetupResponse(
        secret=setup.secret,
        otpauth_uri=setup.otpauth_uri,
        qr_svg=setup.qr_svg,
    )


@router.post("/two-factor/totp/confirm", response_model=ProfileResponse)
def confirm_totp(
    payload: TotpConfirmRequest,
    user: Annotated[UserAccount, Depends(get_current_user)],
    auth: Annotated[AuthService, Depends(get_auth_service)],
) -> ProfileResponse:
    try:
        updated = auth.confirm_totp_setup(user, payload.code)
    except AuthError as error:
        _fail(error)
    return ProfileResponse.from_account(updated)


@router.get("/avatar")
def read_avatar(
    user: Annotated[UserAccount, Depends(get_current_user)],
    auth: Annotated[AuthService, Depends(get_auth_service)],
) -> FileResponse:
    path = storage.avatar_path(user.email) if user.avatar_filename else auth.avatar_file(user)
    if path is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No profile image is set.")
    media_type = _AVATAR_MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(path, media_type=media_type, headers={"Cache-Control": "no-cache"})


@router.get("/avatar/{user_id}")
def read_public_avatar(
    user_id: UUID,
    session: Annotated[Session, Depends(get_session)],
) -> FileResponse:
    account = SQLAlchemyUserAccountRepository(session).get_user_by_id(user_id)
    if account is None or account.avatar_filename is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No profile image is set.")
    path = storage.avatar_path(account.email)
    if path is None or path.name != account.avatar_filename:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No profile image is set.")
    return FileResponse(
        path, media_type=_AVATAR_MEDIA_TYPES.get(path.suffix.lower()),
        headers={"Cache-Control": "no-cache"},
    )


@router.post("/avatar")
def upload_avatar(
    user: Annotated[UserAccount, Depends(get_current_user)],
    auth: Annotated[AuthService, Depends(get_auth_service)],
    session: Annotated[Session, Depends(get_session)],
    file: Annotated[UploadFile, File()],
) -> dict[str, str]:
    repository = SQLAlchemyUserAccountRepository(session)
    try:
        stem = storage._sanitize_email(user.email)
        filenames = [f"{stem}{extension}" for extension in storage.ALLOWED_AVATAR_EXTENSIONS]
        if repository.avatar_name_in_use(user.id, filenames):
            raise storage.StorageError("This email maps to an avatar filename already in use.")
        filename = storage.save_avatar(user.email, file)
    except storage.StorageError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(error)) from error
    if user.avatar_path:
        auth.clear_avatar(user)
    repository.set_avatar_filename(user.id, filename)
    return {"avatar_url": f"/api/v1/me/avatar/{user.id}"}


@router.delete("/avatar", status_code=status.HTTP_204_NO_CONTENT)
def delete_avatar(
    user: Annotated[UserAccount, Depends(get_current_user)],
    auth: Annotated[AuthService, Depends(get_auth_service)],
    session: Annotated[Session, Depends(get_session)],
) -> Response:
    storage.delete_avatar(user.email)
    if user.avatar_path:
        auth.clear_avatar(user)
    SQLAlchemyUserAccountRepository(session).set_avatar_filename(user.id, None)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/password", status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(enforce_rate_limit)],
)
def change_password(
    payload: ChangePasswordRequest,
    user: Annotated[UserAccount, Depends(get_current_user)],
    auth: Annotated[AuthService, Depends(get_auth_service)],
    session: Annotated[Session, Depends(get_session)],
    background_tasks: BackgroundTasks,
) -> None:
    try:
        auth.change_password(
            user, current_password=payload.current_password,
            new_password=payload.new_password,
        )
    except AuthError as error:
        if error.code in {AuthErrorCode.INVALID_CREDENTIALS, AuthErrorCode.INVALID_PASSWORD}:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(error)) from error
        _fail(error)
    # Commit before confirming success or sending the existing security notice.
    session.commit()
    background_tasks.add_task(auth.send_password_changed_notice, user.email)
