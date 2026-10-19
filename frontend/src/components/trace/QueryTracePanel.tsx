import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, Check, Clock3 } from "lucide-react";
import {
  fetchQueryTrace,
  fetchQueryTraces,
} from "../../api/queryTraces";
import type { QueryTrace, QueryTraceSummary, TraceChunk } from "../../api/queryTraces";
import { AnimatedBar } from "./AnimatedBar";
import { DiffText } from "./DiffText";
import { ErrorBoundary } from "./ErrorBoundary";
import { SankeyFusion } from "./SankeyFusion";

const CONTEXT_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444"];

function safeText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function safeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function traceChunks(value: unknown): TraceChunk[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item: unknown): item is TraceChunk =>
      typeof item === "object" &&
      item !== null &&
      "chunk_id" in item &&
      typeof item.chunk_id === "string",
  );
}

function TraceSection({
  title,
  recorded,
  children,
}: {
  title: string;
  recorded: boolean;
  children: ReactNode;
}) {
  return (
    <section className="trace-section">
      <h3 className="activity-embeddings-section-title">{title}</h3>
      <ErrorBoundary>
        {recorded ? children : <p className="trace-muted">(not recorded)</p>}
      </ErrorBoundary>
    </section>
  );
}

export function QueryTracePanel({
  onUnauthenticated,
  initialSelectedId,
}: {
  onUnauthenticated: () => void;
  initialSelectedId?: string | null;
}) {
  const [traces, setTraces] = useState<QueryTraceSummary[]>([]);
  const [selectedId, setSelectedId] = useState(initialSelectedId ?? "");
  const [trace, setTrace] = useState<QueryTrace | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchQueryTraces()
      .then((items) => {
        if (cancelled) return;
        setTraces(items);
        setSelectedId((current) => current || initialSelectedId || items[0]?.id || "");
      })
      .catch((fetchError: unknown) => {
        if (cancelled) return;
        const message = fetchError instanceof Error ? fetchError.message : "Failed to load traces.";
        setError(message);
        if (message.includes("(401)")) onUnauthenticated();
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialSelectedId, onUnauthenticated]);

  useEffect(() => {
    if (selectedId === "") {
      setTrace(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    setError(null);
    void fetchQueryTrace(selectedId)
      .then((result) => {
        if (!cancelled) setTrace(result);
      })
      .catch((fetchError: unknown) => {
        if (cancelled) return;
        const message = fetchError instanceof Error ? fetchError.message : "Failed to load trace.";
        setError(message);
        if (message.includes("(401)")) onUnauthenticated();
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, onUnauthenticated]);

  return (
    <div className="activity-documents-manager__body trace-browser">
      <aside className="trace-browser__list" aria-label="Recent query traces">
        <h3 className="activity-embeddings-section-title">Recent questions</h3>
        {loadingList ? <p className="trace-muted">Loading traces…</p> : null}
        {!loadingList && traces.length === 0 ? (
          <p className="trace-muted">No query traces recorded yet.</p>
        ) : null}
        {traces.map((item) => (
          <button
            className={`trace-browser__item${selectedId === item.id ? " trace-browser__item--selected" : ""}`}
            key={item.id}
            onClick={() => setSelectedId(item.id)}
            type="button"
          >
            <span>{safeText(item.question) || "Untitled question"}</span>
            <small><Clock3 size={12} aria-hidden="true" />{formatTraceTime(item.created_at)}</small>
          </button>
        ))}
      </aside>
      <div className="trace-browser__detail">
        {error !== null ? <p className="activity-documents-error" role="alert">{error}</p> : null}
        {loadingDetail ? <p className="trace-muted">Loading trace details…</p> : null}
        {!loadingDetail && trace !== null ? <TraceDetail trace={trace} /> : null}
        {!loadingDetail && trace === null && error === null && !loadingList ? (
          <p className="activity-documents-empty">Select a question to inspect its retrieval trace.</p>
        ) : null}
      </div>
    </div>
  );
}

function TraceDetail({ trace }: { trace: QueryTrace }) {
  const expansion = trace.stage_query_expansion;
  const denseStage = trace.stage_dense_retrieval;
  const sparseStage = trace.stage_sparse_retrieval;
  const fusionStage = trace.stage_rrf_fusion;
  const contextStage = trace.stage_context;
  const answerStage = trace.stage_answer;
  const dense = traceChunks(denseStage?.top);
  const sparse = traceChunks(sparseStage?.top);
  const fused = traceChunks(fusionStage?.top);
  const denseTop = dense.slice(0, 10);
  const sparseTop = sparse.slice(0, 10);
  const sparseMax = Math.max(0, ...sparseTop.map((item) => safeNumber(item.rank_score)));
  const contextSources = contextStage?.sources;
  const availableMarkers = answerStage?.available_markers;
  const citedMarkers = answerStage?.cited_markers;
  const citationPassed = answerStage?.citations_valid === true;

  return (
    <div className="trace-detail">
      <TraceSection key={`${trace.id}:question-answer`} title="Question & Answer" recorded={typeof trace.question === "string"}>
        <div className="trace-question-answer">
          <div>
            <span className="trace-inline-label">Question</span>
            <p className="trace-prose">{safeText(trace.question)}</p>
          </div>
          <div>
            <span className="trace-inline-label">Answer</span>
            {answerStage !== undefined ? (
              <p className="trace-prose">{safeText(answerStage.text)}</p>
            ) : (
              <p className="trace-muted">(not recorded)</p>
            )}
          </div>
        </div>
      </TraceSection>

      <TraceSection key={`${trace.id}:expansion`} title="Query expansion" recorded={expansion !== undefined}>
        <p className="trace-muted">Original question: {safeText(expansion?.original)}</p>
        {expansion !== undefined ? (
          <DiffText
            original={safeText(expansion.original)}
            expanded={safeText(expansion.expanded)}
          />
        ) : null}
        {expansion?.succeeded === false ? (
          <p className="trace-warning">Expansion failed; the original question was used for both branches.</p>
        ) : null}
      </TraceSection>

      <TraceSection key={`${trace.id}:dense`} title="Dense retrieval — top 10 by distance" recorded={denseStage !== undefined}>
        <RetrievalRows
          rows={denseTop}
          total={safeNumber(denseStage?.total_returned)}
          score={(item) => safeNumber(item.distance)}
          label={(item) => safeNumber(item.distance).toFixed(4)}
          barValue={(item) => 1 - safeNumber(item.distance)}
          barMax={1}
          color="linear-gradient(90deg, #3b82f6, #06b6d4)"
        />
      </TraceSection>

      <TraceSection key={`${trace.id}:sparse`} title="Sparse retrieval — top 10 by BM25 rank" recorded={sparseStage !== undefined}>
        <RetrievalRows
          rows={sparseTop}
          total={safeNumber(sparseStage?.total_returned)}
          score={(item) => safeNumber(item.rank_score)}
          label={(item) => safeNumber(item.rank_score).toFixed(4)}
          barValue={(item) => safeNumber(item.rank_score)}
          barMax={sparseMax}
          color="linear-gradient(90deg, #f59e0b, #f97316)"
        />
      </TraceSection>

      <TraceSection key={`${trace.id}:fusion`} title="Reciprocal rank fusion — top 5" recorded={fusionStage != null}>
        <SankeyFusion dense={dense.slice(0, 5)} sparse={sparse.slice(0, 5)} fused={fused.slice(0, 5)} />
        <p className="trace-muted">
          k = {safeNumber(fusionStage?.k)}. Left: dense branch. Right: sparse branch. Middle: fused ranking.
        </p>
      </TraceSection>

      <TraceSection key={`${trace.id}:context`} title="Context supplied" recorded={contextStage !== undefined}>
        <div className="trace-context-list">
          {(Array.isArray(contextSources) ? contextSources : []).map((source, index) => (
            <article
              className="trace-context-card"
              key={`${source.marker}:${index}`}
              style={{ borderLeftColor: CONTEXT_COLORS[index % CONTEXT_COLORS.length] }}
            >
              <strong>{safeText(source.marker)} · {safeText(source.document_title)}</strong>
              <p>{safeText(source.content_preview)}</p>
            </article>
          ))}
        </div>
        <p className="trace-muted">
          {safeNumber(contextStage?.chars_used)} of {safeNumber(contextStage?.char_budget)} characters
        </p>
      </TraceSection>

      <TraceSection key={`${trace.id}:citations`} title="Citation validation" recorded={answerStage !== undefined}>
        <div className="trace-citations">
          <p><strong>Cited markers:</strong> {Array.isArray(citedMarkers) ? citedMarkers.join(", ") || "None" : "None"}</p>
          <p><strong>Available markers:</strong> {Array.isArray(availableMarkers) ? availableMarkers.join(", ") || "None" : "None"}</p>
        </div>
        <div className={`trace-verdict${citationPassed ? " trace-verdict--pass" : " trace-verdict--fail"}`}>
          <span className="trace-verdict__icon">
            <svg viewBox="0 0 32 32" role="img" aria-label={citationPassed ? "Pass" : "Fail"}>
              <circle className="trace-arc" cx="16" cy="16" r="13" />
            </svg>
            {citationPassed ? <Check size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}
          </span>
          <span>{citationPassed ? "Citations validated" : "Citation validation failed"}</span>
        </div>
      </TraceSection>
    </div>
  );
}

function RetrievalRows({
  rows,
  total,
  score,
  label,
  barValue,
  barMax,
  color,
}: {
  rows: TraceChunk[];
  total: number;
  score: (item: TraceChunk) => number;
  label: (item: TraceChunk) => string;
  barValue: (item: TraceChunk) => number;
  barMax: number;
  color: string;
}) {
  return (
    <>
      {rows.map((item, index) => (
        <article className="trace-retrieval-row" key={item.chunk_id}>
          <span className="trace-retrieval-row__rank">{index + 1}</span>
          <div className="trace-retrieval-row__main">
            <strong title={safeText(item.document_title)}>{safeText(item.document_title)}</strong>
            <p title={safeText(item.content_preview)}>{safeText(item.content_preview)}</p>
            <AnimatedBar value={barValue(item)} max={barMax} color={color} delayMs={index * 40} />
          </div>
          <span className="trace-retrieval-row__score" title={String(score(item))}>{label(item)}</span>
        </article>
      ))}
      <p className="trace-muted">Searched {total} chunks, showing top 10.</p>
    </>
  );
}

function formatTraceTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}
