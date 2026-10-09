import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardScreen } from "./DashboardScreen";

afterEach(() => {
  vi.unstubAllGlobals();
});

const mockDashboardData = {
  kpis: {
    active_documents: 14,
    total_chunks: 182,
    total_queries: 42,
    system_status: "Healthy",
  },
  configuration: {
    embedding_model: "gemini-embedding-001",
    vector_database: "PostgreSQL (pgvector)",
    chunk_size_tokens: 512,
    chunk_size_chars: 1200,
    overlap_tokens: 64,
  },
  latency_time_range: "6h",
  latency_buckets: [
    { label: "10:00", timestamp: "2026-10-06T04:30:00Z", latency_ms: 120, query_count: 5 },
    { label: "11:00", timestamp: "2026-10-06T05:30:00Z", latency_ms: 180, query_count: 8 },
    { label: "12:00", timestamp: "2026-10-06T06:30:00Z", latency_ms: 150, query_count: 12 },
    { label: "13:00", timestamp: "2026-10-06T07:30:00Z", latency_ms: 410, query_count: 3 },
    { label: "14:00", timestamp: "2026-10-06T08:30:00Z", latency_ms: 130, query_count: 7 },
    { label: "15:00", timestamp: "2026-10-06T09:30:00Z", latency_ms: 145, query_count: 7 },
  ],
  recent_activities: [
    {
      id: "act-1",
      type: "success",
      title: "Successfully indexed 14 new documents.",
      timestamp_label: "Today at 10:42 AM",
      occurred_at: "2026-10-06T05:12:00Z",
    },
    {
      id: "act-2",
      type: "warning",
      title: "Warning: High latency detected on search endpoint.",
      timestamp_label: "Yesterday at 2:15 PM",
      occurred_at: "2026-10-05T08:45:00Z",
    },
  ],
};

describe("DashboardScreen", () => {
  it("renders Configuration card and Latency Chart without Recent Activity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(mockDashboardData), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    render(<DashboardScreen />);

    // 1. Configuration card
    expect(await screen.findByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("gemini-embedding-001")).toBeInTheDocument();
    expect(screen.getByText("PostgreSQL (pgvector)")).toBeInTheDocument();
    expect(screen.getByText("512 tokens")).toBeInTheDocument();
    expect(screen.getByText("64 tokens")).toBeInTheDocument();

    // 2. Query Latency Card
    expect(screen.getByText("Query Latency")).toBeInTheDocument();
    expect(screen.getByLabelText(/filter query latency timeframe/i)).toBeInTheDocument();
    expect(screen.getByText("10:00")).toBeInTheDocument();
    expect(screen.getByText("13:00")).toBeInTheDocument();

    // 3. Recent System Activity should NOT be on Dashboard
    expect(screen.queryByText("Recent System Activity")).not.toBeInTheDocument();
  });

  it("handles timeframe selection changes", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(mockDashboardData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<DashboardScreen />);
    await screen.findByText("Configuration");

    const select = screen.getByLabelText(/filter query latency timeframe/i);
    fireEvent.change(select, { target: { value: "24h" } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("time_range=24h"),
        expect.objectContaining({
          method: "GET",
          credentials: "same-origin",
          headers: expect.any(Object),
        })
      );
    });
  });
});
