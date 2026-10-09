import { apiBaseUrl, authHeaders } from "./http";

const INGEST_PATH = "/api/v1/documents/ingest";
export const DOCUMENT_TYPES = [
  "Policy",
  "Procedure",
  "Company Profile",
  "Organization Structure",
  "Department Directory",
  "Employee Responsibility Directory",
  "Responsibility Matrix",
  "Approval Matrix",
  "Escalation Matrix",
  "FAQ",
  "Technical Guideline",
  "Contact Directory",
  "Project Proposal",
  "Proposal",
  "CV",
  "Resume",
  "Report",
  "Meeting Notes",
  "Requirements",
  "Contract",
  "Invoice",
  "Other",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface DocumentChunk {
  chunk_index: number;
  content_text: string;
  content_hash: string;
}

export interface DocumentIngestionResult {
  filename: string;
  document_type: DocumentType;
  document_key: string;
  document_id: string;
  version_id: string;
  version_status: string;
  chunk_count: number;
  chunks: DocumentChunk[];
}

export interface DocumentUploadProgress {
  stage: "chunking" | "saving" | "activating" | "finishing";
  label: string;
  percent: number;
}

export interface ManagedDocumentVersion {
  id: string;
  version_label: string;
  status: string;
}

export interface ManagedDocument {
  id: string;
  title: string;
  document_type: string;
  created_at: string;
  versions: ManagedDocumentVersion[];
}

export type DocumentUploadFailureKind =
  | "network"
  | "unsupported"
  | "invalid"
  | "too_large"
  | "unauthenticated"
  | "forbidden"
  | "unexpected";

export class DocumentUploadError extends Error {
  readonly kind: DocumentUploadFailureKind;

  constructor(kind: DocumentUploadFailureKind) {
    super(`Document upload failed: ${kind}`);
    this.name = "DocumentUploadError";
    this.kind = kind;
  }
}

function isDocumentIngestionResult(value: unknown): value is DocumentIngestionResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<DocumentIngestionResult>;
  return (
    typeof candidate.filename === "string" &&
    typeof candidate.document_type === "string" &&
    DOCUMENT_TYPES.includes(candidate.document_type as DocumentType) &&
    typeof candidate.document_key === "string" &&
    typeof candidate.document_id === "string" &&
    typeof candidate.version_id === "string" &&
    typeof candidate.version_status === "string" &&
    Number.isInteger(candidate.chunk_count) &&
    Array.isArray(candidate.chunks) &&
    candidate.chunks.every((chunk) =>
      typeof chunk === "object" &&
      chunk !== null &&
      Number.isInteger((chunk as DocumentChunk).chunk_index) &&
      typeof (chunk as DocumentChunk).content_text === "string" &&
      typeof (chunk as DocumentChunk).content_hash === "string"
    )
  );
}

function failureKindForStatus(status: number): DocumentUploadFailureKind {
  if (status === 413) return "too_large";
  if (status === 415) return "unsupported";
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 422) return "invalid";
  return "unexpected";
}

export async function uploadDocument(
  file: File,
  documentType: DocumentType,
  version: string,
  title: string,
  onProgress: (progress: DocumentUploadProgress) => void,
): Promise<DocumentIngestionResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("document_type", documentType);
  form.append("version", version);
  form.append("title", title);

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${INGEST_PATH}`, {
      method: "POST",
      headers: { ...authHeaders(), Accept: "text/event-stream" },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new DocumentUploadError("network");
  }

  if (!response.ok) {
    throw new DocumentUploadError(failureKindForStatus(response.status));
  }

  if (response.body === null) {
    throw new DocumentUploadError("unexpected");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: DocumentIngestionResult | null = null;

  function processEvent(message: string): void {
    let eventName = "";
    const data: string[] = [];
    for (const line of message.split(/\r?\n/u)) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    if (data.length === 0) return;

    let payload: unknown;
    try {
      payload = JSON.parse(data.join("\n")) as unknown;
    } catch {
      throw new DocumentUploadError("unexpected");
    }

    if (eventName === "progress") {
      if (
        typeof payload === "object" &&
        payload !== null &&
        "stage" in payload &&
        "label" in payload &&
        "percent" in payload &&
        typeof payload.stage === "string" &&
        ["chunking", "saving", "activating", "finishing"].includes(payload.stage) &&
        typeof payload.label === "string" &&
        typeof payload.percent === "number"
      ) {
        onProgress({
          stage: payload.stage as DocumentUploadProgress["stage"],
          label: payload.label,
          percent: payload.percent,
        });
        return;
      }
      throw new DocumentUploadError("unexpected");
    }

    if (eventName === "error") {
      const kind =
        typeof payload === "object" &&
        payload !== null &&
        "kind" in payload &&
        typeof payload.kind === "string" &&
        ["network", "unsupported", "invalid", "too_large", "unauthenticated", "forbidden", "unexpected"].includes(payload.kind)
          ? payload.kind as DocumentUploadFailureKind
          : "unexpected";
      throw new DocumentUploadError(kind);
    }

    if (eventName === "result" && isDocumentIngestionResult(payload)) {
      result = payload;
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const messages = buffer.split(/\r?\n\r?\n/u);
      buffer = messages.pop() ?? "";
      for (const message of messages) processEvent(message);
      if (done) break;
    }
    if (buffer.trim()) processEvent(buffer);
  } finally {
    reader.releaseLock();
  }

  if (result === null) throw new DocumentUploadError("unexpected");
  onProgress({ stage: "finishing", label: "Upload complete", percent: 100 });
  return result;
}

export async function fetchManagedDocuments(): Promise<ManagedDocument[]> {
  const response = await fetch(`${apiBaseUrl()}/api/v1/documents/managed`, {
    method: "GET",
    headers: authHeaders(),
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(`Failed to load uploaded documents (${response.status})`);
  }
  return (await response.json()) as ManagedDocument[];
}

export async function setManagedDocumentVersionActive(
  documentId: string,
  versionId: string,
  active: boolean,
): Promise<void> {
  const response = await fetch(
    `${apiBaseUrl()}/api/v1/documents/managed/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}/activation`,
    {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ active }),
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to update document version (${response.status})`);
  }
}

export async function updateManagedDocumentVersionLabel(
  documentId: string,
  versionId: string,
  versionLabel: string,
): Promise<void> {
  const response = await fetch(
    `${apiBaseUrl()}/api/v1/documents/managed/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}/label`,
    {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ version_label: versionLabel }),
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to change document version (${response.status})`);
  }
}

export async function deleteManagedDocument(documentId: string): Promise<void> {
  const response = await fetch(
    `${apiBaseUrl()}/api/v1/documents/managed/${encodeURIComponent(documentId)}`,
    {
      method: "DELETE",
      headers: authHeaders(),
      credentials: "same-origin",
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to delete document (${response.status})`);
  }
}