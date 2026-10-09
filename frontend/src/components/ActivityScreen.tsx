import { useEffect, useRef, useState } from "react";
import type { TransitionEvent } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Info,
  Layers,
  Maximize2,
  MessageSquare,
  Power,
  PowerOff,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Pencil,
  Check,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import { fetchDashboardOverview } from "../api/dashboard";
import type { DashboardOverview, EmbeddingSummary, ServiceStatus } from "../api/dashboard";
import { fetchFeedbackSummary } from "../api/feedback";
import type { FeedbackRecentItem, FeedbackSummary } from "../api/feedback";
import { clearServiceTelemetry, fetchServiceTelemetry } from "../api/serviceTelemetry";
import type { ServiceTelemetryItem } from "../api/serviceTelemetry";
import { QueryTracePanel } from "./trace/QueryTracePanel";
import {
  deleteManagedDocument,
  DOCUMENT_TYPES,
  fetchManagedDocuments,
  setManagedDocumentVersionActive,
  updateManagedDocumentVersionLabel,
} from "../api/documents";
import type { ManagedDocument, ManagedDocumentVersion } from "../api/documents";
import "./activity.css";

interface ActivityScreenProps {
  isAdmin?: boolean;
  onUnauthenticated?: () => void;
}

interface OverlayBounds {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function ActivityScreen({
  isAdmin = false,
  onUnauthenticated = () => {},
}: ActivityScreenProps) {
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerClosing, setManagerClosing] = useState(false);
  const [managerBounds, setManagerBounds] = useState<OverlayBounds | null>(null);
  const [managerTarget, setManagerTarget] = useState<
    "documents" | "embeddings" | "traces" | "status" | "feedback" | "usage"
  >("documents");
  const [feedbackExpanded, setFeedbackExpanded] = useState(false);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [feedbackData, setFeedbackData] = useState<FeedbackSummary | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackFilter, setFeedbackFilter] = useState<{
    days: number;
    rating: "up" | "down" | null;
    reason: string | null;
  }>({ days: 7, rating: null, reason: null });
  const activityRootRef = useRef<HTMLDivElement>(null);
  const knowledgeBaseCardRef = useRef<HTMLDivElement>(null);
  const embeddingsCardRef = useRef<HTMLDivElement>(null);
  const usageMetricsCardRef = useRef<HTMLDivElement>(null);
  const serviceStatusCardRef = useRef<HTMLDivElement>(null);
  const feedbackCardRef = useRef<HTMLDivElement>(null);
  const originalBoundsRef = useRef<OverlayBounds | null>(null);

  async function loadData() {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchDashboardOverview("24h");
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load activity telemetry");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function loadFeedback() {
      setFeedbackLoading(true);
      setFeedbackError(null);
      try {
        const result = await fetchFeedbackSummary({
          days: feedbackFilter.days,
          ...(feedbackFilter.rating === null ? {} : { rating: feedbackFilter.rating }),
          ...(feedbackFilter.reason === null ? {} : { reason: feedbackFilter.reason }),
        });
        if (!cancelled) setFeedbackData(result);
      } catch (loadError) {
        if (!cancelled) {
          setFeedbackError(
            loadError instanceof Error ? loadError.message : "Failed to load feedback summary.",
          );
        }
      } finally {
        if (!cancelled) {
          setFeedbackLoading(false);
          if (feedbackExpanded) {
            timer = setTimeout(() => void loadFeedback(), 30000);
          }
        }
      }
    }

    void loadFeedback();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [feedbackExpanded, feedbackFilter, isAdmin]);

  function openActivityOverlay(
    card: HTMLDivElement | null,
    target: "documents" | "embeddings" | "traces" | "status" | "feedback" | "usage",
  ) {
    const root = activityRootRef.current;
    if (root === null || card === null) return;
    const rootRect = root.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const initialBounds = {
      top: cardRect.top - rootRect.top,
      left: cardRect.left - rootRect.left,
      width: cardRect.width,
      height: cardRect.height,
    };
    originalBoundsRef.current = initialBounds;
    setFeedbackExpanded(target === "feedback");
    setSelectedTraceId(null);
    setManagerTarget(target);
    setManagerBounds(initialBounds);
    setManagerOpen(true);
    setManagerClosing(false);
    requestAnimationFrame(() => {
      setManagerBounds({
        top: 0,
        left: 0,
        width: rootRect.width,
        height: rootRect.height,
      });
    });
  }

  function closeDocumentsManager() {
    if (originalBoundsRef.current === null) {
      setManagerOpen(false);
      setSelectedTraceId(null);
      return;
    }
    setManagerClosing(true);
    setManagerBounds(originalBoundsRef.current);
  }

  function finishManagerClose(event: TransitionEvent<HTMLDivElement>) {
    if (managerClosing && event.target === event.currentTarget && event.propertyName === "height") {
      setManagerOpen(false);
      setFeedbackExpanded(false);
      setManagerClosing(false);
      setManagerBounds(null);
      void loadData();
    }
  }

  return (
    <div className="activity-screen" ref={activityRootRef}>
      {/* Page Header */}
      <div className="activity-heading">
        <div className="activity-heading__titles">
          <h1>System Activity &amp; Health</h1>
          <p>Live knowledge base statistics, service health, and operational activity logs.</p>
        </div>
        <div>
          <button
            type="button"
            className="dashboard-refresh-btn"
            disabled={loading}
            onClick={() => void loadData()}
            title="Refresh activity data"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="users-panel__error" role="alert">
          <p>{error}</p>
        </div>
      ) : null}

      {/* Extensible KPI Cards Grid: Resizes gracefully with future additions */}
      <div className="activity-kpi-grid">
        {/* Card 1: Active Documents */}
        <div className="activity-card" ref={knowledgeBaseCardRef}>
          <div className="activity-card__top">
            <div className="activity-card__label-group">
              <span className="activity-card__label">Knowledge Base</span>
              <span className="activity-card__value">
                {data ? data.kpis.active_documents : "—"}
              </span>
            </div>
            <div className="activity-card__tools">
              {isAdmin ? (
                <button
                  type="button"
                  className="activity-card__maximize"
                  aria-label="Maximize uploaded documents"
                  title="Manage uploaded documents"
                  onClick={() => openActivityOverlay(knowledgeBaseCardRef.current, "documents")}
                >
                  <Maximize2 size={17} aria-hidden="true" />
                </button>
              ) : null}
              <div className="activity-card__icon activity-card__icon--docs">
                <FileText size={24} />
              </div>
            </div>
          </div>
          <p className="activity-card__desc">
            Approved and versioned Documents indexed for grounded retrieval.
          </p>
          <div className="activity-card__footer">
            <span>Indexed Documents</span>
            <span className="activity-card__tag">Active</span>
          </div>
        </div>

        {/* Card 2: Indexed Chunks */}
        <div className="activity-card" ref={embeddingsCardRef}>
          <div className="activity-card__top">
            <div className="activity-card__label-group">
              <span className="activity-card__label">Vector Embeddings</span>
              <span className="activity-card__value">
                {data ? data.kpis.total_chunks : "—"}
              </span>
            </div>
            <div className="activity-card__tools">
              <button
                type="button"
                className="activity-card__maximize"
                aria-label="Maximize vector embeddings"
                title="View embedding details"
                onClick={() => openActivityOverlay(embeddingsCardRef.current, "embeddings")}
              >
                <Maximize2 size={17} aria-hidden="true" />
              </button>
              <div className="activity-card__icon activity-card__icon--chunks">
                <Layers size={24} />
              </div>
            </div>
          </div>
          <p className="activity-card__desc">
            Deterministic chunk fragments vectorised and indexed in PostgreSQL pgvector.
          </p>
          <div className="activity-card__footer">
            <span>Searchable Chunks</span>
            <span className="activity-card__tag">768 Dim</span>
          </div>
        </div>

        {/* Card 3: Queries Processed */}
        <div className="activity-card" ref={usageMetricsCardRef}>
          <div className="activity-card__top">
            <div className="activity-card__label-group">
              <span className="activity-card__label">Usage Metrics</span>
              <span className="activity-card__value">
                {data ? data.kpis.total_queries : "—"}
              </span>
            </div>
            <div className="activity-card__tools">
              {isAdmin ? (
                <button
                  type="button"
                  className="activity-card__maximize"
                  aria-label="Maximize usage metrics"
                  title="Inspect recent usage metrics"
                  onClick={() => openActivityOverlay(usageMetricsCardRef.current, "usage")}
                >
                  <Maximize2 size={17} aria-hidden="true" />
                </button>
              ) : null}
              <div className="activity-card__icon activity-card__icon--queries">
                <MessageSquare size={24} />
              </div>
            </div>
          </div>
          <p className="activity-card__desc">
            Total HR queries answered with validated citations through hybrid retrieval.
          </p>
          <div className="activity-card__footer">
            <span>Questions Handled</span>
            <span className="activity-card__tag">RRF k=10</span>
          </div>
        </div>

        {/* Card 4: System Operational Health */}
        <div className="activity-card" ref={serviceStatusCardRef}>
          <div className="activity-card__top">
            <div className="activity-card__label-group">
              <span className="activity-card__label">Service Status</span>
              <div
                className={`activity-card__status-pill${data?.service_status?.overall_status ? ` activity-card__status-pill--${data.service_status.overall_status.toLowerCase()}` : ""}`}
              >
                <span
                  className={`activity-card__status-dot${data?.service_status?.overall_status ? ` activity-card__status-dot--${data.service_status.overall_status.toLowerCase()}` : ""}`}
                />
                <span>{data?.service_status?.overall_status ?? data?.kpis?.system_status ?? "Checking"}</span>
              </div>
            </div>
            <div className="activity-card__tools">
              <button
                type="button"
                className="activity-card__maximize"
                aria-label="Maximize service status"
                title="View service health details"
                onClick={() => openActivityOverlay(serviceStatusCardRef.current, "status")}
              >
                <Maximize2 size={17} aria-hidden="true" />
              </button>
              <div className="activity-card__icon activity-card__icon--health">
                <ShieldCheck size={24} />
              </div>
            </div>
          </div>
          <p className="activity-card__desc">
            PostgreSQL, pgvector, Gemini configuration, and persisted request health.
          </p>
          <div className="activity-card__footer">
            <span>Queries · last 24h</span>
            <span className="activity-card__tag">
              {data?.service_status?.queries_last_24h !== undefined
                ? data.service_status.queries_last_24h.toLocaleString()
                : "—"}
            </span>
          </div>
        </div>
        {isAdmin ? (
          <div className="activity-card" ref={feedbackCardRef}>
            <div className="activity-card__top">
              <div className="activity-card__label-group">
                <span className="activity-card__label">Feedback</span>
                <span className="activity-card__value">
                  {feedbackData === null
                    ? feedbackLoading ? "—" : "0%"
                    : `${Math.round(feedbackData.up_rate * 100)}%`}
                </span>
              </div>
              <div className="activity-card__tools">
                <button
                  type="button"
                  className="activity-card__maximize"
                  aria-label="Maximize feedback"
                  title="View feedback details"
                  onClick={() => openActivityOverlay(feedbackCardRef.current, "feedback")}
                >
                  <Maximize2 size={17} aria-hidden="true" />
                </button>
                <div className="activity-card__icon activity-card__icon--queries">
                  <ThumbsUp size={22} aria-hidden="true" />
                </div>
              </div>
            </div>
            <p className="activity-card__desc">
              {feedbackData === null
                ? feedbackLoading
                  ? "Loading ratings…"
                  : feedbackError ?? "No ratings yet"
                : feedbackData.total === 0
                  ? "No ratings yet"
                  : `${feedbackData.up} of ${feedbackData.total} rated answers positive`}
            </p>
            <div className="activity-card__footer">
              <span>Helpfulness</span>
              <span>{feedbackData?.down ?? 0} thumbs down</span>
            </div>
          </div>
        ) : null}
      </div>

      {!isAdmin ? <section className="activity-documents-section" aria-labelledby="activity-documents-title">
        <div className="activity-documents-header">
          <div className="activity-documents-heading">
            <FileText size={18} aria-hidden="true" />
            <h2 id="activity-documents-title">Uploaded Documents</h2>
          </div>
          <span className="activity-documents-count">
            {data?.document_metrics?.total ?? 0} total
          </span>
        </div>
        {data?.document_metrics?.documents?.length ? (
          <ul className="activity-documents-list">
            {data.document_metrics.documents.map((document) => (
              <li className="activity-document-row" key={document.id}>
                <div className="activity-document-main">
                  <span className="activity-document-title" title={document.title}>
                    {document.title}
                  </span>
                  <span className="activity-document-type">{document.document_type}</span>
                </div>
                <span className="activity-document-status">{document.status}</span>
                <time
                  className="activity-document-date"
                  dateTime={document.created_at}
                >
                  {formatDocumentDate(document.created_at)}
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="activity-documents-empty">
            {data?.document_metrics
              ? "No uploaded documents found."
              : "Document list is loading."}
          </p>
        )}
      </section> : null}

      {/* Detailed Activity Feed */}
      <div className="activity-feed-section">
        <div className="activity-feed-header">
          <div className="dash-card__title-group">
            <Activity size={18} className="dash-card__header-icon" />
            <h2>Recent System Activities &amp; Events</h2>
          </div>
        </div>

        <div className="activity-list">
          {data && data.recent_activities.length > 0 ? (
            data.recent_activities.map((act) => {
              const IconComp =
                act.type === "warning"
                  ? AlertTriangle
                  : act.type === "info"
                    ? Info
                    : CheckCircle2;
              const typeClass =
                act.type === "warning"
                  ? "activity-icon-wrap--warning"
                  : act.type === "info"
                    ? "activity-icon-wrap--info"
                    : "activity-icon-wrap--success";

              return (
                <div key={act.id} className="activity-item">
                  <div className={`activity-icon-wrap ${typeClass}`}>
                    <IconComp size={16} />
                  </div>
                  <div className="activity-content">
                    <span className="activity-title">{act.title}</span>
                    <span className="activity-time">{act.timestamp_label}</span>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="chat__empty">No operational events recorded yet.</p>
          )}
        </div>
      </div>
      {managerOpen && managerBounds !== null ? (
        <div
          className="activity-documents-manager"
          style={{
            top: managerBounds.top,
            left: managerBounds.left,
            width: managerBounds.width,
            height: managerBounds.height,
          }}
          onTransitionEnd={finishManagerClose}
        >
          <div className="activity-documents-manager__header">
            <div className="activity-documents-heading">
              {managerTarget === "documents" ? (
                <FileText size={18} aria-hidden="true" />
              ) : managerTarget === "embeddings" ? (
                <Layers size={18} aria-hidden="true" />
              ) : managerTarget === "status" ? (
                <ShieldCheck size={18} aria-hidden="true" />
              ) : managerTarget === "feedback" ? (
                <ThumbsUp size={18} aria-hidden="true" />
              ) : managerTarget === "usage" ? (
                <Activity size={18} aria-hidden="true" />
              ) : (
                <MessageSquare size={18} aria-hidden="true" />
              )}
              <h2>
                {managerTarget === "documents"
                  ? "Uploaded Documents"
                  : managerTarget === "embeddings"
                    ? "Vector Embeddings"
                    : managerTarget === "status"
                      ? "Service Status"
                      : managerTarget === "feedback"
                        ? "Feedback"
                      : managerTarget === "traces"
                        ? "Usage Metrics · Query Traces"
                        : "Usage Metrics"}
              </h2>
            </div>
            <button
              type="button"
              className="activity-documents-manager__close"
              aria-label={`Close ${managerTarget === "documents" ? "uploaded documents" : managerTarget === "embeddings" ? "vector embeddings" : managerTarget === "status" ? "service status" : managerTarget === "feedback" ? "feedback" : managerTarget === "traces" ? "query traces" : "usage metrics"}`}
              onClick={() => {
                setFeedbackExpanded(false);
                setSelectedTraceId(null);
                closeDocumentsManager();
              }}
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          {managerTarget === "embeddings" ? (
            <EmbeddingDetails summary={data?.embedding_summary} />
          ) : managerTarget === "status" ? (
            <ServiceStatusDetails status={data?.service_status} />
          ) : managerTarget === "traces" ? (
            <QueryTracePanel
              onUnauthenticated={onUnauthenticated}
              initialSelectedId={selectedTraceId}
            />
          ) : managerTarget === "feedback" ? (
            <FeedbackDetails
              data={feedbackData}
              error={feedbackError}
              filter={feedbackFilter}
              loading={feedbackLoading}
              onFilterChange={setFeedbackFilter}
              onOpenTrace={(traceId) => {
                setSelectedTraceId(traceId);
                setManagerTarget("traces");
              }}
            />
          ) : managerTarget === "usage" ? (
            <UsageTelemetryPanel
              onUnauthenticated={onUnauthenticated}
              onCleared={() => void loadData()}
            />
          ) : (
            <ManagedDocumentsPanel
              onUnauthenticated={onUnauthenticated}
              onChanged={() => void loadData()}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

function ServiceStatusDetails({ status }: { status: ServiceStatus | undefined }) {
  if (status === undefined) {
    return <p className="activity-documents-empty">Service health details are loading.</p>;
  }

  return (
    <div className="activity-service-status">
      <div className="activity-service-status__metrics">
        <StatusMetric label="Queries · 24h" value={status.queries_last_24h.toLocaleString()} />
        <StatusMetric
          label="Successful"
          value={status.successful_queries_last_24h.toLocaleString()}
        />
        <StatusMetric label="Failed" value={status.failed_queries_last_24h.toLocaleString()} />
        <StatusMetric label="Average latency" value={`${status.average_latency_ms} ms`} />
        <StatusMetric
          label="Answer tokens · 24h"
          value={status.answer_tokens_last_24h?.toLocaleString() ?? "—"}
        />
      </div>

      <h3 className="activity-embeddings-section-title">Service health</h3>
      <ul className="activity-service-status__components">
        {status.components.map((component) => (
          <li className="activity-service-status__component" key={component.name}>
            <span
              className={`activity-service-status__indicator activity-service-status__indicator--${component.status}`}
              aria-hidden="true"
            />
            <div className="activity-service-status__component-copy">
              <div className="activity-service-status__component-title">
                <strong>{component.name}</strong>
                <span>{component.status.replaceAll("_", " ")}</span>
              </div>
              <p>{component.message}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="activity-service-status__timestamps">
        <span>Checked {formatServiceTimestamp(status.checked_at)}</span>
        <span>
          Last query {status.last_query_at ? formatServiceTimestamp(status.last_query_at) : "—"}
        </span>
      </div>

      {!status.telemetry_available ? (
        <p className="activity-service-status__notice" role="status">
          Historical usage is unavailable until database migration 0010_service_telemetry is
          applied.
        </p>
      ) : null}
    </div>
  );
}

const FEEDBACK_REASON_LABELS: Record<string, string> = {
  wrong_answer: "Answer was wrong",
  incomplete: "Answer was incomplete",
  wrong_document: "Wrong document cited",
  off_topic: "Didn't answer my question",
  other: "Other",
};

function FeedbackDetails({
  data,
  error,
  filter,
  loading,
  onFilterChange,
  onOpenTrace,
}: {
  data: FeedbackSummary | null;
  error: string | null;
  filter: { days: number; rating: "up" | "down" | null; reason: string | null };
  loading: boolean;
  onFilterChange: (filter: {
    days: number;
    rating: "up" | "down" | null;
    reason: string | null;
  }) => void;
  onOpenTrace: (traceId: string) => void;
}) {
  const up = data?.up ?? 0;
  const down = data?.down ?? 0;
  const total = data?.total ?? 0;
  const upWidth = total > 0 ? `${(up / total) * 100}%` : "0%";
  const downWidth = total > 0 ? `${(down / total) * 100}%` : "0%";

  return (
    <div className="activity-documents-manager__body activity-feedback">
      <p className="activity-embeddings-subtitle">
        Last {filter.days} days · {total} rated answers
      </p>
      <div className="activity-feedback__filters">
        <label>
          <span className="sr-only">Filter feedback by period</span>
          <select
            value={filter.days}
            onChange={(event) =>
              onFilterChange({ ...filter, days: Number(event.target.value) })
            }
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Filter feedback by rating</span>
          <select
            value={filter.rating ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              const nextRating = value === "" ? null : value === "up" ? "up" : "down";
              onFilterChange({
                ...filter,
                rating: nextRating,
                reason: nextRating === "down" ? filter.reason : null,
              });
            }}
          >
            <option value="">All ratings</option>
            <option value="up">Thumbs up only</option>
            <option value="down">Thumbs down only</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Filter feedback by reason</span>
          <select
            disabled={filter.rating !== "down"}
            value={filter.reason ?? ""}
            onChange={(event) =>
              onFilterChange({
                ...filter,
                reason: event.target.value === "" ? null : event.target.value,
              })
            }
          >
            <option value="">Any reason</option>
            <option value="wrong_answer">Answer was wrong</option>
            <option value="incomplete">Answer was incomplete</option>
            <option value="wrong_document">Wrong document cited</option>
            <option value="off_topic">Didn't answer my question</option>
            <option value="other">Other</option>
          </select>
        </label>
      </div>

      {error !== null ? (
        <p className="activity-documents-error activity-feedback__error" role="alert">{error}</p>
      ) : null}
      {loading && data === null ? (
        <p className="activity-documents-empty">Loading feedback…</p>
      ) : null}

      <section className="activity-feedback__summary" aria-label="Feedback summary">
        <div className="activity-feedback__stats">
          <div className="activity-feedback__stat">
            <p>👍 Positive</p>
            <p>
              {up} <span>({Math.round((data?.up_rate ?? 0) * 100)}%)</span>
            </p>
          </div>
          <div className="activity-feedback__stat">
            <p>👎 Negative</p>
            <p>{down}</p>
          </div>
        </div>
        <div
          className="activity-feedback__split"
          role="img"
          aria-label={`${up} positive and ${down} negative ratings`}
        >
          <div className="activity-feedback__split-up" style={{ width: upWidth }} />
          <div className="activity-feedback__split-down" style={{ width: downWidth }} />
        </div>
        {down > 0 && Object.keys(data?.by_reason ?? {}).length > 0 ? (
          <div className="activity-feedback__reasons">
            <h3 className="activity-embeddings-section-title">Thumbs-down reasons</h3>
            <ul>
              {Object.entries(data?.by_reason ?? {}).map(([reason, count]) => (
                <li key={reason}>
                  <span>{FEEDBACK_REASON_LABELS[reason] ?? reason}</span>
                  <span className="tabular-nums">{count}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="activity-feedback__recent" aria-label="Recent feedback">
        <h3 className="activity-embeddings-section-title">Recent feedback</h3>
        {data?.recent.length ? (
          <ul className="activity-feedback__list">
            {data.recent.map((item) => (
              <FeedbackRecentRow
                item={item}
                key={`${item.trace_id}:${item.created_at}`}
                onOpenTrace={onOpenTrace}
              />
            ))}
          </ul>
        ) : (
          <p className="activity-documents-empty">
            {loading ? "Loading feedback…" : "No feedback in this period."}
          </p>
        )}
      </section>
    </div>
  );
}

function FeedbackRecentRow({
  item,
  onOpenTrace,
}: {
  item: FeedbackRecentItem;
  onOpenTrace: (traceId: string) => void;
}) {
  const isPositive = item.rating === "up";
  return (
    <li>
      <button
      className="activity-feedback__row"
        onClick={() => onOpenTrace(item.trace_id)}
        title={item.question_full}
        type="button"
      >
        <span
          className={`activity-feedback__rating ${
            isPositive ? "activity-feedback__rating--up" : "activity-feedback__rating--down"
          }`}
          aria-label={isPositive ? "Thumbs up" : "Thumbs down"}
        >
          {isPositive
            ? <ThumbsUp size={17} aria-hidden="true" />
            : <ThumbsDown size={17} aria-hidden="true" />}
        </span>
        <span className="activity-feedback__copy">
          <span className="activity-feedback__question">
            {item.question_preview}
          </span>
          <span className="activity-feedback__meta">
            {item.reason === null
              ? item.user_email
              : `${FEEDBACK_REASON_LABELS[item.reason] ?? item.reason} · ${item.user_email}`}
          </span>
          {item.comment ? (
            <span className="activity-feedback__note" title={item.comment}>
              “{item.comment}”
            </span>
          ) : null}
        </span>
        <time
          className="activity-feedback__date"
          dateTime={item.created_at}
        >
          {formatServiceTimestamp(item.created_at)}
        </time>
      </button>
    </li>
  );
}

function UsageTelemetryPanel({
  onUnauthenticated,
  onCleared,
}: {
  onUnauthenticated: () => void;
  onCleared: () => void;
}) {
  const [records, setRecords] = useState<ServiceTelemetryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchServiceTelemetry()
      .then((result) => {
        if (cancelled) return;
        setRecords(result.records);
        setTotal(result.total);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        const message = loadError instanceof Error
          ? loadError.message
          : "Failed to load usage metrics.";
        setError(message);
        if (message.includes("(401)") || message.includes("(403)")) onUnauthenticated();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onUnauthenticated]);

  async function clearMetrics() {
    const confirmed = window.confirm(
      `Permanently delete all stored usage telemetry, including records older than 24 hours? This cannot be undone. ${total} events are currently recorded in the last 24 hours.`,
    );
    if (!confirmed) return;
    setClearing(true);
    setError(null);
    setNotice(null);
    try {
      const deleted = await clearServiceTelemetry();
      setRecords([]);
      setTotal(0);
      onCleared();
      setNotice(`${deleted} usage telemetry events were permanently deleted.`);
    } catch (clearError) {
      const message = clearError instanceof Error
        ? clearError.message
        : "Failed to clear usage metrics.";
      setError(message);
      if (message.includes("(401)") || message.includes("(403)")) onUnauthenticated();
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="activity-documents-manager__body activity-usage">
      <div className="activity-usage__toolbar">
        <p>
          Last 24 hours · {total} {total === 1 ? "request" : "requests"}
          {records.length < total ? ` · showing latest ${records.length}` : ""}
        </p>
        <button
          className="activity-usage__clear"
          disabled={clearing || loading || total === 0}
          onClick={() => void clearMetrics()}
          type="button"
        >
          <Trash2 size={15} aria-hidden="true" />
          {clearing ? "Clearing…" : "Clear Usage Metrics"}
        </button>
      </div>
      {error !== null ? (
        <p className="activity-documents-error" role="alert">{error}</p>
      ) : null}
      {notice !== null ? (
        <p className="activity-usage__notice" role="status">{notice}</p>
      ) : null}
      {loading ? (
        <p className="activity-documents-empty">Loading usage metrics…</p>
      ) : records.length > 0 ? (
        <ul className="activity-usage__list" aria-label="Usage telemetry from the last 24 hours">
          {records.map((record) => (
            <li className="activity-usage__row" key={record.id}>
              <span className={`activity-usage__status activity-usage__status--${record.status}`}>
                {record.status}
              </span>
              <span className="activity-usage__main">
                <strong>{record.component}</strong>
                <span>
                  {record.latency_ms.toLocaleString()} ms
                  {record.token_usage === null
                    ? ""
                    : ` · ${record.token_usage.toLocaleString()} tokens`}
                  {record.failure_code === null ? "" : ` · ${record.failure_code}`}
                </span>
              </span>
              <time dateTime={record.created_at}>
                {formatServiceTimestamp(record.created_at)}
              </time>
            </li>
          ))}
        </ul>
      ) : (
        <p className="activity-documents-empty">No usage telemetry in the last 24 hours.</p>
      )}
    </div>
  );
}

function StatusMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="activity-service-status__metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatServiceTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

const EMBEDDING_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ef4444",
  "#14b8a6",
  "#f97316",
  "#6366f1",
  "#84cc16",
  "#ec4899",
];

function embeddingColor(index: number): string {
  return EMBEDDING_COLORS[index % EMBEDDING_COLORS.length] ?? "#3b82f6";
}

function EmbeddingDetails({ summary }: { summary: EmbeddingSummary | undefined }) {
  if (summary === undefined) {
    return <p className="activity-documents-empty">Embedding details are loading.</p>;
  }

  if (summary.total === 0) {
    return (
      <div className="activity-embeddings-detail">
        <p className="activity-documents-empty">
          No embeddings yet. Upload documents to populate the index.
        </p>
      </div>
    );
  }

  const maximumChunkCount = Math.max(
    0,
    ...summary.by_document.map((document) => document.chunk_count),
  );
  const cells: Array<{ key: string; title: string; color: string }> = [];
  for (const [documentIndex, document] of summary.by_document.entries()) {
    const color = embeddingColor(documentIndex);
    for (
      let chunkIndex = 0;
      chunkIndex < document.chunk_count && cells.length < 500;
      chunkIndex += 1
    ) {
      cells.push({
        key: `${document.document_id}:${chunkIndex}`,
        title: document.title,
        color,
      });
    }
    if (cells.length === 500) break;
  }

  return (
    <div className="activity-documents-manager__body">
      <div className="activity-embeddings-detail">
        <p className="activity-embeddings-subtitle">
          {summary.total} chunks across {summary.by_document.length} documents ·{" "}
          {summary.model_name} · {summary.dimension} dim
        </p>

        {summary.by_document.length > 0 ? (
          <section aria-label="Distribution by document">
            <h3 className="activity-embeddings-section-title">Distribution by document</h3>
            {summary.by_document.map((document) => {
              const width =
                maximumChunkCount > 0
                  ? (document.chunk_count / maximumChunkCount) * 100
                  : 0;
              return (
                <div className="activity-embeddings-bar" key={document.document_id}>
                  <span className="activity-embeddings-bar__title" title={document.title}>
                    {document.title}
                  </span>
                  <div className="activity-embeddings-bar__track">
                    <div
                      className="activity-embeddings-bar__fill"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                  <span className="activity-embeddings-bar__count">
                    {document.chunk_count}
                  </span>
                </div>
              );
            })}
          </section>
        ) : null}

        <section aria-label="Each chunk in the corpus">
          <h3 className="activity-embeddings-section-title">Each chunk in the corpus</h3>
          <div className="activity-embeddings-grid">
            {cells.map((cell) => (
              <span
                className="activity-embeddings-cell"
                key={cell.key}
                title={cell.title}
                style={{ backgroundColor: cell.color }}
              />
            ))}
          </div>
          {summary.total > 500 ? (
            <p className="activity-embeddings-more">
              + {summary.total - 500} more not shown
            </p>
          ) : null}
        </section>

        {summary.by_document.length > 0 ? (
          <section aria-label="Color key">
            <h3 className="activity-embeddings-section-title">Color key</h3>
            <div className="activity-embeddings-legend">
              {summary.by_document.map((document, index) => (
                <span className="activity-embeddings-legend__item" key={document.document_id}>
                  <span
                    className="activity-embeddings-legend__dot"
                    style={{
                      backgroundColor: embeddingColor(index),
                    }}
                  />
                  <span>{document.title}</span>
                  <span>{document.chunk_count}</span>
                </span>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

interface ManagedDocumentsPanelProps {
  onUnauthenticated: () => void;
  onChanged: () => void;
}

function ManagedDocumentsPanel({
  onUnauthenticated,
  onChanged,
}: ManagedDocumentsPanelProps) {
  const [documents, setDocuments] = useState<ManagedDocument[]>([]);
  const [loadingDocuments, setLoadingDocuments] = useState(true);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [versionFilter, setVersionFilter] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingVersionId, setEditingVersionId] = useState<string | null>(null);
  const [editingVersionLabel, setEditingVersionLabel] = useState("");

  async function loadDocuments() {
    try {
      setLoadingDocuments(true);
      setDocumentError(null);
      setDocuments(await fetchManagedDocuments());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load uploaded documents.";
      setDocumentError(message);
      if (message.includes("(401)")) onUnauthenticated();
    } finally {
      setLoadingDocuments(false);
    }
  }

  useEffect(() => {
    void loadDocuments();
  }, []);

  async function toggleVersion(documentId: string, version: ManagedDocumentVersion) {
    const operationId = `${documentId}:${version.id}`;
    setBusyId(operationId);
    setDocumentError(null);
    try {
      await setManagedDocumentVersionActive(
        documentId,
        version.id,
        version.status !== "active",
      );
      await loadDocuments();
      onChanged();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not update document status.";
      setDocumentError(message);
      if (message.includes("(401)")) onUnauthenticated();
    } finally {
      setBusyId(null);
    }
  }

  async function saveVersionLabel(documentId: string, version: ManagedDocumentVersion) {
    const versionLabel = editingVersionLabel.trim();
    if (!versionLabel || versionLabel === version.version_label) {
      setEditingVersionId(null);
      return;
    }
    const operationId = `${documentId}:${version.id}`;
    setBusyId(operationId);
    setDocumentError(null);
    try {
      await updateManagedDocumentVersionLabel(documentId, version.id, versionLabel);
      setEditingVersionId(null);
      await loadDocuments();
      onChanged();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not change document version.";
      setDocumentError(message);
      if (message.includes("(401)")) onUnauthenticated();
    } finally {
      setBusyId(null);
    }
  }

  async function removeDocument(document: ManagedDocument) {
    if (!window.confirm(`Delete "${document.title}" and all its versions? This cannot be undone.`)) return;
    setBusyId(document.id);
    setDocumentError(null);
    try {
      await deleteManagedDocument(document.id);
      await loadDocuments();
      onChanged();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not delete document.";
      setDocumentError(message);
      if (message.includes("(401)")) onUnauthenticated();
    } finally {
      setBusyId(null);
    }
  }

  const versions = Array.from(
    new Set(documents.flatMap((document) => document.versions.map((version) => version.version_label))),
  ).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredDocuments: Array<{
    document: ManagedDocument;
    version: ManagedDocumentVersion | null;
  }> = [];
  for (const document of documents) {
    const matchesType = typeFilter === "" || document.document_type === typeFilter;
    if (!matchesType) continue;

    const matchesDocumentSearch =
      normalizedSearch === "" ||
      `${document.title} ${document.document_type}`.toLocaleLowerCase().includes(normalizedSearch);
    const matchingVersions = document.versions.filter((version) =>
      (versionFilter === "" || version.version_label === versionFilter) &&
      (
        matchesDocumentSearch ||
        `${document.title} ${document.document_type} ${version.version_label} ${version.status}`
          .toLocaleLowerCase()
          .includes(normalizedSearch)
      ),
    );
    if (document.versions.length === 0) {
      if (matchesDocumentSearch && versionFilter === "") {
        filteredDocuments.push({ document, version: null });
      }
      continue;
    }
    for (const version of matchingVersions) {
      filteredDocuments.push({ document, version });
    }
  }

  return (
    <div className="activity-documents-manager__body">
      <div className="activity-documents-filters">
        <label className="activity-documents-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Search documents</span>
          <input
            type="search"
            placeholder="Search documents"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Filter by document type</span>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="">All types</option>
            {DOCUMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by version</span>
          <select value={versionFilter} onChange={(event) => setVersionFilter(event.target.value)}>
            <option value="">All versions</option>
            {versions.map((version) => <option key={version} value={version}>{version}</option>)}
          </select>
        </label>
        <span className="activity-documents-count">{filteredDocuments.length} documents</span>
      </div>
      {documentError !== null ? <p className="activity-documents-error" role="alert">{documentError}</p> : null}
      {loadingDocuments ? (
        <p className="activity-documents-empty">Loading uploaded documents…</p>
      ) : filteredDocuments.length === 0 ? (
        <p className="activity-documents-empty">No documents match these filters.</p>
      ) : (
        <ul className="activity-managed-documents">
          {filteredDocuments.map(({ document, version }) => (
            <li className="activity-managed-document" key={`${document.id}:${version?.id ?? "no-version"}`}>
              <div className="activity-managed-document__details">
                <strong title={document.title}>{document.title}</strong>
                <span>{document.document_type} · {formatDocumentDate(document.created_at)}</span>
                {version !== null && editingVersionId === version.id ? (
                  <form
                    className="activity-managed-document__version-editor"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveVersionLabel(document.id, version);
                    }}
                  >
                    <input
                      aria-label={`Version label for ${document.title}`}
                      maxLength={80}
                      minLength={1}
                      required
                      value={editingVersionLabel}
                      onChange={(event) => setEditingVersionLabel(event.target.value)}
                    />
                    <button
                      type="submit"
                      aria-label="Save version label"
                      disabled={busyId !== null || editingVersionLabel.trim() === ""}
                    >
                      <Check size={15} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label="Cancel version label edit"
                      disabled={busyId !== null}
                      onClick={() => setEditingVersionId(null)}
                    >
                      <X size={15} aria-hidden="true" />
                    </button>
                  </form>
                ) : version !== null ? (
                  <span className={`activity-document-status activity-document-status--${version.status}`}>
                    {version.version_label} · {version.status}
                  </span>
                ) : <span className="activity-document-status">No version</span>}
              </div>
              <div className="activity-managed-document__actions">
                {version !== null ? (
                  <>
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => {
                      setEditingVersionId(version.id);
                      setEditingVersionLabel(version.version_label);
                    }}
                    title="Change version label"
                  >
                    <Pencil size={15} aria-hidden="true" />Version
                  </button>
                  <button
                    type="button"
                    disabled={busyId !== null || version.status === "failed"}
                    onClick={() => void toggleVersion(document.id, version)}
                    title={version.status === "active" ? "Deactivate version" : "Activate version"}
                  >
                    {version.status === "active"
                      ? <><PowerOff size={15} aria-hidden="true" />Deactivate</>
                      : <><Power size={15} aria-hidden="true" />Activate</>}
                  </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="activity-managed-document__delete"
                  disabled={busyId !== null}
                  onClick={() => void removeDocument(document)}
                  title="Delete document and all versions"
                >
                  <Trash2 size={15} aria-hidden="true" />Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatDocumentDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}
