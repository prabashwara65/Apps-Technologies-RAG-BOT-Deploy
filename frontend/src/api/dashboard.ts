import { apiBaseUrl, authHeaders } from "./http";

export interface DashboardKpi {
  active_documents: number;
  total_chunks: number;
  total_queries: number;
  system_status: string;
}

export interface RAGConfiguration {
  embedding_model: string;
  vector_database: string;
  chunk_size_tokens: number;
  chunk_size_chars: number;
  overlap_tokens: number;
}

export interface LatencyBucket {
  label: string;
  timestamp: string;
  latency_ms: number;
  query_count: number;
}

export interface ActivityItem {
  id: string;
  type: "success" | "warning" | "info";
  title: string;
  timestamp_label: string;
  occurred_at: string;
}

export interface DocumentTypeCount {
  type: string;
  count: number;
}

export interface DocumentSummary {
  id: string;
  title: string;
  document_type: string;
  status: string;
  created_at: string;
  chunk_count: number;
}

export interface DocumentChunkCount {
  document_id: string;
  title: string;
  chunk_count: number;
}

export interface EmbeddingSummary {
  total: number;
  dimension: number;
  model_name: string;
  by_document: DocumentChunkCount[];
}

export interface ServiceHealthComponent {
  name: string;
  status: "healthy" | "degraded" | "unavailable" | "not_configured" | "unknown";
  message: string;
}

export interface ServiceStatus {
  overall_status: "Healthy" | "Degraded" | "Unknown" | "Unreachable";
  checked_at: string;
  components: ServiceHealthComponent[];
  queries_last_24h: number;
  successful_queries_last_24h: number;
  failed_queries_last_24h: number;
  average_latency_ms: number;
  answer_tokens_last_24h: number | null;
  last_query_at: string | null;
  telemetry_available: boolean;
}

export interface DocumentMetrics {
  total: number;
  by_status: Record<string, number>;
  by_type: DocumentTypeCount[];
  recently_added_24h: number;
  total_chunks: number;
  documents: DocumentSummary[];
}

export interface DashboardOverview {
  kpis: DashboardKpi;
  configuration: RAGConfiguration;
  latency_time_range: string;
  latency_buckets: LatencyBucket[];
  recent_activities: ActivityItem[];
  document_metrics: DocumentMetrics;
  embedding_summary: EmbeddingSummary;
  service_status: ServiceStatus;
}

export async function fetchDashboardOverview(
  timeRange: "6h" | "24h" | "7d" = "6h",
  init?: RequestInit
): Promise<DashboardOverview> {
  const url = `${apiBaseUrl()}/api/v1/dashboard/overview?time_range=${encodeURIComponent(timeRange)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: authHeaders(),
    credentials: "same-origin",
    ...init,
  });

  if (!response.ok) {
    throw new Error(`Failed to load dashboard metrics (${response.status})`);
  }

  return (await response.json()) as DashboardOverview;
}
