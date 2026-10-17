import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import { AlertIcon, ChevronRightIcon, ClockIcon, SearchIcon, XIcon } from "./icons";
import { MAX_QUESTION_CHARS, type RecallStep, type StepId, type StepStatus } from "../lib/live";

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
  /** Per-stage rows for the pipeline list (estimated in flight, measured after). */
  steps: RecallStep[];
  onAsk: (question: string) => void;
  onCancel: () => void;
  onPickHistory: (q: string) => void;
  onClearHistory: () => void;
}

// ---------------------------------------------------------------------------
// Local copy. This component owns no i18n keys (i18n/ belongs to another
// agent), so every string it needs beyond the shared t.qbAsk / t.qbHistory is
// kept here as an inline {en, ru} pair and picked with the current language.
// ---------------------------------------------------------------------------
type L10n = { en: string; ru: string };

/** Honest phase hints for the live recall. The bridge answers in ONE response
 *  (no streaming events), so these are elapsed-time estimates, clearly labelled.
 *  Real telemetry (latencies per channel) lands in the pipeline rows. */
const PHASES: [number, L10n][] = [
  [0, { en: "connecting to the memory bridge…", ru: "подключаюсь к мосту памяти…" }],
  [3, { en: "embedding the question · extracting keywords…", ru: "эмбеддинг вопроса · извлечение ключевых слов…" }],
  [10, { en: "dense + sparse retrieval · fusion · graph walk…", ru: "dense + sparse поиск · fusion · обход графа…" }],
  [25, { en: "rerank + context assembly — recalls can take up to 120s…", ru: "реранк + сборка контекста — recall может занять до 120с…" }],
];

function phaseFor(elapsedS: number, lang: "en" | "ru"): string {
  let label = PHASES[0][1][lang];
  for (const [from, text] of PHASES) if (elapsedS >= from) label = text[lang];
  return label;
}

const STEP_LABEL: Record<StepId, L10n> = {
  keywords: { en: "Keywords & mode", ru: "Ключевые слова и режим" },
  dense: { en: "Dense / vector search", ru: "Dense / векторный поиск" },
  sparse: { en: "Sparse / BM25", ru: "Sparse / BM25" },
  graph: { en: "Graph expansion", ru: "Обход графа" },
  fusion: { en: "Fusion (dense+sparse)", ru: "Смешение (dense+sparse)" },
  rerank: { en: "Rerank", ru: "Реранк" },
  context: { en: "Context assembly", ru: "Сборка контекста" },
  total: { en: "Total", ru: "Итого" },
};

/** Rendered row order = the real dependency order, NOT lib/live's row order.
 *
 *  `lib/live.ts` ships its rows as keywords → dense → sparse → graph → fusion →
 *  rerank → context, which reads as "graph feeds fusion". It does not. The
 *  service fuses dense+sparse only (`fusion` carries `alpha`/pool from the
 *  dense/BM25 channels and has no graph field) and runs LightRAG's
 *  entity/relation pass (`graph_expand`, `derived_from: "context_string"`) as a
 *  SEPARATE branch that completes afterwards; the two branches converge only in
 *  context assembly (`context_priority=merged`). Rows are therefore rendered in
 *  completion order so the list stops implying a graph → fusion edge. See
 *  `hars-longterm-memory/docs/trace-api.md` ("Dependency DAG vs wire order").
 *  (That array order lives in lib/live.ts, outside this component's ownership.) */
const DISPLAY_ORDER: StepId[] = [
  "keywords", "dense", "sparse", "fusion", "rerank", "graph", "context", "total",
];
const displayIndex = (id: StepId): number => {
  const i = DISPLAY_ORDER.indexOf(id);
  return i === -1 ? DISPLAY_ORDER.length : i;
};

const COPY = {
  aria: { en: "Ask a live memory question", ru: "Живой вопрос к памяти" },
  cancel: { en: "cancel", ru: "отменить" },
  cancelTitle: { en: "Cancel the live recall", ru: "Отменить живой recall" },
  askTitle: { en: "Run a live memory_recall", ru: "Выполнить живой memory_recall" },
  estNote: { en: "estimated stages, the bridge answers in one shot", ru: "оценка этапов — мост отвечает разом" },
  streamNote: { en: "live trace stream — times measured as stages finish", ru: "живой поток трассировки — времена по мере прохождения этапов" },
  historyTook: { en: "took", ru: "заняло" },
  clearTitle: { en: "clear recent questions", ru: "очистить историю вопросов" },
  seconds: { en: "s", ru: "с" },
  steps: { en: "pipeline", ru: "конвейер" },
  toggle: { en: "collapse / expand the pipeline steps", ru: "свернуть / развернуть шаги конвейера" },
  estimated: { en: "estimated", ru: "оценка" },
  ms: { en: "ms", ru: "мс" },
  branches: {
    en: "fusion blends dense+sparse and does not depend on graph expansion; both branches converge in context assembly",
    ru: "fusion смешивает dense+sparse и не зависит от обхода графа; обе ветви сходятся на сборке контекста",
  },
};

function StepGlyph({ status }: { status: StepStatus }) {
  if (status === "active") {
    return (
      <svg className="icon qspin" width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden="true">
        <path d="M12 3 a9 9 0 1 0 9 9" />
      </svg>
    );
  }
  if (status === "done") {
    return (
      <svg className="icon" width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="5,13 10,18 19,6" />
      </svg>
    );
  }
  if (status === "error") return <AlertIcon size={12} />;
  if (status === "skipped") {
    return (
      <svg className="icon" width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden="true">
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    );
  }
  return (
    <svg className="icon" width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

export default function QueryBar({
  asking, error, note, ready, elapsedS, history, steps, onAsk, onCancel, onPickHistory, onClearHistory,
}: Props) {
  const { t, lang } = useI18n();
  const [q, setQ] = useState("");
  const [stepsOpen, setStepsOpen] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const c = <K extends keyof typeof COPY>(k: K): string => COPY[k][lang];
  const label = (id: StepId): string => STEP_LABEL[id][lang];

  const submit = () => {
    const text = q.trim();
    if (!text || asking || !ready) return;
    onAsk(text);
  };

  // keep the input filled when a history chip is picked
  useEffect(() => {
    if (!asking) inputRef.current?.focus();
  }, [asking]);

  const estimatedNow = asking && steps.some((s) => s.status === "active" && s.estimated);
  /** Any row carrying a measured (non-estimated) value => streaming trace. */
  const streaming = steps.some((s) => !s.estimated);

  return (
    <div className="querybar" role="search">
      <div className="qrow">
        <SearchIcon size={15} />
        <input
          ref={inputRef}
          type="text"
          value={q}
          maxLength={MAX_QUESTION_CHARS}
          placeholder={t.qbPlaceholder}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          disabled={asking || !ready}
          aria-label={c("aria")}
        />
        <span className="qcount dim">
          {q.length}/{MAX_QUESTION_CHARS}
        </span>
        {asking ? (
          <button onClick={onCancel} title={c("cancelTitle")}>
            <XIcon size={12} /> {c("cancel")}
          </button>
        ) : (
          <button className="primary" onClick={submit} disabled={!q.trim() || !ready} title={c("askTitle")}>
            {t.qbAsk}
          </button>
        )}
      </div>

      {steps.length > 0 && (
        <div className="qsteps">
          <button
            type="button"
            className="qsteps-head"
            onClick={() => setStepsOpen((o) => !o)}
            title={c("toggle")}
            aria-expanded={stepsOpen}
          >
            <ChevronRightIcon size={11} className={`qchev${stepsOpen ? " open" : ""}`} />
            <span>{c("steps")}</span>
            {estimatedNow && <span className="qsteps-est">{c("estimated")}</span>}
          </button>
          {stepsOpen && (
            <>
              <ol className="qstep-list" aria-label={c("steps")}>
                {[...steps]
                  .sort((a, b) => displayIndex(a.id) - displayIndex(b.id))
                  .map((s, i) => (
                    <li key={s.id} className={`qstep qstep-${s.status}${s.estimated ? " qstep-est" : ""}`}>
                      <span className="qstep-ico"><StepGlyph status={s.status} /></span>
                      <span className="qstep-num">{i + 1}</span>
                      <span className="qstep-name">{label(s.id)}</span>
                      <span className="qstep-detail">{s.detail}</span>
                      <span className="qstep-ms">{s.ms == null ? "—" : `${Math.round(s.ms)} ${c("ms")}`}</span>
                    </li>
                  ))}
              </ol>
              <p className="qsteps-note">{c("branches")}</p>
            </>
          )}
        </div>
      )}

      {asking && (
        <div className="qprogress" role="status">
          <div className="qshimmer" />
          <span className="qphase">
            <ClockIcon size={11} /> {phaseFor(elapsedS, lang)} <b>{elapsedS.toFixed(1)}{c("seconds")}</b>
            <span className="dim"> — {streaming ? c("streamNote") : c("estNote")}</span>
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
            <button key={h.ts} className="chip" onClick={() => onPickHistory(h.q)} title={`${h.q} — ${c("historyTook")} ${h.ms.toFixed(1)}${c("seconds")}`}>
              {h.q.length > 42 ? `${h.q.slice(0, 41)}…` : h.q}
            </button>
          ))}
          <button className="ghostbtn" onClick={onClearHistory} title={c("clearTitle")}>
            <XIcon size={11} />
          </button>
        </div>
      )}
    </div>
  );
}
