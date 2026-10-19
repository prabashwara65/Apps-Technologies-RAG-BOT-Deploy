import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { AuthApiError, changePassword } from "../api/auth";

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  autoComplete: "current-password" | "new-password";
  disabled: boolean;
  visible: boolean;
  minLength?: number;
  describedBy?: string;
  onChange: (value: string) => void;
  onToggle: () => void;
}

function PasswordField({
  id,
  label,
  value,
  autoComplete,
  disabled,
  visible,
  minLength,
  describedBy,
  onChange,
  onToggle,
}: PasswordFieldProps) {
  const action = `${visible ? "Hide" : "Show"} ${label.toLowerCase()}`;

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{label}</label>
      <div className="password-change__input-wrap">
        <input
          id={id}
          className="field__input password-change__input"
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required
          minLength={minLength}
          maxLength={128}
          disabled={disabled}
          value={value}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          className="password-change__visibility"
          type="button"
          disabled={disabled}
          aria-label={action}
          aria-controls={id}
          aria-pressed={visible}
          title={action}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onToggle}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            {visible ? (
              <>
                <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.5 5.3A10.8 10.8 0 0 1 12 5c5 0 9 7 9 7a18 18 0 0 1-3.2 3.9M6.3 6.3A20 20 0 0 0 3 12s4 7 9 7a10 10 0 0 0 5.7-1.7" />
              </>
            ) : (
              <>
                <path d="M3 12s4-7 9-7 9 7 9 7-4 7-9 7-9-7-9-7Z" />
                <circle cx="12" cy="12" r="3" />
              </>
            )}
          </svg>
        </button>
      </div>
    </div>
  );
}

export function PasswordChangeForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [visibility, setVisibility] = useState({ current: false, next: false, confirm: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const submitting = useRef(false);

  function clearMessages() {
    setError(null);
    setNotice(null);
  }

  function toggle(field: keyof typeof visibility) {
    setVisibility((previous) => ({ ...previous, [field]: !previous[field] }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    clearMessages();
    if (next !== confirm) { setError("New passwords do not match."); return; }
    if (next === current) { setError("Choose a new password different from your current password."); return; }
    if (next.length < 8 || next.length > 128 || next.trim() !== next || !/[A-Z]/.test(next) || !/[0-9]/.test(next) || !/[^A-Za-z0-9]/.test(next)) {
      setError("Password must be 8–128 characters, include a capital letter, a number, and a symbol, and have no spaces at either end.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      await changePassword(current, next);
      setCurrent(""); setNext(""); setConfirm("");
      setVisibility({ current: false, next: false, confirm: false });
      setNotice("Password updated successfully.");
    } catch (failure) {
      setError(failure instanceof AuthApiError ? failure.message : "Password could not be updated. Please try again.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <form className="glass stack profile-page__settings password-change" aria-labelledby="password-change-title" onSubmit={(event) => { void submit(event); }} aria-busy={busy}>
      <h2 id="password-change-title" className="password-change__heading">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
        Change password
      </h2>
      <PasswordField
        id="password-change-current"
        label="Current password"
        value={current}
        autoComplete="current-password"
        disabled={busy}
        visible={visibility.current}
        onToggle={() => toggle("current")}
        onChange={(value) => { setCurrent(value); clearMessages(); }}
      />
      <PasswordField
        id="password-change-next"
        label="New password"
        value={next}
        autoComplete="new-password"
        minLength={8}
        describedBy="password-change-hint"
        disabled={busy}
        visible={visibility.next}
        onToggle={() => toggle("next")}
        onChange={(value) => { setNext(value); clearMessages(); }}
      />
      <p className="password-change__hint" id="password-change-hint">Use 8–128 characters with a capital letter, a number, and a symbol.</p>
      <PasswordField
        id="password-change-confirm"
        label="Confirm new password"
        value={confirm}
        autoComplete="new-password"
        minLength={8}
        disabled={busy}
        visible={visibility.confirm}
        onToggle={() => toggle("confirm")}
        onChange={(value) => { setConfirm(value); clearMessages(); }}
      />
      {error && <p className="notice notice--error" role="alert">{error}</p>}
      {notice && <p className="notice notice--ok" role="status">{notice}</p>}
      <button className="btn btn--primary password-change__submit" type="submit" disabled={busy}>{busy ? "Updating…" : "Update password"}</button>
    </form>
  );
}
