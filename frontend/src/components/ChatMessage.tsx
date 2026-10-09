import type { HrAskResponse } from "../api/hrRag";
import { CitationList } from "./CitationList";
import { BrandLogo } from "./BrandLogo";
import { ReplyText } from "./ReplyText";
import { FeedbackButtons } from "./FeedbackButtons";
import type { FeedbackResponse } from "../api/feedback";

export interface UserTurn {
  id: string;
  role: "user";
  question: string;
}

export interface AssistantTurn {
  id: string;
  role: "assistant";
  response: HrAskResponse;
  traceId?: string;
  feedback?: FeedbackResponse | null;
}

export type ChatTurn = UserTurn | AssistantTurn;

const INSUFFICIENT_EVIDENCE_NOTE =
  "The approved HR sources did not contain enough information to answer this question. " +
  "This is not an error: nothing was invented to fill the gap.";

/** Matches `[S1]`, `[S12]`, and grouped forms such as `[S1, S2]`. */
const CITATION_MARKER = /[ \t]*\[S\d+(?:\s*,\s*S\d+)*\]/g;

/**
 * Strip inline citation markers for display only.
 *
 * The markers are how the model attributes a claim, and the grounding service
 * still validates every one of them before an answer is accepted. They are
 * removed here purely because they read as technical noise in a public demo;
 * `response.answer` keeps the original text and `response.citations` keeps the
 * evidence, so nothing is lost from the data model.
 */
function withoutCitationMarkers(answer: string): string {
  return answer.replace(CITATION_MARKER, "").trim();
}

/** User questions stay plain text; bot answers use safe styled text nodes. */
export function ChatMessage({ turn, onFeedbackChange }: { turn: ChatTurn; onFeedbackChange?: (turnId: string, feedback: FeedbackResponse | null) => void }) {
  if (turn.role === "user") {
    return (
      <article className="message message--user">
        <p className="message__role">You</p>
        <p className="message__text">{turn.question}</p>
      </article>
    );
  }

  const insufficient = turn.response.insufficient_evidence;

  return (
    <article className="message message--assistant">
      <span className="assistant-mark"><BrandLogo /></span>
      <div className="message__content">
      <header className="message__header">
        <p className="message__role">Office Assistant</p>
        {insufficient ? (
          <span className="badge badge--caution">Insufficient evidence</span>
        ) : null}
      </header>

      <ReplyText text={withoutCitationMarkers(turn.response.answer)} />

      {insufficient ? (
        <p className="message__note">{INSUFFICIENT_EVIDENCE_NOTE}</p>
      ) : null}

      <CitationList citations={turn.response.citations} />
      {(turn.traceId || turn.response.trace_id) && onFeedbackChange ? (
        <FeedbackButtons traceId={(turn.traceId || turn.response.trace_id)!}
          current={turn.feedback ?? null}
          onChange={(feedback) => onFeedbackChange(turn.id, feedback)} />
      ) : null}
      </div>
    </article>
  );
}