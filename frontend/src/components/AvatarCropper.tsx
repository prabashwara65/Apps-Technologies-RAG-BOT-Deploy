import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";

interface Props {
  file: File;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
  outputSize?: number;
  busy?: boolean;
}

const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

export function AvatarCropper({ file, onCancel, onConfirm, outputSize = 512, busy = false }: Props) {
  const [source, setSource] = useState("");
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [size, setSize] = useState(320);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const zoom = useRef<(value: number) => void>(() => {});

  const base = dimensions.width && dimensions.height
    ? Math.max(size / dimensions.width, size / dimensions.height) : 1;
  const width = dimensions.width * base * scale;
  const height = dimensions.height * base * scale;
  const x = clamp(offset.x, Math.max(0, (width - size) / 2));
  const y = clamp(offset.y, Math.max(0, (height - size) / 2));
  const locked = busy || exporting;

  function changeScale(value: number) {
    const next = Math.max(1, Math.min(3, value));
    setScale(next);
    setOffset({
      x: clamp(x, Math.max(0, (dimensions.width * base * next - size) / 2)),
      y: clamp(y, Math.max(0, (dimensions.height * base * next - size) / 2)),
    });
  }
  zoom.current = (delta) => { if (!locked) changeScale(scale + delta); };

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const loaded = new Image();
    let active = true;
    setSource(url);
    loaded.onload = () => {
      if (!active) return;
      image.current = loaded;
      setDimensions({ width: loaded.naturalWidth, height: loaded.naturalHeight });
    };
    loaded.onerror = () => { if (active) setError("This image could not be opened. Choose another photo."); };
    loaded.src = url;
    return () => {
      active = false;
      image.current = null;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSize(element.clientWidth));
    observer.observe(element);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom.current(event.deltaY < 0 ? 0.1 : -0.1);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener("wheel", wheel);
    };
  }, []);

  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, []);

  function move(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId || locked) return;
    setOffset({
      x: clamp(current.offsetX + event.clientX - current.x, Math.max(0, (width - size) / 2)),
      y: clamp(current.offsetY + event.clientY - current.y, Math.max(0, (height - size) / 2)),
    });
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !locked) onCancel();
    if (event.key !== "Tab") return;
    const controls = dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)");
    const first = controls?.[0];
    const last = controls?.[controls.length - 1];
    if (!first || !last) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) {
      event.preventDefault(); first.focus();
    }
  }

  function confirm() {
    const loaded = image.current;
    if (!loaded || !size || locked) return;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = Math.max(512, Math.round(outputSize));
    const context = canvas.getContext("2d");
    if (!context) { setError("Image cropping is unavailable in this browser."); return; }
    const factor = base * scale;
    // The image covers the viewport; offsets are clamped to prevent empty edges.
    const sourceX = Math.max(0, ((width - size) / 2 - x) / factor);
    const sourceY = Math.max(0, ((height - size) / 2 - y) / factor);
    const side = Math.min(size / factor, dimensions.width - sourceX, dimensions.height - sourceY);
    context.drawImage(loaded, sourceX, sourceY, side, side, 0, 0, canvas.width, canvas.height);
    setExporting(true);
    canvas.toBlob((blob) => {
      setExporting(false);
      if (!blob) { setError("The cropped image could not be created."); return; }
      if (blob.size > 2 * 1024 * 1024) { setError("The cropped image exceeds 2 MB. Choose another photo."); return; }
      onConfirm(blob);
    }, "image/png", 0.9);
  }

  const backdrop: CSSProperties = {
    position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center",
    justifyContent: "center", padding: 16, background: "rgba(0,0,0,0.65)",
  };

  return (
    <div style={backdrop}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="avatar-crop-title"
        tabIndex={-1} onKeyDown={keyDown} className="glass stack"
        style={{ padding: 24, width: 380, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", background: "var(--surface, #fff)" }}>
        <h2 id="avatar-crop-title">Crop profile photo</h2>
        <p>Drag to position your photo. Scroll or use the slider to zoom.</p>
        <div ref={viewport} role="img" aria-label="Profile photo crop preview"
          style={{ width: "100%", aspectRatio: "1", overflow: "hidden", position: "relative", touchAction: "none", cursor: "grab", background: "#222" }}
          onPointerDown={(event) => {
            if (locked || !image.current) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, offsetX: x, offsetY: y };
          }}
          onPointerMove={move}
          onPointerUp={() => { drag.current = null; }}
          onPointerCancel={() => { drag.current = null; }}>
          {source && dimensions.width > 0 ? <img src={source} alt="" draggable={false}
            style={{ position: "absolute", maxWidth: "none", width, height, left: (size - width) / 2 + x, top: (size - height) / 2 + y, pointerEvents: "none", userSelect: "none" }} /> : null}
          <div style={{ position: "absolute", inset: 0, borderRadius: "50%", boxShadow: "0 0 0 400px rgba(0,0,0,0.55)", border: "2px solid white", pointerEvents: "none" }} />
        </div>
        <label className="field">
          <span className="field__label">Zoom</span>
          <input type="range" min={1} max={3} step={0.01} value={scale}
            disabled={locked || !dimensions.width} onChange={(event) => changeScale(Number(event.target.value))} />
        </label>
        {error ? <p className="notice notice--error" role="alert">{error}</p> : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
          <button type="button" className="btn btn--ghost" disabled={locked} onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn--primary" disabled={locked || !dimensions.width} onClick={confirm}>
            {locked ? "Saving…" : "Save photo"}
          </button>
        </div>
      </div>
    </div>
  );
}
