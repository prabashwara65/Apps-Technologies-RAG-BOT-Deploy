"""Service to collect operational metrics, configuration, and activity logs for the dashboard."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import uuid4
import threading

from sqlalchemy import case, func, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings, get_settings
from app.core.database import session_scope
from app.models.documents import (
    ChunkModel,
    DocumentModel,
    DocumentVersionModel,
    EmbeddingModel,
    EmbeddingSetModel,
)
from app.models.service_telemetry import ServiceTelemetryModel
from app.schemas.dashboard import (
    ActivityItem,
    DashboardKpi,
    DocumentChunkCount,
    DocumentMetrics,
    DocumentSummary,
    DocumentTypeCount,
    DashboardOverviewResponse,
    EmbeddingSummary,
    LatencyBucket,
    RAGConfiguration,
    ServiceHealthComponent,
    ServiceStatus,
)
from app.core.logging import get_logger

# In-memory thread-safe recorder for query latencies
_METRICS_LOCK = threading.Lock()
_RECORDED_LATENCIES: list[dict] = []
MAX_STORED_METRICS = 5000
logger = get_logger("services.dashboard")


def build_document_metrics(session: Session) -> DocumentMetrics:
    """Collect read-only document and chunk counts, defaulting failed metrics to zero."""
    try:
        total = session.scalar(select(func.count(DocumentModel.id))) or 0
    except Exception:
        session.rollback()
        total = 0

    try:
        latest_versions = (
            select(
                DocumentVersionModel.document_id.label("document_id"),
                DocumentVersionModel.status.label("status"),
                func.row_number()
                .over(
                    partition_by=DocumentVersionModel.document_id,
                    order_by=(
                        DocumentVersionModel.created_at.desc(),
                        DocumentVersionModel.id.desc(),
                    ),
                )
                .label("version_rank"),
            )
            .subquery()
        )
        status_rows = session.execute(
            select(latest_versions.c.status, func.count())
            .where(latest_versions.c.version_rank == 1)
            .group_by(latest_versions.c.status)
        ).all()
        by_status = {status: count for status, count in status_rows}
    except Exception:
        session.rollback()
        by_status = {}

    try:
        type_rows = session.execute(
            select(DocumentModel.document_type, func.count())
            .group_by(DocumentModel.document_type)
            .order_by(func.count().desc())
            .limit(8)
        ).all()
        by_type = [
            DocumentTypeCount(type=document_type, count=count)
            for document_type, count in type_rows
        ]
    except Exception:
        session.rollback()
        by_type = []

    try:
        recent_cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
        recently_added_24h = (
            session.scalar(
                select(func.count(DocumentModel.id)).where(
                    DocumentModel.created_at > recent_cutoff
                )
            )
            or 0
        )
    except Exception:
        session.rollback()
        recently_added_24h = 0

    try:
        total_chunks = session.scalar(select(func.count(ChunkModel.id))) or 0
    except Exception:
        session.rollback()
        total_chunks = 0

    try:
        latest_versions = (
            select(
                DocumentVersionModel.document_id.label("document_id"),
                DocumentVersionModel.status.label("status"),
                func.row_number()
                .over(
                    partition_by=DocumentVersionModel.document_id,
                    order_by=(
                        DocumentVersionModel.created_at.desc(),
                        DocumentVersionModel.id.desc(),
                    ),
                )
                .label("version_rank"),
            )
            .subquery()
        )
        chunk_count = (
            select(func.count())
            .select_from(ChunkModel)
            .join(
                DocumentVersionModel,
                DocumentVersionModel.id == ChunkModel.document_version_id,
            )
            .where(DocumentVersionModel.document_id == DocumentModel.id)
            .correlate(DocumentModel)
            .scalar_subquery()
        )
        document_rows = session.execute(
            select(
                DocumentModel.id,
                DocumentModel.document_key,
                DocumentModel.title,
                DocumentModel.document_type,
                latest_versions.c.status,
                DocumentModel.created_at,
                func.coalesce(chunk_count, 0).label("chunk_count"),
            )
            .outerjoin(
                latest_versions,
                (latest_versions.c.document_id == DocumentModel.id)
                & (latest_versions.c.version_rank == 1),
            )
            .order_by(DocumentModel.created_at.desc())
            .limit(50)
        ).all()
        documents = [
            DocumentSummary(
                id=str(document_id),
                title=title or document_key,
                document_type=document_type,
                status=status or "Unknown",
                created_at=created_at.isoformat(),
                chunk_count=chunk_count,
            )
            for (
                document_id,
                document_key,
                title,
                document_type,
                status,
                created_at,
                chunk_count,
            ) in document_rows
        ]
    except Exception:
        session.rollback()
        documents = []

    return DocumentMetrics(
        total=total,
        by_status=by_status,
        by_type=by_type,
        recently_added_24h=recently_added_24h,
        total_chunks=total_chunks,
        documents=documents,
    )


def build_embedding_summary(session: Session, settings: Settings) -> EmbeddingSummary:
    """Collect embedding totals and per-document chunk distribution."""
    try:
        total = session.scalar(select(func.count()).select_from(EmbeddingModel)) or 0
    except Exception:
        session.rollback()
        total = 0

    try:
        dimension = getattr(settings, "embedding_dimension", 768) or 768
    except Exception:
        dimension = 768

    try:
        model_row = session.execute(
            select(EmbeddingSetModel.model_name, func.count())
            .group_by(EmbeddingSetModel.model_name)
            .order_by(func.count().desc())
            .limit(1)
        ).first()
        model_name = model_row[0] if model_row else settings.gemini_embedding_model
    except Exception:
        session.rollback()
        model_name = settings.gemini_embedding_model

    try:
        documents = build_document_metrics(session).documents
        by_document = [
            DocumentChunkCount(
                document_id=document.id,
                title=document.title,
                chunk_count=document.chunk_count,
            )
            for document in sorted(
                documents, key=lambda item: item.chunk_count, reverse=True
            )[:20]
        ]
    except Exception:
        session.rollback()
        by_document = []

    return EmbeddingSummary(
        total=total,
        dimension=dimension,
        model_name=model_name,
        by_document=by_document,
    )


def record_query_latency(
    latency_ms: int,
    endpoint: str = "/api/v1/hr/ask",
    status: str = "success",
) -> None:
    """Record a single query latency observation."""
    now = datetime.now(timezone.utc)
    with _METRICS_LOCK:
        _RECORDED_LATENCIES.append(
            {
                "timestamp": now,
                "latency_ms": max(1, latency_ms),
                "endpoint": endpoint,
                "status": status,
            }
        )
        if len(_RECORDED_LATENCIES) > MAX_STORED_METRICS:
            del _RECORDED_LATENCIES[: len(_RECORDED_LATENCIES) - MAX_STORED_METRICS]


def clear_recorded_query_latencies() -> None:
    """Clear the process-local query latency series after telemetry deletion."""
    with _METRICS_LOCK:
        _RECORDED_LATENCIES.clear()


def record_query_telemetry(
    session_factory: sessionmaker[Session],
    *,
    latency_ms: int,
    status: str,
    component: str,
    failure_code: str | None = None,
    token_usage: int | None = None,
) -> None:
    """Record process-local chart data and persist a privacy-minimal request event."""
    normalized_latency = max(0, latency_ms)
    record_query_latency(
        latency_ms=normalized_latency,
        endpoint="/api/v1/hr/ask",
        status=status,
    )
    try:
        with session_scope(session_factory) as session:
            session.add(
                ServiceTelemetryModel(
                    component=component,
                    status=status,
                    latency_ms=normalized_latency,
                    token_usage=token_usage,
                    failure_code=failure_code,
                )
            )
    except SQLAlchemyError as error:
        logger.warning(
            "Unable to persist service telemetry",
            extra={"error_type": type(error).__name__, "component": component},
        )


def build_service_status(session: Session, settings: Settings) -> ServiceStatus:
    """Report database/provider readiness and persisted request usage."""
    checked_at = datetime.now(timezone.utc)
    components: list[ServiceHealthComponent] = []
    database_available = False
    vector_available: bool | None = None
    telemetry_available = True

    try:
        session.scalar(select(1))
        database_available = True
        components.append(
            ServiceHealthComponent(
                name="PostgreSQL",
                status="healthy",
                message="Database connection is responding.",
            )
        )
    except SQLAlchemyError as error:
        session.rollback()
        components.append(
            ServiceHealthComponent(
                name="PostgreSQL",
                status="unavailable",
                message=f"Database connection failed ({type(error).__name__}).",
            )
        )

    if database_available:
        try:
            vector_version = session.execute(
                text("SELECT extversion FROM pg_extension WHERE extname = 'vector'")
            ).scalar_one_or_none()
            vector_available = vector_version is not None
            components.append(
                ServiceHealthComponent(
                    name="pgvector",
                    status="healthy" if vector_available else "unavailable",
                    message=(
                        f"pgvector {vector_version} is installed."
                        if vector_version is not None
                        else "The pgvector extension is not installed."
                    ),
                )
            )
        except SQLAlchemyError as error:
            session.rollback()
            vector_available = False
            components.append(
                ServiceHealthComponent(
                    name="pgvector",
                    status="unavailable",
                    message=f"Extension check failed ({type(error).__name__}).",
                )
            )
    else:
        components.append(
            ServiceHealthComponent(
                name="pgvector",
                status="unknown",
                message="Not checked because PostgreSQL is unavailable.",
            )
        )

    cutoff = checked_at - timedelta(hours=24)
    queries_last_24h = 0
    successful_queries_last_24h = 0
    failed_queries_last_24h = 0
    average_latency_ms = 0
    answer_tokens_last_24h: int | None = None
    last_query_at: datetime | None = None
    latest_gemini_event: tuple[str, datetime] | None = None
    latest_successful_query: datetime | None = None

    if database_available:
        try:
            telemetry_counts = session.execute(
                select(
                    func.count(ServiceTelemetryModel.id),
                    func.sum(
                        case((ServiceTelemetryModel.status == "success", 1), else_=0)
                    ),
                    func.sum(
                        case((ServiceTelemetryModel.status == "failure", 1), else_=0)
                    ),
                    func.avg(ServiceTelemetryModel.latency_ms),
                    func.max(ServiceTelemetryModel.created_at),
                    func.sum(ServiceTelemetryModel.token_usage),
                ).where(ServiceTelemetryModel.created_at >= cutoff)
            ).one()
            queries_last_24h = int(telemetry_counts[0] or 0)
            successful_queries_last_24h = int(telemetry_counts[1] or 0)
            failed_queries_last_24h = int(telemetry_counts[2] or 0)
            average_latency_ms = int(telemetry_counts[3] or 0)
            last_query_at = telemetry_counts[4]
            if telemetry_counts[5] is not None:
                answer_tokens_last_24h = int(telemetry_counts[5])
            latest_gemini_row = session.execute(
                select(ServiceTelemetryModel.status, ServiceTelemetryModel.created_at)
                .where(
                    ServiceTelemetryModel.component == "gemini",
                    ServiceTelemetryModel.created_at >= cutoff,
                )
                .order_by(ServiceTelemetryModel.created_at.desc())
                .limit(1)
            ).first()
            if latest_gemini_row is not None:
                latest_gemini_event = (
                    latest_gemini_row[0],
                    latest_gemini_row[1],
                )
            latest_successful_query = session.execute(
                select(ServiceTelemetryModel.created_at)
                .where(
                    ServiceTelemetryModel.status == "success",
                    ServiceTelemetryModel.created_at >= cutoff,
                )
                .order_by(ServiceTelemetryModel.created_at.desc())
                .limit(1)
            ).scalar_one_or_none()
            components.append(
                ServiceHealthComponent(
                    name="Telemetry",
                    status="healthy",
                    message="Request metrics are being persisted.",
                )
            )
        except SQLAlchemyError as error:
            session.rollback()
            telemetry_available = False
            components.append(
                ServiceHealthComponent(
                    name="Telemetry",
                    status="unavailable",
                    message=(
                        "Request metrics could not be read. Apply the service telemetry "
                        f"database migration ({type(error).__name__})."
                    ),
                )
            )
    else:
        telemetry_available = False
        components.append(
            ServiceHealthComponent(
                name="Telemetry",
                status="unknown",
                message="Not checked because PostgreSQL is unavailable.",
            )
        )

    if settings.gemini_api_key is None or not settings.gemini_api_key.get_secret_value().strip():
        gemini_status = "not_configured"
        gemini_message = "Gemini API credentials are not configured."
    elif latest_gemini_event is not None and latest_gemini_event[0] == "failure" and (
        latest_successful_query is None
        or latest_gemini_event[1] > latest_successful_query
    ):
        gemini_status = "degraded"
        gemini_message = "The latest recorded Gemini request failed."
    elif latest_successful_query is not None:
        gemini_status = "healthy"
        gemini_message = "The latest grounded query completed successfully."
    else:
        gemini_status = "unknown"
        gemini_message = "Configured; no successful live query has verified it yet."
    components.append(
        ServiceHealthComponent(
            name="Gemini",
            status=gemini_status,
            message=gemini_message,
        )
    )

    if not database_available:
        overall_status = "Unreachable"
    elif (
        vector_available is False
        or gemini_status in {"degraded", "not_configured"}
        or not telemetry_available
    ):
        overall_status = "Degraded"
    elif gemini_status == "unknown":
        overall_status = "Unknown"
    else:
        overall_status = "Healthy"

    return ServiceStatus(
        overall_status=overall_status,
        checked_at=checked_at.isoformat(),
        components=components,
        queries_last_24h=queries_last_24h,
        successful_queries_last_24h=successful_queries_last_24h,
        failed_queries_last_24h=failed_queries_last_24h,
        average_latency_ms=average_latency_ms,
        answer_tokens_last_24h=answer_tokens_last_24h,
        last_query_at=last_query_at.isoformat() if last_query_at else None,
        telemetry_available=telemetry_available,
    )


def _format_activity_time(dt: datetime) -> str:
    """Format datetime into friendly label like 'Today at 10:42 AM'."""
    now = datetime.now(timezone.utc)
    local_dt = dt.astimezone()
    local_now = now.astimezone()

    if local_dt.date() == local_now.date():
        return f"Today at {local_dt.strftime('%I:%M %p').lstrip('0')}"
    if local_dt.date() == (local_now - timedelta(days=1)).date():
        return f"Yesterday at {local_dt.strftime('%I:%M %p').lstrip('0')}"
    return local_dt.strftime("%b %d at %I:%M %p")


def get_dashboard_overview(
    session: Session,
    settings: Settings | None = None,
    time_range: Literal["6h", "24h", "7d"] = "6h",
) -> DashboardOverviewResponse:
    """Generate all dashboard data for the requested time range."""
    if settings is None:
        settings = get_settings()

    now = datetime.now().astimezone()
    service_status = build_service_status(session, settings)

    # ------------------------------------------------------------------
    # 1. KPIs
    # ------------------------------------------------------------------
    try:
        active_docs = session.scalar(
            select(func.count(DocumentVersionModel.id)).where(
                DocumentVersionModel.status == "active"
            )
        ) or 0
        if active_docs == 0:
            active_docs = session.scalar(select(func.count(DocumentModel.id))) or 0
    except Exception:
        session.rollback()
        active_docs = 0

    try:
        total_chunks = session.scalar(select(func.count(ChunkModel.id))) or 0
    except Exception:
        session.rollback()
        total_chunks = 0

    total_queries = service_status.queries_last_24h

    kpis = DashboardKpi(
        active_documents=active_docs,
        total_chunks=total_chunks,
        total_queries=total_queries,
        system_status=service_status.overall_status,
    )

    # ------------------------------------------------------------------
    # 2. Configuration — sourced from settings, not literals
    # ------------------------------------------------------------------
    embedding_model_name = settings.gemini_embedding_model or "gemini-embedding-001"
    vector_db_label = "PostgreSQL (pgvector)"

    # Pull chunking parameters from settings if present; fall back to the
    # values the chunker actually uses today.
    chunk_size_tokens = getattr(settings, "chunk_size_tokens", 512)
    overlap_tokens = getattr(settings, "chunk_overlap_tokens", 64)
    # ~2.34 chars per token is a reasonable English average; keep it
    # consistent if a dedicated setting exists.
    chunk_size_chars = getattr(
        settings, "chunk_size_chars", int(chunk_size_tokens * 2.34)
    )

    config = RAGConfiguration(
        embedding_model=embedding_model_name,
        vector_database=vector_db_label,
        chunk_size_tokens=chunk_size_tokens,
        chunk_size_chars=chunk_size_chars,
        overlap_tokens=overlap_tokens,
    )

    # ------------------------------------------------------------------
    # 3. Latency buckets — no seeded samples
    # ------------------------------------------------------------------
    buckets: list[LatencyBucket] = []

    if time_range == "6h":
        bucket_count = 6
        step_minutes = 60
        time_format = "%H:00"
    elif time_range == "24h":
        bucket_count = 12
        step_minutes = 120
        time_format = "%H:00"
    else:  # 7d
        bucket_count = 7
        step_minutes = 24 * 60
        time_format = "%a"

    start_anchor = now - timedelta(minutes=bucket_count * step_minutes)

    with _METRICS_LOCK:
        recorded_copy = list(_RECORDED_LATENCIES)

    for i in range(bucket_count):
        b_start = start_anchor + timedelta(minutes=i * step_minutes)
        b_end = b_start + timedelta(minutes=step_minutes)
        label = b_start.strftime(time_format)

        matching = [
            m["latency_ms"]
            for m in recorded_copy
            if b_start <= m["timestamp"] < b_end
        ]

        if matching:
            avg_lat = int(sum(matching) / len(matching))
            cnt = len(matching)
        else:
            avg_lat = 0
            cnt = 0

        buckets.append(
            LatencyBucket(
                label=label,
                timestamp=b_start.isoformat(),
                latency_ms=avg_lat,
                query_count=cnt,
            )
        )

    # ------------------------------------------------------------------
    # 4. Recent System Activities — only real events
    # ------------------------------------------------------------------
    activities: list[ActivityItem] = []

    try:
        recent_docs = session.execute(
            select(DocumentModel.title, DocumentModel.created_at)
            .order_by(DocumentModel.created_at.desc())
            .limit(5)
        ).all()
        for doc in recent_docs:
            activities.append(
                ActivityItem(
                    id=str(uuid4()),
                    type="success",
                    title=f"Indexed document '{doc.title}'.",
                    timestamp_label=_format_activity_time(doc.created_at),
                    occurred_at=doc.created_at.isoformat(),
                )
            )
    except Exception:
        session.rollback()

    return DashboardOverviewResponse(
        kpis=kpis,
        configuration=config,
        latency_time_range=time_range,
        latency_buckets=buckets,
        recent_activities=activities,
        document_metrics=build_document_metrics(session),
        embedding_summary=build_embedding_summary(session, settings),
        service_status=service_status,
    )