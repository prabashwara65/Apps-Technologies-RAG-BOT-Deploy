"""Admin-only document extraction and candidate-vector persistence endpoint."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from typing import Annotated
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import get_embedding_provider, get_session
from app.api.permissions import get_current_admin
from app.core.config import Settings
from app.core.rate_limit import enforce_rate_limit
from app.domain.documents import DocumentVersionStatus, EmbeddingSetStatus
from app.models.documents import (
    DocumentModel,
    DocumentVersionModel,
    EmbeddingSetModel,
)
from app.providers.embeddings import EmbeddingProvider
from app.providers.gemini_embeddings import GeminiEmbeddingError
from app.schemas.document_ingestion import (
    DocumentChunkResponse,
    DocumentIngestionResponse,
)
from app.schemas.documents import (
    DocumentType,
    DocumentVersionActivationRequest,
    DocumentVersionActivationResponse,
    DocumentVersionLabelUpdateRequest,
    ManagedDocumentSummary,
    ManagedDocumentVersion,
)
from app.services.document_activation import activate_document
from app.services.document_ingestion import (
    DocumentIngestionError,
    DocumentIngestionErrorCode,
    ingest_document,
    persist_ingested_document,
)

router = APIRouter(
    prefix="/documents",
    tags=["documents"],
    dependencies=[Depends(get_current_admin), Depends(enforce_rate_limit)],
)

logger = logging.getLogger(__name__)


@router.get("/managed", response_model=list[ManagedDocumentSummary])
def list_managed_documents(
    session: Annotated[Session, Depends(get_session)],
) -> list[ManagedDocumentSummary]:
    """Return uploaded documents with every stored version for admin management."""
    rows = session.execute(
        select(DocumentModel, DocumentVersionModel)
        .outerjoin(
            DocumentVersionModel,
            DocumentVersionModel.document_id == DocumentModel.id,
        )
        .where(DocumentModel.tenant_id == "tenant-real")
        .order_by(DocumentModel.created_at.desc(), DocumentVersionModel.created_at.desc())
    ).all()
    documents_by_id: dict[UUID, ManagedDocumentSummary] = {}
    for document, version in rows:
        summary = documents_by_id.get(document.id)
        if summary is None:
            summary = ManagedDocumentSummary(
                id=str(document.id),
                title=document.title or document.document_key,
                document_type=document.document_type,
                created_at=document.created_at.isoformat(),
                versions=[],
            )
            documents_by_id[document.id] = summary
        if version is not None:
            summary.versions.append(
                ManagedDocumentVersion(
                    id=str(version.id),
                    version_label=version.version_label,
                    status=version.status,
                )
            )
    return list(documents_by_id.values())


@router.put(
    "/managed/{document_id}/versions/{version_id}/activation",
    response_model=DocumentVersionActivationResponse,
)
def set_document_version_activation(
    document_id: UUID,
    version_id: UUID,
    payload: DocumentVersionActivationRequest,
    session: Annotated[Session, Depends(get_session)],
) -> DocumentVersionActivationResponse:
    """Activate or archive one stored version while preserving lifecycle rules."""
    document = session.scalar(
        select(DocumentModel).where(
            DocumentModel.id == document_id,
            DocumentModel.tenant_id == "tenant-real",
        )
    )
    version = session.scalar(
        select(DocumentVersionModel).where(
            DocumentVersionModel.id == version_id,
            DocumentVersionModel.document_id == document_id,
        )
    )
    if document is None or version is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document version not found.",
        )

    embedding_sets = session.scalars(
        select(EmbeddingSetModel).where(
            EmbeddingSetModel.document_version_id == version.id
        )
    ).all()
    if payload.active:
        if version.status in {
            DocumentVersionStatus.ARCHIVED.value,
            DocumentVersionStatus.SUPERSEDED.value,
        }:
            if version.approved_at is None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="This version has not been approved and cannot be reactivated.",
                )
            version.status = DocumentVersionStatus.APPROVED.value
            for embedding_set in embedding_sets:
                if embedding_set.status == EmbeddingSetStatus.ARCHIVED.value:
                    embedding_set.status = EmbeddingSetStatus.CANDIDATE.value
        try:
            activated = activate_document(
                session,
                document.document_key,
                version_id=version.id,
            )
        except (ValueError, LookupError) as error:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(error),
            ) from error
        result_status = activated.status.value
    else:
        if version.status == DocumentVersionStatus.ACTIVE.value:
            version.status = DocumentVersionStatus.ARCHIVED.value
            for embedding_set in embedding_sets:
                embedding_set.status = EmbeddingSetStatus.ARCHIVED.value
            session.flush()
        result_status = version.status

    return DocumentVersionActivationResponse(
        document_id=str(document.id),
        version_id=str(version.id),
        status=result_status,
    )


@router.put("/managed/{document_id}/versions/{version_id}/label")
def update_managed_document_version_label(
    document_id: UUID,
    version_id: UUID,
    payload: DocumentVersionLabelUpdateRequest,
    session: Annotated[Session, Depends(get_session)],
) -> ManagedDocumentVersion:
    """Change a document version label without changing its lifecycle status."""
    document = session.scalar(
        select(DocumentModel).where(
            DocumentModel.id == document_id,
            DocumentModel.tenant_id == "tenant-real",
        )
    )
    version = session.scalar(
        select(DocumentVersionModel).where(
            DocumentVersionModel.id == version_id,
            DocumentVersionModel.document_id == document_id,
        )
    )
    if document is None or version is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document version not found.",
        )

    version_label = payload.version_label.strip()
    if not version_label:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Version label must not be empty.",
        )
    version.version_label = version_label
    try:
        session.flush()
    except IntegrityError as error:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This document already has that version label.",
        ) from error

    return ManagedDocumentVersion(
        id=str(version.id),
        version_label=version.version_label,
        status=version.status,
    )


@router.delete("/managed/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_managed_document(
    document_id: UUID,
    session: Annotated[Session, Depends(get_session)],
) -> None:
    """Delete an uploaded document and its database-cascaded versions and chunks."""
    document = session.scalar(
        select(DocumentModel).where(
            DocumentModel.id == document_id,
            DocumentModel.tenant_id == "tenant-real",
        )
    )
    if document is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found.",
        )
    session.delete(document)
    session.flush()


@router.post("/ingest")
async def upload_document(
    request: Request,
    file: Annotated[UploadFile, File()],
    document_type: Annotated[DocumentType, Form()],
    version: Annotated[str, Form(min_length=1)],
    title: Annotated[str, Form()],
    session: Annotated[Session, Depends(get_session)],
    embedding_provider: Annotated[EmbeddingProvider, Depends(get_embedding_provider)],
) -> StreamingResponse:
    """Extract an upload and persist its chunks/vectors as a candidate version."""
    version = version.strip()
    if not version:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Version must not be empty.",
        )
    title = title.strip()
    if not title or len(title) > 300:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Title must contain 1 to 300 characters.",
        )

    settings: Settings = request.app.state.settings
    content = await file.read(settings.document_max_bytes + 1)
    if len(content) > settings.document_max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"The document exceeds the {settings.document_max_bytes}-byte upload limit.",
        )

    def progress_event(stage: str, label: str, percent: int) -> str:
        payload = json.dumps(
            {"stage": stage, "label": label, "percent": percent},
            separators=(",", ":"),
        )
        return f"event: progress\ndata: {payload}\n\n"

    def error_event(kind: str, message: str) -> str:
        payload = json.dumps({"kind": kind, "message": message}, separators=(",", ":"))
        return f"event: error\ndata: {payload}\n\n"

    async def stream_upload() -> AsyncIterator[str]:
        yield progress_event("chunking", "Extracting and chunking document", 20)
        try:
            ingested = ingest_document(file.filename or "", content)
        except DocumentIngestionError as error:
            if error.code == DocumentIngestionErrorCode.UNSUPPORTED_FORMAT:
                kind = "unsupported"
            elif error.code in {
                DocumentIngestionErrorCode.INVALID_DOCUMENT,
                DocumentIngestionErrorCode.EMPTY_DOCUMENT,
            }:
                kind = "invalid"
            else:
                kind = "unexpected"
            yield error_event(kind, str(error))
            return

        yield progress_event("saving", "Saving document and chunks", 50)
        try:
            persisted = persist_ingested_document(
                session,
                tenant_id="tenant-real",
                content=content,
                document=ingested,
                embedding_provider=embedding_provider,
                document_type=document_type.value,
                version_label=version,
                title=title,
            )
        except GeminiEmbeddingError:
            logger.exception("Document upload embedding failed")
            session.rollback()
            yield error_event("unexpected", "The document could not be embedded for vector storage.")
            return
        except Exception:
            logger.exception("Document upload persistence failed")
            session.rollback()
            yield error_event("unexpected", "The document could not be saved.")
            return

        version_status = persisted.version_status
        if settings.auto_activate_uploads:
            yield progress_event("activating", "Activating document", 78)
            try:
                version_status = activate_document(
                    session,
                    persisted.document_key,
                    version_id=persisted.version_id,
                ).status
            except Exception:
                logger.exception("Document activation failed")
                session.rollback()
                yield error_event("unexpected", "The document was saved but could not be activated.")
                return

        try:
            session.commit()
        except Exception:
            logger.exception("Document upload transaction commit failed")
            session.rollback()
            yield error_event("unexpected", "The document could not be saved.")
            return

        yield progress_event("finishing", "Finishing upload", 95)
        result = DocumentIngestionResponse(
            filename=ingested.filename,
            document_type=document_type.value,
            document_key=persisted.document_key,
            document_id=persisted.document_id,
            version_id=persisted.version_id,
            version_status=version_status.value,
            chunk_count=len(ingested.chunks),
            chunks=[
                DocumentChunkResponse(
                    chunk_index=chunk.chunk_index,
                    content_text=chunk.content_text,
                    content_hash=chunk.content_hash,
                )
                for chunk in ingested.chunks
            ],
        )
        yield f"event: result\ndata: {result.model_dump_json()}\n\n"

    return StreamingResponse(
        stream_upload(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )