import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityScreen } from "./ActivityScreen";

afterEach(() => {
  vi.unstubAllGlobals();
});

const mockActivityData = {
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
  latency_time_range: "24h",
  latency_buckets: [],
  recent_activities: [
    {
      id: "act-1",
      type: "success",
      title: "Successfully indexed 14 new documents.",
      timestamp_label: "Today at 10:42 AM",
      occurred_at: "2026-10-06T05:12:00Z",
    },
  ],
};

describe("ActivityScreen", () => {
  it("renders page title, resized KPI cards, and recent activities", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(mockActivityData), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    render(<ActivityScreen />);

    // Header
    expect(await screen.findByText("System Activity & Health")).toBeInTheDocument();

    // 4 KPI Cards
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.getByText("Indexed Documents")).toBeInTheDocument();

    expect(screen.getByText("182")).toBeInTheDocument();
    expect(screen.getByText("Searchable Chunks")).toBeInTheDocument();

    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("Questions Handled")).toBeInTheDocument();

    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.getByText("Service Status")).toBeInTheDocument();

    // Detailed Activity log
    expect(screen.getByText("Recent System Activities & Events")).toBeInTheDocument();
    expect(screen.getByText("Successfully indexed 14 new documents.")).toBeInTheDocument();
    expect(screen.getByText("Today at 10:42 AM")).toBeInTheDocument();
  });

  it("renders user comment note in feedback section when present", async () => {
    const feedbackSummary = {
      days: 7,
      total: 1,
      up: 0,
      down: 1,
      up_rate: 0.0,
      by_reason: { wrong_answer: 1 },
      recent: [
        {
          trace_id: "trace-123",
          question_preview: "What is the probation period?",
          question_full: "What is the probation period?",
          rating: "down",
          reason: "wrong_answer",
          comment: "Policy mentions 6 months, not 3 months",
          created_at: "2026-10-06T05:12:00Z",
          user_email: "employee@example.com",
        },
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (typeof url === "string" && url.includes("/feedback/summary")) {
          return new Response(JSON.stringify(feedbackSummary), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify(mockActivityData), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      })
    );

    const { fireEvent } = await import("@testing-library/react");
    render(<ActivityScreen isAdmin />);
    const maximizeButton = await screen.findByRole("button", { name: /maximize feedback/i });
    fireEvent.click(maximizeButton);

    expect(await screen.findByText(/Policy mentions 6 months, not 3 months/i)).toBeInTheDocument();
  });
});
