import { apiBaseUrl, authHeaders } from "./http";

export interface QueryTraceSummary {
  id: string;
  created_at: string;
  question: string;
}

export interface TraceChunk {
  chunk_id: string;
  document_title: string;
  content_preview: string;
  distance?: number | null;
  rank_score?: number | null;
  rrf_score?: number | null;
  dense_rank?: number | null;
  sparse_rank?: number | null;
}

export interface QueryTrace {
  id: string;
  created_at: string;
  question: string;
  stage_query_expansion?: {
    original: string;
    expanded: string;
    succeeded: boolean;
  };
  stage_dense_retrieval?: {
    top?: TraceChunk[];
    total_returned?: number;
  };
  stage_sparse_retrieval?: {
    top?: TraceChunk[];
    total_returned?: number;
  };
  stage_rrf_fusion?: {
    k?: number;
    top?: TraceChunk[];
  };
  stage_context?: {
    sources?: Array<{
      marker: string;
      document_title: string;
      content_preview: string;
    }>;
    chars_used?: number;
    char_budget?: number;
  };
  stage_answer?: {
    text: string;
    cited_markers?: string[];
    available_markers?: string[];
    citations_valid?: boolean;
  };
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method: "GET",
    headers: authHeaders(),
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(`Failed to load query traces (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function fetchQueryTraces(): Promise<QueryTraceSummary[]> {
  const result = await fetchJson<{ traces: QueryTraceSummary[] }>("/api/v1/admin/traces");
  return result.traces;
}

export async function fetchQueryTrace(traceId: string): Promise<QueryTrace> {
  return fetchJson<QueryTrace>(
    `/api/v1/admin/traces/${encodeURIComponent(traceId)}`,
  );
}
