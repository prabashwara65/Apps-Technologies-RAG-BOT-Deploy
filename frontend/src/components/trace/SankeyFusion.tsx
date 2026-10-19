import { useState } from "react";
import type { TraceChunk } from "../../api/queryTraces";

interface SankeyFusionProps {
  dense: TraceChunk[];
  sparse: TraceChunk[];
  fused: TraceChunk[];
}

interface Connection {
  branch: "dense" | "sparse";
  chunkId: string;
  fusedId: string;
  path: string;
  width: number;
}

function traceRow(item: TraceChunk, rank: number) {
  const score = item.rrf_score ?? item.rank_score ?? item.distance;
  return (
    <>
      <span className="trace-sankey__rank">{rank + 1}</span>
      <span className="trace-sankey__row-text">
        <strong title={item.document_title}>{item.document_title}</strong>
        <small>{item.content_preview}</small>
      </span>
      <span className="trace-sankey__score">
        {typeof score === "number" && Number.isFinite(score) ? score.toFixed(4) : "—"}
      </span>
    </>
  );
}

function numericScore(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function SankeyFusion({ dense, sparse, fused }: SankeyFusionProps) {
  const denseRows = dense.slice(0, 5);
  const sparseRows = sparse.slice(0, 5);
  const fusedRows = fused.slice(0, 5);
  const maxScore = Math.max(0, ...fusedRows.map((item) => numericScore(item.rrf_score)));
  const rowY = (index: number) => 29 + index * 54;
  const connections: Connection[] = [];

  for (const [fusedIndex, fusedItem] of fusedRows.entries()) {
    for (const [branch, rows, sourceX, targetX] of [
      ["dense", denseRows, 310, 340],
      ["sparse", sparseRows, 690, 660],
    ] as const) {
      const sourceIndex = rows.findIndex((item) => item.chunk_id === fusedItem.chunk_id);
      if (sourceIndex < 0) continue;
      const startY = rowY(sourceIndex);
      const endY = rowY(fusedIndex);
      connections.push({
        branch,
        chunkId: fusedItem.chunk_id,
        fusedId: fusedItem.chunk_id,
        path: `M ${sourceX} ${startY} C ${sourceX + (targetX > sourceX ? 14 : -14)} ${startY}, ${targetX - (targetX > sourceX ? 14 : -14)} ${endY}, ${targetX} ${endY}`,
        width: maxScore > 0 ? Math.max(0.8, (numericScore(fusedItem.rrf_score) / maxScore) * 7) : 1,
      });
    }
  }

  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const hasConnections = connections.length > 0;
  const maxRows = Math.max(denseRows.length, sparseRows.length, fusedRows.length, 1);

  return (
    <div className={`trace-sankey${hasConnections ? "" : " trace-sankey--fallback"}`}>
      {hasConnections ? (
        <svg
          className="trace-sankey__links"
          viewBox={`0 0 1000 ${maxRows * 54 + 24}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {connections.map((connection, index) => (
            <path
              className={`trace-sankey__link trace-sankey__link--${connection.branch}${
                highlightedId !== null && highlightedId !== connection.fusedId
                  ? " trace-sankey__link--dimmed"
                  : ""
              }`}
              d={connection.path}
              key={`${connection.fusedId}:${connection.branch}:${index}`}
              strokeWidth={connection.width}
              style={{ animationDelay: `${index * 35}ms` }}
            />
          ))}
        </svg>
      ) : null}
      <div className="trace-sankey__columns">
        <SankeyColumn
          title="Dense"
          rows={denseRows}
          branch="dense"
          highlightedId={highlightedId}
          onHighlight={setHighlightedId}
          connectedIds={connections.map((connection) => connection.chunkId)}
        />
        <SankeyColumn
          title="Fused"
          rows={fusedRows}
          branch="fused"
          highlightedId={highlightedId}
          onHighlight={setHighlightedId}
          connectedIds={connections.map((connection) => connection.fusedId)}
        />
        <SankeyColumn
          title="Sparse"
          rows={sparseRows}
          branch="sparse"
          highlightedId={highlightedId}
          onHighlight={setHighlightedId}
          connectedIds={connections.map((connection) => connection.chunkId)}
        />
      </div>
    </div>
  );
}

function SankeyColumn({
  title,
  rows,
  branch,
  highlightedId,
  onHighlight,
  connectedIds,
}: {
  title: string;
  rows: TraceChunk[];
  branch: "dense" | "sparse" | "fused";
  highlightedId: string | null;
  onHighlight: (id: string | null) => void;
  connectedIds: string[];
}) {
  return (
    <div className={`trace-sankey__column trace-sankey__column--${branch}`}>
      <h4>{title}</h4>
      {rows.length === 0 ? <p className="trace-sankey__empty">No results</p> : null}
      {rows.map((item, index) => {
        const hasLink = connectedIds.includes(item.chunk_id);
        const dimmed =
          highlightedId !== null &&
          (branch === "fused" || hasLink
            ? item.chunk_id !== highlightedId
            : true);
        return (
          <div
            className={`trace-sankey__row${dimmed ? " trace-sankey__row--dimmed" : ""}`}
            key={item.chunk_id}
            onMouseEnter={() => branch === "fused" && onHighlight(item.chunk_id)}
            onMouseLeave={() => branch === "fused" && onHighlight(null)}
          >
            {traceRow(item, index)}
          </div>
        );
      })}
    </div>
  );
}
