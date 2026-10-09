"""Bounded, process-local storage for recent admin-inspectable query traces."""

from __future__ import annotations

from collections import deque
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from app.core.logging import get_logger
from threading import Lock

from app.schemas.query_trace import QueryTrace, QueryTraceSummary

MAX_QUERY_TRACES = 100
_LOCK = Lock()
_TRACES: deque[QueryTrace] = deque(maxlen=MAX_QUERY_TRACES)


_WRITER: ContextVar[Callable[[QueryTrace], str] | None] = ContextVar("query_trace_writer", default=None)

@contextmanager
def persistent_trace_capture(writer: Callable[[QueryTrace], str]) -> Iterator[None]:
    token = _WRITER.set(writer)
    try:
        yield
    finally:
        _WRITER.reset(token)


def record_query_trace(trace: QueryTrace) -> str | None:
    """Keep only the most recent traces to bound memory use."""
    with _LOCK:
        _TRACES.appendleft(trace)
    writer = _WRITER.get()
    if writer is None:
        return None
    try:
        return writer(trace)
    except Exception:
        get_logger("services.query_traces").warning("Persistent query trace write failed")
        return None


def list_query_traces() -> list[QueryTraceSummary]:
    """Return recent trace summaries, newest first."""
    with _LOCK:
        return [
            QueryTraceSummary(
                id=trace.id,
                created_at=trace.created_at,
                question=trace.question,
            )
            for trace in _TRACES
        ]


def get_query_trace(trace_id: str) -> QueryTrace | None:
    """Look up one trace by its opaque identifier."""
    with _LOCK:
        return next((trace for trace in _TRACES if trace.id == trace_id), None)