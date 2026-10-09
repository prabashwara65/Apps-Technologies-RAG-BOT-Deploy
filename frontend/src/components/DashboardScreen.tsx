import { useEffect, useRef, useState } from "react";
import {
  Activity,
  RefreshCw,
  Sliders,
} from "lucide-react";
import { fetchDashboardOverview } from "../api/dashboard";
import type { DashboardOverview, LatencyBucket } from "../api/dashboard";
import "./dashboard.css";

export function DashboardScreen() {
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<"6h" | "24h" | "7d">("6h");
  const [hoveredBucket, setHoveredBucket] = useState<LatencyBucket | null>(null);
  const latestRequestId = useRef(0);
  const activeRequestController = useRef<AbortController | null>(null);

  async function loadData(range: "6h" | "24h" | "7d" = timeRange) {
    const requestId = ++latestRequestId.current;
    activeRequestController.current?.abort();
    const controller = new AbortController();
    activeRequestController.current = controller;

    try {
      setLoading(true);
      setError(null);
      const res = await fetchDashboardOverview(range, { signal: controller.signal });
      if (requestId !== latestRequestId.current) {
        return;
      }
      setData(res);
    } catch (err) {
      if (controller.signal.aborted || requestId !== latestRequestId.current) {
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load dashboard data");
    } finally {
      if (requestId === latestRequestId.current) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void loadData(timeRange);
  }, [timeRange]);

  // Chart layout calculations
  const chartHeight = 180;
  const chartWidth = 500;
  const paddingLeft = 35;
  const paddingRight = 15;
  const paddingTop = 20;
  const paddingBottom = 30;
  const innerWidth = chartWidth - paddingLeft - paddingRight;
  const innerHeight = chartHeight - paddingTop - paddingBottom;

  const buckets = data?.latency_buckets ?? [];
  const maxLatency = Math.max(400, ...buckets.map((b) => b.latency_ms));
  // Round up max to next hundred
  const yMax = Math.ceil(maxLatency / 100) * 100;
  const yTicks = [0, yMax * 0.25, yMax * 0.5, yMax * 0.75, yMax];

  return (
    <div className="dashboard-screen">
      {/* Header */}
      <div className="dashboard-heading">
        <div className="dashboard-heading__titles">
          <h1>System Dashboard</h1>
          <p>Real-time RAG operational observability, query latency, and active configuration.</p>
        </div>
        <div className="dashboard-heading__actions">
          <button
            type="button"
            className="dashboard-refresh-btn"
            disabled={loading}
            onClick={() => void loadData(timeRange)}
            title="Refresh dashboard metrics"
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

      <div className="space-y-5">

        {/* Main Grid: Configuration (Left) & Latency Chart (Right) */}
        <div className="dashboard-grid-two-col">
        {/* 1. Configuration Card */}
        <div className="dash-card">
          <div className="dash-card__header">
            <div className="dash-card__title-group">
              <Sliders size={18} className="dash-card__header-icon" />
              <h2>Configuration</h2>
            </div>
          </div>

          <div className="dash-config-body">
            <div className="dash-config-field">
              <span className="dash-config-label">Embedding Model</span>
              <span className="dash-config-badge">
                {data ? data.configuration.embedding_model : "gemini-embedding-001"}
              </span>
            </div>

            <div className="dash-config-field">
              <span className="dash-config-label">Vector Database</span>
              <span className="dash-config-val-text">
                {data ? data.configuration.vector_database : "PostgreSQL (pgvector)"}
              </span>
            </div>

            <div className="dash-config-row">
              <div className="dash-config-stat">
                <span className="dash-config-label">Chunk Size</span>
                <span className="dash-config-stat__num">
                  {data ? `${data.configuration.chunk_size_tokens} tokens` : "512 tokens"}
                </span>
                <span className="dash-config-stat__sub">
                  ({data ? data.configuration.chunk_size_chars : 1200} chars)
                </span>
              </div>

              <div className="dash-config-stat">
                <span className="dash-config-label">Overlap</span>
                <span className="dash-config-stat__num">
                  {data ? `${data.configuration.overlap_tokens} tokens` : "64 tokens"}
                </span>
                <span className="dash-config-stat__sub">(sliding window)</span>
              </div>
            </div>
          </div>
        </div>

        {/* 2. Query Latency Bar Chart Card */}
        <div className="dash-card">
          <div className="dash-card__header">
            <div className="dash-card__title-group">
              <Activity size={18} className="dash-card__header-icon" />
              <h2>Query Latency</h2>
            </div>

            <select
              className="dash-card__time-select"
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value as "6h" | "24h" | "7d")}
              aria-label="Filter query latency timeframe"
            >
              <option value="6h">Last 6 Hours</option>
              <option value="24h">Last 24 Hours</option>
              <option value="7d">Last 7 Days</option>
            </select>
          </div>

          <div className="latency-chart-box">
            {hoveredBucket ? (
              <div className="latency-tooltip">
                <span>{hoveredBucket.label}: </span>
                <strong style={{ color: "#2563eb" }}>{hoveredBucket.latency_ms} ms</strong>
              </div>
            ) : null}

            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="latency-svg-chart">
              {/* Horizontal Grid lines and Y-axis text */}
              {yTicks.map((tickVal) => {
                const yPos =
                  paddingTop + innerHeight - (tickVal / yMax) * innerHeight;
                return (
                  <g key={tickVal}>
                    <line
                      x1={paddingLeft}
                      y1={yPos}
                      x2={chartWidth - paddingRight}
                      y2={yPos}
                      className="latency-grid-line"
                    />
                    <text
                      x={paddingLeft - 8}
                      y={yPos + 4}
                      textAnchor="end"
                      className="latency-axis-text"
                    >
                      {Math.round(tickVal)}
                    </text>
                  </g>
                );
              })}

              {/* Bars and X-axis labels */}
              {buckets.map((b, i) => {
                const barSpacing = innerWidth / buckets.length;
                const barWidth = Math.min(28, barSpacing * 0.55);
                const xCenter = paddingLeft + (i + 0.5) * barSpacing;
                const xPos = xCenter - barWidth / 2;

                const barH = Math.max(4, (b.latency_ms / yMax) * innerHeight);
                const yPos = paddingTop + innerHeight - barH;

                return (
                  <g key={b.timestamp || i}>
                    <rect
                      x={xPos}
                      y={yPos}
                      width={barWidth}
                      height={barH}
                      rx={4}
                      fill="#3b82f6"
                      className="latency-bar-rect"
                      onMouseEnter={() => setHoveredBucket(b)}
                      onMouseLeave={() => setHoveredBucket(null)}
                    />
                    <text
                      x={xCenter}
                      y={chartHeight - 8}
                      textAnchor="middle"
                      className="latency-axis-text"
                    >
                      {b.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
