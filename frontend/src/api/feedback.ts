import { apiBaseUrl, authHeaders, jsonHeaders } from "./http";
export type FeedbackRating = "up" | "down";
export type FeedbackReason = "wrong_answer" | "incomplete" | "wrong_document" | "off_topic" | "other";
export interface FeedbackResponse {
  trace_id: string;
  user_id: string;
  rating: FeedbackRating;
  reason: FeedbackReason | null;
  comment: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeedbackRecentItem {
  trace_id: string;
  question_preview: string;
  question_full: string;
  rating: "up" | "down";
  reason: string | null;
  comment: string | null;
  created_at: string;
  user_email: string;
}

export interface FeedbackSummary {
  days: number;
  total: number;
  up: number;
  down: number;
  up_rate: number;
  by_reason: Record<string, number>;
  recent: FeedbackRecentItem[];
}

export async function fetchFeedbackSummary(
  opts?: { days?: number; rating?: "up" | "down"; reason?: string }
): Promise<FeedbackSummary> {
  const params = new URLSearchParams();
  if (opts?.days !== undefined) params.set("days", String(opts.days));
  if (opts?.rating !== undefined) params.set("rating", opts.rating);
  if (opts?.reason !== undefined) params.set("reason", opts.reason);
  const queryString = params.toString();
  const query = queryString === "" ? "" : `?${queryString}`;
  const response = await fetch(`${apiBaseUrl()}/api/v1/feedback/summary${query}`, {
    method: "GET",
    headers: authHeaders(),
    credentials: "same-origin",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`Failed to load feedback summary (${response.status})`);
  }
  return await response.json() as FeedbackSummary;
}

async function request(traceId: string, method: string, body?: unknown): Promise<Response> {
  const response = await fetch(`${apiBaseUrl()}/api/v1/feedback/${encodeURIComponent(traceId)}`, {
    method, headers: jsonHeaders(), signal: AbortSignal.timeout(15000),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return response;
}
export async function submitFeedback(traceId: string, rating: FeedbackRating, opts?: { reason?: FeedbackReason; comment?: string }): Promise<FeedbackResponse> {
  const response = await request(traceId, "POST", { rating, ...opts });
  if (!response.ok) throw new Error("Could not save feedback. Please try again.");
  return await response.json() as FeedbackResponse;
}
export async function retractFeedback(traceId: string): Promise<void> {
  const response = await request(traceId, "DELETE");
  if (!response.ok) throw new Error("Could not remove feedback. Please try again.");
}
export async function getFeedback(traceId: string): Promise<FeedbackResponse | null> {
  const response = await request(traceId, "GET");
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Could not load feedback. Please try again.");
  return await response.json() as FeedbackResponse;
}