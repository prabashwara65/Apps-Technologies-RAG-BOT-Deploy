import { useRef, useState } from "react";
import {
  DOCUMENT_TYPES,
  DocumentUploadError,
  uploadDocument,
} from "../api/documents";
import type {
  DocumentIngestionResult,
  DocumentType,
  DocumentUploadFailureKind,
  DocumentUploadProgress,
} from "../api/documents";

interface DocumentUploadPanelProps {
  onUnauthenticated: () => void;
  onClose?: () => void;
}

const ERROR_MESSAGES: Record<DocumentUploadFailureKind, string> = {
  network: "Could not reach the document service. Try again.",
  unsupported: "Choose a TXT, Markdown, PDF, or DOCX file.",
  invalid: "This file could not be read, or it contains no extractable text.",
  too_large: "The file is larger than the 20 MB upload limit.",
  unauthenticated: "Your session has ended. Sign in again to upload documents.",
  forbidden: "Only administrators can upload documents. Your account does not have upload permission.",
  unexpected: "The document could not be processed. Try another file.",
};

export function DocumentUploadPanel({ onUnauthenticated, onClose }: DocumentUploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [documentName, setDocumentName] = useState<string>("");
  const [result, setResult] = useState<DocumentIngestionResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<DocumentUploadProgress | null>(null);
  const [showChunks, setShowChunks] = useState(false);
  const [documentType, setDocumentType] = useState<DocumentType | "">("");
  const [version, setVersion] = useState("");

  async function handleUpload() {
    if (
      pickedFile === null ||
      !documentName.trim() ||
      documentType === "" ||
      version === ""
    ) return;

    setIsUploading(true);
    setResult(null);
    setErrorMessage(null);
    setUploadProgress(null);
    try {
      const uploaded = await uploadDocument(
        pickedFile,
        documentType,
        version,
        documentName.trim(),
        setUploadProgress,
      );
      setResult(uploaded);
      setUploadProgress(null);
      setShowChunks(false);
    } catch (error) {
      const kind = error instanceof DocumentUploadError ? error.kind : "unexpected";
      if (kind === "unauthenticated") onUnauthenticated();
      setErrorMessage(ERROR_MESSAGES[kind]);
      setUploadProgress(null);
    } finally {
      setIsUploading(false);
      setPickedFile(null);
      setDocumentName("");
      setDocumentType("");
      setVersion("");
      if (inputRef.current !== null) inputRef.current.value = "";
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* 1. Upload form — bordered panel */}
      <section className="document-upload" aria-labelledby="document-upload-title">
        <div className="document-upload__heading">
          <div className="document-upload__heading-titles">
            <h2 id="document-upload-title">Read and chunk a document</h2>
            <p>TXT, Markdown, PDF, or DOCX · up to 20 MB</p>
          </div>
          <label className="document-upload__button">
            <input
              accept=".txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              disabled={isUploading}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0] ?? null;
                setPickedFile(file);
                setDocumentName(file === null ? "" : suggestNameFromFilename(file.name));
                setResult(null);
                setErrorMessage(null);
                setUploadProgress(null);
                setShowChunks(false);
              }}
              ref={inputRef}
              type="file"
            />
            {isUploading ? "Reading…" : "Choose document"}
          </label>
          {pickedFile !== null ? (
            <span className="document-upload__summary">{pickedFile.name}</span>
          ) : null}
          <label className="document-upload__type-label">
            Document name
            <input
              aria-label="Document name"
              className="document-upload__name"
              disabled={isUploading || pickedFile === null}
              maxLength={300}
              onChange={(event) => setDocumentName(event.target.value)}
              required
              type="text"
              value={documentName}
            />
          </label>
          <label className="document-upload__type-label">
            Document type
            <select
              aria-label="Document type for upload"
              disabled={isUploading || pickedFile === null}
              onChange={(event) => setDocumentType(event.target.value as DocumentType | "")}
              required
              value={documentType}
            >
              <option disabled value="">Select document type…</option>
              {DOCUMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <label className="document-upload__type-label">
            Version
            <select
              aria-label="Document version"
              disabled={isUploading || pickedFile === null}
              onChange={(event) => setVersion(event.target.value)}
              required
              value={version}
            >
              <option disabled value="">Select version…</option>
              {Array.from({ length: 10 }, (_, index) => `v${index + 1}`).map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="document-upload__button"
            disabled={
              isUploading ||
              pickedFile === null ||
              !documentName.trim() ||
              documentType === "" ||
              version === ""
            }
            onClick={() => void handleUpload()}
          >
            {isUploading ? "Uploading…" : "Upload document"}
          </button>
        </div>

        {uploadProgress !== null ? (
          <div className="document-upload__progress" role="status" aria-live="polite">
            <div className="document-upload__progress-label">
              <span>{uploadProgress.label}</span>
              <span>{uploadProgress.percent}%</span>
            </div>
            <div
              className="document-upload__progress-track"
              role="progressbar"
              aria-label={uploadProgress.label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={uploadProgress.percent}
            >
              <div
                className="document-upload__progress-value"
                style={{ width: `${uploadProgress.percent}%` }}
              />
            </div>
          </div>
        ) : null}

        {errorMessage !== null ? (
          <p className="document-upload__error" role="alert">{errorMessage}</p>
        ) : null}
      </section>

      {/* 2. Close button row — no border, sits between form and chunk box */}
      {onClose ? (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="document-upload__button"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      ) : null}

      {/* 3. Chunk result box — its own bordered panel */}
      {result !== null ? (
        <div className="document-upload__result" aria-live="polite">
          <p className="document-upload__summary">
            {result.filename} <span>{result.chunk_count} {result.chunk_count === 1 ? "chunk" : "chunks"}</span>
          </p>
          <p className="document-upload__key">Document key: {result.document_key}</p>
          <p className="document-upload__status" role="status">
            Stored as {result.document_type}; status: {result.version_status}.
          </p>
          <div className="document-upload__result-actions">
            <button
              type="button"
              className="document-upload__button"
              aria-expanded={showChunks}
              onClick={() => setShowChunks((open) => !open)}
            >
              {showChunks ? "Hide chunks" : "Show chunks"}
            </button>
          </div>
          {showChunks ? (
            <ol className="document-upload__chunks">
              {result.chunks.map((chunk) => (
                <li key={`${chunk.chunk_index}-${chunk.content_hash}`}>
                  <span>Chunk {chunk.chunk_index + 1}</span>
                  <p>{chunk.content_text}</p>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function suggestNameFromFilename(filename: string): string {
  const base = filename.replace(/\.[^/.]+$/, "");
  return base.slice(0, 255).trim();
}