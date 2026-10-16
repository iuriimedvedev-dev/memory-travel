import { useRef, useState } from "react";
import { AlertIcon, SearchIcon, XIcon } from "./icons";
import { MAX_QUESTION_CHARS } from "../lib/live";

interface Props {
  asking: boolean;
  error: string | null;
  note: string | null;
  /** Null while the index data needed for live compilation is still loading. */
  ready: boolean;
  onAsk: (question: string) => void;
  onCancel: () => void;
}

/** Live question box. Rendered once, above BOTH views: a question can seed
 *  a Travel playback and a Cosmos highlight of the hit nodes. */
export default function QueryBar({ asking, error, note, ready, onAsk, onCancel }: Props) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const t = q.trim();
    if (!t || asking || !ready) return;
    onAsk(t);
  };

  return (
    <div className="querybar" role="search">
      <SearchIcon size={15} />
      <input
        ref={inputRef}
        type="text"
        value={q}
        maxLength={MAX_QUESTION_CHARS}
        placeholder={
          ready
            ? "Ask memory anything… (live recall, up to 120s)"
            : "Ask memory anything… (waiting for index data)"
        }
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        disabled={asking || !ready}
        aria-label="Ask a live memory question"
      />
      <span className="qcount dim">
        {q.length}/{MAX_QUESTION_CHARS}
      </span>
      {asking ? (
        <button onClick={onCancel} title="Cancel the live recall">
          <XIcon size={12} /> cancel
        </button>
      ) : (
        <button className="primary" onClick={submit} disabled={!q.trim() || !ready} title="Run a live memory_recall">
          ask live
        </button>
      )}
      {asking && <span className="loading">recalling… (120s timeout)</span>}
      {note && !asking && <span className="qok">{note}</span>}
      {error && !asking && (
        <span className="qerr" role="alert">
          <AlertIcon size={12} /> {error}
        </span>
      )}
    </div>
  );
}
