"""HR grounded answer endpoint.

The route owns HTTP concerns only: contract validation, collaborator
injection, and mapping known failures onto stable status codes. Every
retrieval, prompting, and grounding decision stays in ``app.services.hr_rag``.
"""

from __future__ import annotations

import time
from sqlalchemy.orm import Session, sessionmaker
from app.core.database import session_scope
from app.repositories.query_traces import QueryTraceRepository
from app.schemas.query_trace import QueryTrace
from app.services.query_traces import persistent_trace_capture
from typing import Annotated, NoReturn

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.exc import SQLAlchemyError

from app.api.dependencies import (
    get_current_user,
    get_embedding_provider,
    get_embedding_repository,
    get_llm_provider,
)
from app.domain.accounts import UserAccount
from app.domain.roles import Role
from app.core.logging import get_logger
from app.core.rate_limit import enforce_rate_limit
from app.providers.embeddings import EmbeddingProvider
from app.providers.gemini_embeddings import (
    GeminiEmbeddingError,
    GeminiEmbeddingErrorCode,
)
from app.providers.gemini_llm import GeminiLLMError, GeminiLLMErrorCode
from app.providers.llm import LLMProvider, LLMUsageProvider
from app.repositories.embeddings import EmbeddingRepository
from app.schemas.rag import HRAskRequest, HRAskResponse
from app.services.dashboard import record_query_telemetry
from app.services.rag import HRRAGError, HRRAGErrorCode, answer_hr_question
from app.services.retrieval import HRRetrievalError, HRRetrievalErrorCode

router = APIRouter(prefix="/hr", tags=["hr-rag"])

logger = get_logger("api.hr_rag")

INVALID_QUESTION_MESSAGE = "The question could not be answered as submitted."
ANSWER_SERVICE_MESSAGE = "The answering service could not produce a grounded answer."
EVIDENCE_STORE_MESSAGE = "The approved HR evidence store is unavailable."
CONFIGURATION_MESSAGE = "The answering service is not configured."

_REQUEST_RETRIEVAL_CODES = frozenset(
    {
        HRRetrievalErrorCode.BLANK_QUERY,
        HRRetrievalErrorCode.BLANK_TENANT_ID,
        HRRetrievalErrorCode.INVALID_TOP_K,
    }
)
_SERVER_RAG_CODES = frozenset(
    {
        HRRAGErrorCode.INVALID_MAX_CONTEXT_CHARS,
        HRRAGErrorCode.CONTEXT_BUDGET_TOO_SMALL,
    }
)
_PROVIDER_CONFIGURATION_CODES = frozenset(
    {
        GeminiEmbeddingErrorCode.MISSING_API_KEY.value,
        GeminiEmbeddingErrorCode.MISSING_MODEL.value,
        GeminiLLMErrorCode.MISSING_API_KEY.value,
        GeminiLLMErrorCode.MISSING_MODEL.value,
    }
)


def _fail(
    status_code: int,
    message: str,
    *,
    request: Request,
    started_at: float,
    component: str,
    failure_code: str,
    error: Exception,
) -> NoReturn:
    """Log the real failure and return a stable, non-revealing response.

    Only the curated message reaches the client. Provider and service messages
    are never interpolated, so no request, credential, or schema detail can
    leak through an error body.
    """
    logger.warning(
        "HR grounded answer request failed",
        extra={"failure_code": failure_code, "status_code": status_code},
    )
    record_query_telemetry(
        request.app.state.session_factory,
        latency_ms=int((time.perf_counter() - started_at) * 1000),
        status="failure",
        component=component,
        failure_code=failure_code,
    )
    raise HTTPException(status_code=status_code, detail=message) from error


@router.post(
    "/ask",
    response_model=HRAskResponse,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(enforce_rate_limit), Depends(get_current_user)],
)
def ask_hr_question(
    request: Request,
    payload: HRAskRequest,
    user: Annotated[UserAccount, Depends(get_current_user)],
    embedding_provider: Annotated[EmbeddingProvider, Depends(get_embedding_provider)],
    llm_provider: Annotated[LLMProvider, Depends(get_llm_provider)],
    repository: Annotated[EmbeddingRepository, Depends(get_embedding_repository)],
) -> HRAskResponse:
    """Answer one HR question strictly from that tenant's approved HR sources.

    Declared with ``def`` rather than ``async def`` on purpose: the grounded
    answer service performs blocking database and provider I/O, so FastAPI runs
    it in a worker thread instead of stalling the event loop.

    An answer with no supporting evidence is a normal 200 response carrying
    ``insufficient_evidence``; it is not an error.
    """
    if payload.document_type is not None and user.role != Role.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can filter searches by document type.",
        )
    start_t = time.perf_counter()
    if isinstance(llm_provider, LLMUsageProvider):
        llm_provider.reset_token_usage()
    try:
        factory: sessionmaker[Session] = request.app.state.session_factory
        def persist(trace: QueryTrace) -> str:
            with session_scope(factory) as trace_session:
                trace_id = QueryTraceRepository(trace_session).add(trace, user.id, payload.tenant_id)
            return trace_id
        with persistent_trace_capture(persist):
            answer = answer_hr_question(
                question=payload.question,
                tenant_id=payload.tenant_id,
                embedding_provider=embedding_provider,
                llm_provider=llm_provider,
                repository=repository,
                document_type=(
                    payload.document_type.value if payload.document_type is not None else None
                ),
            )
        elapsed_ms = int((time.perf_counter() - start_t) * 1000)
        usage = (
            llm_provider.token_usage
            if isinstance(llm_provider, LLMUsageProvider)
            and not answer.insufficient_evidence
            else None
        )
        record_query_telemetry(
            request.app.state.session_factory,
            latency_ms=elapsed_ms,
            status="success",
            component="rag",
            token_usage=usage.total_tokens if usage is not None else None,
        )
    except HRRetrievalError as error:
        if error.code in _REQUEST_RETRIEVAL_CODES:
            _fail(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                INVALID_QUESTION_MESSAGE,
                request=request,
                started_at=start_t,
                component="rag",
                failure_code=error.code.value,
                error=error,
            )
        _fail(
            status.HTTP_502_BAD_GATEWAY,
            ANSWER_SERVICE_MESSAGE,
            request=request,
            started_at=start_t,
            component="retrieval",
            failure_code=error.code.value,
            error=error,
        )
    except HRRAGError as error:
        if error.code is HRRAGErrorCode.BLANK_QUESTION:
            _fail(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                INVALID_QUESTION_MESSAGE,
                request=request,
                started_at=start_t,
                component="rag",
                failure_code=error.code.value,
                error=error,
            )
        if error.code in _SERVER_RAG_CODES:
            _fail(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                ANSWER_SERVICE_MESSAGE,
                request=request,
                started_at=start_t,
                component="rag",
                failure_code=error.code.value,
                error=error,
            )
        _fail(
            status.HTTP_502_BAD_GATEWAY,
            ANSWER_SERVICE_MESSAGE,
            request=request,
            started_at=start_t,
            component="rag",
            failure_code=error.code.value,
            error=error,
        )
    except (GeminiEmbeddingError, GeminiLLMError) as error:
        if error.code.value in _PROVIDER_CONFIGURATION_CODES:
            _fail(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                CONFIGURATION_MESSAGE,
                request=request,
                started_at=start_t,
                component="gemini",
                failure_code=error.code.value,
                error=error,
            )
        _fail(
            status.HTTP_502_BAD_GATEWAY,
            ANSWER_SERVICE_MESSAGE,
            request=request,
            started_at=start_t,
            component="gemini",
            failure_code=error.code.value,
            error=error,
        )
    except SQLAlchemyError as error:
        _fail(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            EVIDENCE_STORE_MESSAGE,
            request=request,
            started_at=start_t,
            component="database",
            failure_code="evidence_store_unavailable",
            error=error,
        )

    return HRAskResponse.from_domain(answer)