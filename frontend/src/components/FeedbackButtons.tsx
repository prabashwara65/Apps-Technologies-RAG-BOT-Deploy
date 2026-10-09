import { useEffect, useRef, useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { getFeedback, retractFeedback, submitFeedback } from "../api/feedback";
import type { FeedbackRating, FeedbackReason, FeedbackResponse } from "../api/feedback";

interface Props {
  traceId: string;
  current: FeedbackResponse | null;
  onChange: (feedback: FeedbackResponse | null) => void;
}
const reasons: Array<[FeedbackReason, string]> = [
  ["wrong_answer", "Answer was wrong"], ["incomplete", "Answer was incomplete"],
  ["wrong_document", "Wrong document cited"], ["off_topic", "Didn't answer my question"], ["other", "Other"],
];
export function FeedbackButtons({ traceId, current, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState<FeedbackReason | "">("");
  const [comment, setComment] = useState("");
  const [savedToast, setSavedToast] = useState(false);
  const change = useRef(onChange);
  change.current = onChange;
  // Server state wins over ratings cached inside saved or ongoing chats.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEditing(false);
    void getFeedback(traceId).then((feedback) => {
      if (!cancelled) change.current(feedback);
    }).catch(() => {
      if (!cancelled) { change.current(null); setError("Could not load feedback. You can retry by selecting a rating."); }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [traceId]);

  async function rate(rating: FeedbackRating) {
    if (busy || loading) return;
    setBusy(true); setError(null);
    try {
      if (current?.rating === rating) {
        await retractFeedback(traceId); onChange(null); setEditing(false);
      } else {
        const feedback = await submitFeedback(traceId, rating);
        onChange(feedback);
        setEditing(rating === "down"); setReason(""); setComment("");
      }
    } catch { setError("Could not update feedback. Please try again."); }
    finally { setBusy(false); }
  }
  async function save() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const feedback = await submitFeedback(traceId, "down", {
        ...(reason ? { reason } : {}), ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      onChange(feedback);
      setEditing(false);
      setSavedToast(true);
      window.setTimeout(() => setSavedToast(false), 3000);
    } catch { setError("Could not save feedback details. Please try again."); }
    finally { setBusy(false); }
  }
  return <div className="answer-feedback" aria-label="Answer feedback" aria-busy={busy || loading}>
    <div className="answer-feedback__buttons">
      {(["up", "down"] as const).map((rating) => {
        const Icon = rating === "up" ? ThumbsUp : ThumbsDown;
        return <button key={rating} type="button" className="answer-feedback__button"
          aria-label={rating === "up" ? "Helpful answer" : "Unhelpful answer"}
          aria-pressed={current?.rating === rating} disabled={busy || loading}
          onClick={() => void rate(rating)}><Icon size={17} fill={current?.rating === rating ? "currentColor" : "none"} /></button>;
      })}
      {current?.rating === "down" && !editing ? <button type="button" disabled={busy || loading}
        className="answer-feedback__details" onClick={() => { setReason(current.reason ?? ""); setComment(current.comment ?? ""); setEditing(true); }}>Edit details</button> : null}
      {savedToast ? <span className="answer-feedback__saved" role="status">Feedback details saved</span> : null}
    </div>
    {editing ? <form className="answer-feedback__panel" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label>Reason (optional)<select value={reason} disabled={busy}
        onChange={(event) => setReason(event.target.value as FeedbackReason | "")}>
        <option value="">Select a reason</option>{reasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Comment (optional)<textarea value={comment} maxLength={1000} rows={3} disabled={busy}
        placeholder="Add details about why this answer was unsatisfactory…"
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            void save();
          }
        }}
        onChange={(event) => setComment(event.target.value)} /></label>
      <small>{comment.length}/1000</small>
      <div className="answer-feedback__buttons">
        <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </form> : null}
    {error ? <p className="answer-feedback__error" role="alert">{error}</p> : null}
  </div>;
}