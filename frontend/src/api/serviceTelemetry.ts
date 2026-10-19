import { apiBaseUrl, authHeaders } from "./http";

export interface ServiceTelemetryItem {
  id: string;
  component: string;
  status: string;
  latency_ms: number;
  token_usage: number | null;
  failure_code: string | null;
  created_at: string;
}

export interface ServiceTelemetryList {
  total: number;
  records: ServiceTelemetryItem[];
}

export async function fetchServiceTelemetry(): Promise<ServiceTelemetryList> {
  const response = await fetch(`${apiBaseUrl()}/api/v1/admin/telemetry?hours=24`, {
    method: "GET",
    headers: authHeaders(),
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(`Failed to load usage metrics (${response.status})`);
  }
  return await response.json() as ServiceTelemetryList;
}

export async function clearServiceTelemetry(): Promise<number> {
  const response = await fetch(`${apiBaseUrl()}/api/v1/admin/telemetry`, {
    method: "DELETE",
    headers: authHeaders(),
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(`Failed to clear usage metrics (${response.status})`);
  }
  const result = await response.json() as { deleted: number };
  return result.deleted;
}
