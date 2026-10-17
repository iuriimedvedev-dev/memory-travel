import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import { AlertIcon, ClockIcon, SearchIcon, XIcon } from "./icons";
import { MAX_QUESTION_CHARS } from "../lib/live";

export interface HistoryEntry {
  q: string;
  ts: number;
  ms: number;
}

interface Props {
  asking: boolean;
  error: string | null;
  note: string | null;
  /** Null while the index data needed for live compilation is still loading. */
  ready: boolean;
  /** Seconds since the current recall started (drives the honest phase hints). */
  elapsedS: number;
  history: HistoryEntry[];
  onAsk: (question: string) => void;
  onCancel: () => void;
  onPickHistory: (q: string) => void;
  onClearHistory: () => void;
}

/** Honest phase hints for the live recall. The bridge answers in ONE response
 *  (no streaming events), so these are elapsed-time estimates, clearly labelled.
 *  Real telemetry (latencies per channel) lands in the trace once it returns. */
const PHASES: [number, string][] = [
  [0, "connecting to the memory bridge…"],
  [3, "embedding the question · extracting keywords…"],
  [10, "dense + sparse retrieval · graph walk · fusion…"],
  [25, "rerank + context assembly — recalls can take up to 120s…"],
];

function phaseFor(elapsedS: number): string {
  let label = PHASES[0][1];
  for (const [from, text] of PHASES) if (elapsedS >= from) label = text;
  return label;
}

export default function QueryBar({
  asking, error, note, ready, elapsedS, history, onAsk, onCancel, onPickHistory, onClearHistory,
}: Props) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const t = q.trim();
    if (!t || asking || !ready) return;
    onAsk(t);
  };

  // keep the input filled when a history chip is picked
  useEffect(() => {
    if (!asking) inputRef.current?.focus();
  }, [asking]);

  return (
    <div className="querybar" role="search">
      <div className="qrow">
        <SearchIcon size={15} />
        <input
          ref={inputRef}
          type="text"
          value={q}
          maxLength={MAX_QUESTION_CHARS}
          placeholder={
            ready
              ? t.qbPlaceholder
              : t.qbPlaceholder
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
            {t.qbAsk}
          </button>
        )}
      </div>

      {asking && (
        <div className="qprogress" role="status">
          <div className="qshimmer" />
          <span className="qphase">
            <ClockIcon size={11} /> {phaseFor(elapsedS)} <b>{elapsedS.toFixed(1)}s</b>
            <span className="dim"> — estimated stages, the bridge answers in one shot</span>
          </span>
        </div>
      )}
      {note && !asking && <span className="qok">{note}</span>}
      {error && !asking && (
        <span className="qerr" role="alert">
          <AlertIcon size={12} /> {error}
        </span>
      )}

      {!asking && history.length > 0 && (
        <div className="qhistory">
          <span className="dim">{t.qbHistory}</span>
          {history.slice(0, 5).map((h) => (
            <button key={h.ts} className="chip" onClick={() => onPickHistory(h.q)} title={`${h.q} — took ${h.ms.toFixed(1)}s`}>
              {h.q.length > 42 ? `${h.q.slice(0, 41)}…` : h.q}
            </button>
          ))}
          <button className="ghostbtn" onClick={onClearHistory} title="clear recent questions">
            <XIcon size={11} />
          </button>
        </div>
      )}
    </div>
  );
}
