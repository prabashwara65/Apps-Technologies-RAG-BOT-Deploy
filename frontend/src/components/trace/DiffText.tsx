interface DiffTextProps {
  original: string;
  expanded: string;
}

type DiffToken = {
  text: string;
  state: "added" | "removed" | null;
};

function tokenize(text: string): string[] {
  return text.match(/\w+|[^\w\s]+|\s+/gu) ?? [];
}

function markedTokens(text: string, other: string, difference: "added" | "removed"): DiffToken[] {
  const otherWords = new Set(tokenize(other).filter((token) => /^\w+$/u.test(token)));
  return tokenize(text).map((token) => ({
    text: token,
    state: /^\w+$/u.test(token) && !otherWords.has(token) ? difference : null,
  }));
}

function renderTokens(tokens: DiffToken[]) {
  return tokens.map((token, index) => (
    <span
      className={
        token.state === null ? undefined : `trace-diff-word--${token.state}`
      }
      key={`${index}:${token.text}`}
    >
      {token.text}
    </span>
  ));
}

export function DiffText({ original, expanded }: DiffTextProps) {
  return (
    <div className="trace-diff">
      <div className="trace-diff__pane">
        <span className="trace-diff__label">Original</span>
        <p>{renderTokens(markedTokens(original, expanded, "removed"))}</p>
      </div>
      <div className="trace-diff__pane">
        <span className="trace-diff__label">Expanded</span>
        <p>{renderTokens(markedTokens(expanded, original, "added"))}</p>
      </div>
    </div>
  );
}
