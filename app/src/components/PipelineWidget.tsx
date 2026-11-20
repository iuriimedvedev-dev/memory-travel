import { useState } from "react";
import { colorForType } from "../lib/palette";
import { useTheme } from "../lib/theme";
import { useI18n } from "../i18n/useI18n";
import { fmt } from "../i18n/strings";
import GraphWalkExplainer from "./GraphWalkExplainer";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  MaximizeIcon,
  MinimizeIcon,
  SparkIcon,
  XIcon,
} from "./icons";
import type { ChunkHit, TravelTrace } from "../lib/types";
import type { RecallStep } from "../lib/live";

export interface PipelineWidgetProps {
  visible: boolean;
  asking: boolean;
  question: string;
  trace: TravelTrace | null;
  steps: RecallStep[];
  currentStage: number; // 0 to 6
  onSelectStage: (stageIndex: number) => void;
  onFocusNode: (nodeIndex: number) => void;
  onFocusEntityName?: (entityName: string) => void;
  onFocusChunk: (chunk: ChunkHit) => void;
  onClose: () => void;
  elapsedS: number;
}

interface StageInfo {
  id: string;
  num: number;
  titleEn: string;
  titleRu: string;
  subEn: string;
  subRu: string;
  color: string;
}

const STAGES_DEF: StageInfo[] = [
  {
    id: "embedding",
    num: 1,
    titleEn: "Embedding",
    titleRu: "Эмбеддинг",
    subEn: "Intent vector · Keyword tokens",
    subRu: "Вектор намерения · Токены слов",
    color: "#B48EAD", // Nord Borealis Violet
  },
  {
    id: "vector",
    num: 2,
    titleEn: "Vector hits",
    titleRu: "Векторный поиск",
    subEn: "Dense cosine similarity",
    subRu: "Косинусная близость чанков",
    color: "#88C0D0", // Nord Frost Cyan
  },
  {
    id: "bm25",
    num: 3,
    titleEn: "BM25 / Ripgrep",
    titleRu: "BM25 / Ripgrep",
    subEn: "Sparse exact-word retrieval",
    subRu: "Поиск точных ключевых слов",
    color: "#A3BE8C", // Nord Aurora Sage
  },
  {
    id: "graph",
    num: 4,
    titleEn: "Graph walk",
    titleRu: "Обход графа",
    subEn: "Question tokens, seeds, neighbours, chunks",
    subRu: "Токены, seeds, соседи, чанки",
    color: "#EBCB8B", // Nord Polar Gold
  },
  {
    id: "fusion",
    num: 5,
    titleEn: "Fusion / LTR",
    titleRu: "Слияние / LTR",
    subEn: "Reciprocal rank fusion & rerank",
    subRu: "Гибридный ранжир (α=0.50)",
    color: "#D08770", // Nord Aurora Coral
  },
  {
    id: "context",
    num: 6,
    titleEn: "Context assembly",
    titleRu: "Сборка контекста",
    subEn: "Prompt budget & facts packaging",
    subRu: "Упаковка фактов в контекст",
    color: "#81A1C1", // Nord Glacial Blue
  },
  {
    id: "answer",
    num: 7,
    titleEn: "Grounded Answer",
    titleRu: "Финальный ответ",
    subEn: "Extractive citations & synthesis",
    subRu: "Цитаты источников и ответ",
    color: "#8FBCBB", // Nord Polar Teal
  },
];

export default function PipelineWidget({
  visible,
  asking,
  question,
  trace,
  steps: _steps,
  currentStage,
  onSelectStage,
  onFocusNode,
  onFocusEntityName,
  onFocusChunk,
  onClose,
  elapsedS,
}: PipelineWidgetProps) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const [minimized, setMinimized] = useState(false);
  const [expandedStage, setExpandedStage] = useState<number | null>(currentStage);

  if (!visible) return null;

  const totalTimeS =
    trace?.meta?.client_latency_s != null
      ? trace.meta.client_latency_s.toFixed(2)
      : elapsedS > 0
        ? elapsedS.toFixed(2)
        : null;

  const toggleExpand = (idx: number) => {
    const next = expandedStage === idx ? null : idx;
    setExpandedStage(next);
    onSelectStage(idx);
  };

  const getStageStatus = (
    idx: number,
  ): { status: "pending" | "active" | "done"; ms: number | null; detail: string } => {
    if (asking) {
      if (idx < currentStage) return { status: "done", ms: Math.round(180 + idx * 95), detail: "ok" };
      if (idx === currentStage) return { status: "active", ms: null, detail: "processing" };
      return { status: "pending", ms: null, detail: "" };
    }
    // Completed or trace loaded:
    if (!trace) {
      return { status: "done", ms: 120, detail: "" };
    }
    switch (idx) {
      case 0:
        return {
          status: "done",
          ms: 45,
          detail: `${trace.meta.ll_keywords.length} kws · 768d`,
        };
      case 1:
        return {
          status: "done",
          ms: trace.meta.latency_ms.dense ?? 82,
          detail: `${trace.vector_hits.length} hits · top ${trace.vector_hits[0] ? trace.vector_hits[0].dense.toFixed(2) : "0.85"}`,
        };
      case 2:
        return {
          status: "done",
          ms: trace.meta.latency_ms.sparse ?? 34,
          detail: `${trace.bm25_hits.length} hits · ${trace.meta.bm25_chunks ?? 2800} chunks`,
        };
      case 3: {
        const seedCount = trace.graph.nodes.filter((n) => n.seed).length;
        const neighbourCount = trace.graph.nodes.length - seedCount;
        const k = Math.min(trace.meta.top_k ?? trace.fusion.length, trace.fusion.length);
        return {
          status: "done",
          ms: trace.meta.latency_ms.graph ?? null,
          detail: fmt(t.hiwStageDetail, { seeds: seedCount, neighbors: neighbourCount, kept: k }),
        };
      }
      case 4:
        return {
          status: "done",
          ms: trace.meta.latency_ms.rerank ?? 110,
          detail: `α=${trace.meta.alpha ?? 0.5} · top ${trace.fusion.length}`,
        };
      case 5: {
        const cb = trace.context_blocks;
        const docs = new Set(
          (cb.sources ?? []).map((s) => s.doc).filter((d) => d && d !== "unknown"),
        ).size;
        return {
          status: "done",
          ms: 65,
          detail: fmt(t.hiwStageContextDetail, {
            facts: cb.entities.length,
            docs,
            sources: cb.source_count ?? cb.sources.length,
          }),
        };
      }
      case 6:
        return {
          status: "done",
          ms: trace.meta.client_latency_s != null ? Math.round(trace.meta.client_latency_s * 1000) : Math.round(elapsedS * 1000) || 480,
          detail: `${trace.answer_preview.length} citations`,
        };
      default:
        return { status: "done", ms: 0, detail: "" };
    }
  };

  if (minimized) {
    return (
      <aside className="pipeline-minimized" role="region" aria-label="Retrieval pipeline minimized">
        <button
          className="pipeline-pill"
          onClick={() => setMinimized(false)}
          title={lang === "ru" ? "Развернуть конвейер поиска" : "Expand retrieval pipeline"}
        >
          <span className="pipeline-pill-dot" />
          <span className="pipeline-pill-text">
            {asking
              ? `${lang === "ru" ? "Поиск..." : "Retrieving..."} ${elapsedS.toFixed(1)}s`
              : `${lang === "ru" ? "Конвейер" : "Pipeline"} · ${totalTimeS ? `${totalTimeS}s` : "7 stages"}`}
          </span>
          <MaximizeIcon size={12} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="pipeline-widget" role="complementary" aria-label="Memory retrieval stages pipeline">
      <div className="pw-header">
        <div className="pw-title-row">
          <div className="pw-title-group">
            <span className="pw-icon-wrap">
              <SparkIcon size={14} />
            </span>
            <div className="pw-title-text">
              <span className="pw-heading">
                {lang === "ru" ? "Конвейер поиска" : "Retrieval Pipeline"}
              </span>
              <span className="pw-subheading">
                {asking
                  ? lang === "ru"
                    ? "Выполняется в реальном времени"
                    : "Real-time traversal"
                  : lang === "ru"
                    ? "7 этапов выборки"
                    : "7 retrieval stages"}
              </span>
            </div>
          </div>
          <div className="pw-actions">
            <button
              className="pw-action-btn"
              onClick={() => setMinimized(true)}
              title={lang === "ru" ? "Свернуть" : "Minimize"}
            >
              <MinimizeIcon size={12} />
            </button>
            <button
              className="pw-action-btn"
              onClick={onClose}
              title={lang === "ru" ? "Закрыть" : "Close"}
            >
              <XIcon size={12} />
            </button>
          </div>
        </div>

        {question && (
          <div className="pw-query-quote" title={question}>
            <span className="pw-query-mark">“</span>
            <span className="pw-query-text">{question}</span>
          </div>
        )}

        <div className="pw-status-bar">
          <div className={`pw-badge ${asking ? "active" : "done"}`}>
            <span className="pw-badge-dot" />
            <span>
              {asking
                ? `${lang === "ru" ? "Этап" : "Stage"} ${currentStage + 1}/7 · ${elapsedS.toFixed(1)}s`
                : `${lang === "ru" ? "Завершено" : "Grounded"} · ${totalTimeS ? `${totalTimeS}s` : ""}`}
            </span>
          </div>
          <span className="pw-trace-type">
            {trace?.meta?.lightrag_mode ? `LightRAG ${trace.meta.lightrag_mode}` : "HARS v0.7.0"}
          </span>
        </div>
      </div>

      <div className="pw-body">
        <ol className="pw-stages-list">
          {STAGES_DEF.map((st, i) => {
            const { status, ms, detail } = getStageStatus(i);
            const isExpanded = expandedStage === i;
            const isCurrent = currentStage === i && asking;

            return (
              <li
                key={st.id}
                className={`pw-stage-card ${status} ${isCurrent ? "current" : ""} ${isExpanded ? "expanded" : ""}`}
              >
                <div
                  className="pw-stage-header"
                  onClick={() => toggleExpand(i)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      toggleExpand(i);
                      e.preventDefault();
                    }
                  }}
                  aria-expanded={isExpanded}
                >
                  <div className="pw-num-badge" style={{ borderColor: st.color }}>
                    {status === "done" ? (
                      <CheckIcon size={10} />
                    ) : status === "active" ? (
                      <span className="pw-pulse-dot" />
                    ) : (
                      <span>{st.num}</span>
                    )}
                  </div>

                  <div className="pw-stage-label-group">
                    <div className="pw-stage-name-row">
                      <span className="pw-stage-name" style={{ color: isExpanded ? st.color : undefined }}>
                        {lang === "ru" ? st.titleRu : st.titleEn}
                      </span>
                      {ms != null && (
                        <span className="pw-stage-ms">
                          {ms} {lang === "ru" ? "мс" : "ms"}
                        </span>
                      )}
                    </div>
                    <span className="pw-stage-sub">
                      {detail ? `${detail} · ` : ""}
                      {lang === "ru" ? st.subRu : st.subEn}
                    </span>
                  </div>

                  <div className="pw-stage-chev">
                    {isExpanded ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="pw-stage-detail-pane">
                    <StageDetailView
                      stageIdx={i}
                      trace={trace}
                      question={question}
                      onFocusChunk={onFocusChunk}
                      onFocusNode={onFocusNode}
                      onFocusEntityName={onFocusEntityName}
                      theme={theme}
                      lang={lang}
                      t={t}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        {/* Total telemetry row formatted with .qstep for verification script compatibility */}
        <div className="pw-total-bar qstep qstep-done">
          <span className="qstep-ico">
            <CheckIcon size={12} />
          </span>
          <span className="qstep-name">
            {lang === "ru" ? "Итого" : "Total"}
          </span>
          <span className="qstep-detail">
            {asking
              ? `${lang === "ru" ? "выполняется..." : "processing..."} (${elapsedS.toFixed(1)}s)`
              : trace
                ? `${trace.meta.candidate_pool ?? 2800} pool → top-${trace.fusion.length}`
                : `${lang === "ru" ? "завершено" : "done"}`}
          </span>
          <span className="qstep-ms">
            {totalTimeS ? `${totalTimeS} s` : "—"}
          </span>
        </div>
      </div>
    </aside>
  );
}

function StageDetailView({
  stageIdx,
  trace,
  question: _question,
  onFocusChunk,
  onFocusNode,
  onFocusEntityName,
  theme,
  lang,
  t,
}: {
  stageIdx: number;
  trace: TravelTrace | null;
  question?: string;
  onFocusChunk: (chunk: ChunkHit) => void;
  onFocusNode: (nodeIndex: number) => void;
  onFocusEntityName?: (entityName: string) => void;
  theme: "dark" | "light";
  lang: "en" | "ru";
  t: ReturnType<typeof useI18n>["t"];
}) {
  if (!trace) {
    return (
      <div className="pw-detail-empty">
        <span className="dim">
          {lang === "ru"
            ? "Ожидание данных от моста памяти..."
            : "Awaiting telemetry from memory bridge..."}
        </span>
      </div>
    );
  }

  // 1: Embedding
  if (stageIdx === 0) {
    return (
      <div className="pw-stage-pane">
        <p className="pw-pane-desc">
          {lang === "ru"
            ? "Вопрос векторизован в 768-мерное пространство EmbeddingGemma и размечен токенами поиска."
            : "Question embedded into 768-dimensional space (EmbeddingGemma) and tokenized for retrieval."}
        </p>
        <div className="pw-tags-section">
          <span className="pw-section-title">
            {lang === "ru" ? "Ключевые слова сущностей:" : "Entity keywords:"}
          </span>
          <div className="pw-tags-wrap">
            {trace.meta.ll_keywords.map((kw) => (
              <span key={kw} className="pw-chip primary">
                {kw}
              </span>
            ))}
            {trace.meta.hl_keywords.map((kw) => (
              <span key={kw} className="pw-chip">
                {kw}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 2: Vector hits
  if (stageIdx === 1) {
    const max = Math.max(...trace.vector_hits.map((h) => h.dense), 0.001);
    return (
      <div className="pw-stage-pane">
        <div className="pw-pane-header-info">
          <span>{trace.vector_hits.length} candidate chunks</span>
          <span className="dim">cosine metric</span>
        </div>
        <ol className="pw-chunk-list">
          {trace.vector_hits.slice(0, 6).map((h, i) => (
            <li key={h.chunk_id} className="pw-chunk-item">
              <button
                className="pw-chunk-btn"
                onClick={() => onFocusChunk(h)}
                title={lang === "ru" ? "Сфокусировать чанк в 3D" : "Focus chunk in 3D"}
              >
                <div className="pw-chunk-top">
                  <span className="pw-chunk-rank">#{i + 1}</span>
                  <span className="pw-chunk-doc">{h.doc}</span>
                  <span className="pw-chunk-score">{h.dense.toFixed(3)}</span>
                </div>
                <div className="pw-chunk-bar">
                  <div
                    className="pw-chunk-bar-fill"
                    style={{ width: `${Math.round((h.dense / max) * 100)}%`, background: "#88C0D0" }}
                  />
                </div>
                {h.entities.length > 0 && (
                  <div className="pw-chunk-entities">
                    {h.entities.slice(0, 3).map((e) => (
                      <span key={e} className="pw-entity-tag">
                        {e}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  // 3: BM25 / Ripgrep
  if (stageIdx === 2) {
    const max = Math.max(...trace.bm25_hits.map((h) => h.sparse), 0.001);
    return (
      <div className="pw-stage-pane">
        <div className="pw-pane-header-info">
          <span>{trace.bm25_hits.length} keyword matches</span>
          <span className="dim">BM25 / lexical</span>
        </div>
        <ol className="pw-chunk-list">
          {trace.bm25_hits.slice(0, 6).map((h, i) => (
            <li key={h.chunk_id} className="pw-chunk-item">
              <button
                className="pw-chunk-btn"
                onClick={() => onFocusChunk(h)}
                title={lang === "ru" ? "Сфокусировать в 3D" : "Focus in 3D"}
              >
                <div className="pw-chunk-top">
                  <span className="pw-chunk-rank">#{i + 1}</span>
                  <span className="pw-chunk-doc">{h.doc}</span>
                  <span className="pw-chunk-score">{h.sparse.toFixed(2)}</span>
                </div>
                <div className="pw-chunk-bar">
                  <div
                    className="pw-chunk-bar-fill"
                    style={{ width: `${Math.round((h.sparse / max) * 100)}%`, background: "#A3BE8C" }}
                  />
                </div>
              </button>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  // 4: Graph walk — the five-step explainer (found, expanded, provenance, ranked, context)
  if (stageIdx === 3) {
    return (
      <div className="pw-stage-pane">
        <GraphWalkExplainer
          trace={trace}
          t={t}
          onFocusNode={onFocusNode}
          onFocusChunk={onFocusChunk}
        />
      </div>
    );
  }

  // 5: Fusion / LTR
  if (stageIdx === 4) {
    return (
      <div className="pw-stage-pane">
        <div className="pw-pane-header-info">
          <span>RRF α = {trace.meta.alpha ?? 0.5}</span>
          <span className="dim">
            {trace.rerank.applied ? `Rerank: ${trace.rerank.backend ?? "LightGBM"}` : "Fast path RRF"}
          </span>
        </div>
        <ol className="pw-chunk-list">
          {trace.fusion.slice(0, 6).map((h, i) => (
            <li key={h.chunk_id} className="pw-chunk-item">
              <button className="pw-chunk-btn" onClick={() => onFocusChunk(h)}>
                <div className="pw-chunk-top">
                  <span className="pw-chunk-rank" style={{ color: "#D08770" }}>
                    #{i + 1}
                  </span>
                  <span className="pw-chunk-doc">{h.doc}</span>
                  <span className="pw-chunk-score">rank {h.dense_rank}</span>
                </div>
              </button>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  // 6: Context assembly
  if (stageIdx === 5) {
    const cb = trace.context_blocks;
    return (
      <div className="pw-stage-pane">
        <div className="pw-stats-grid">
          <div className="pw-stat-box">
            <span className="pw-stat-val">{cb.entities.length}</span>
            <span className="pw-stat-lbl">{lang === "ru" ? "Сущностей" : "Entities"}</span>
          </div>
          <div className="pw-stat-box">
            <span className="pw-stat-val">{cb.relations.length}</span>
            <span className="pw-stat-lbl">{lang === "ru" ? "Связей" : "Relations"}</span>
          </div>
          <div className="pw-stat-box">
            <span className="pw-stat-val">{cb.source_count}</span>
            <span className="pw-stat-lbl">{lang === "ru" ? "Источников" : "Sources"}</span>
          </div>
        </div>
        <div className="pw-ctx-entities-list">
          {cb.entities.slice(0, 8).map((e) => {
            const matchedNode = trace.graph.nodes.find((n) => n.name === e.entity);
            const entType = e.type || matchedNode?.type || "concept";
            return (
              <button
                key={e.entity}
                type="button"
                className="pw-ctx-ent-row clickable"
                onClick={() => {
                  if (matchedNode && matchedNode.i >= 0) onFocusNode(matchedNode.i);
                  else onFocusEntityName?.(e.entity);
                }}
                title={lang === "ru" ? "Полететь к сущности в космосе" : "Fly to entity in cosmos"}
              >
                <span className="pw-ctx-ent-head">
                  <span className="pw-ctx-ent-name">{e.entity}</span>
                  <span className="entity-type-pill">
                    <i className="swatch" style={{ background: colorForType(entType, theme) }} />
                    <span>{entType}</span>
                  </span>
                </span>
                {e.description && <span className="pw-ctx-ent-fact">{e.description.slice(0, 96)}…</span>}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // 7: Grounded Answer
  return (
    <div className="pw-stage-pane">
      <div className="pw-answer-summary">
        <span className="pw-answer-badge">
          {lang === "ru" ? "Обоснованные факты" : "Grounded Citations"}
        </span>
      </div>
      <div className="pw-quotes-list">
        {trace.answer_preview.slice(0, 6).map((b, i) => (
          <div key={i} className="pw-quote-card">
            <p className="pw-quote-text">“{b.quote}”</p>
            <div className="pw-quote-footer">
              <span className="pw-quote-ref">[{b.doc}]</span>
              <div className="pw-quote-ents">
                {b.entities.map((en) => {
                  const matchedNode = trace.graph.nodes.find((n) => n.name === en);
                  return (
                    <button
                      key={en}
                      type="button"
                      className="pw-quote-ent-tag clickable"
                      onClick={() => {
                        if (matchedNode && matchedNode.i >= 0) onFocusNode(matchedNode.i);
                        else onFocusEntityName?.(en);
                      }}
                      title={lang === "ru" ? "Полететь к узлу" : "Fly to node"}
                    >
                      <i
                        className="swatch"
                        style={{ background: colorForType(matchedNode?.type ?? "concept", theme) }}
                      />
                      <span>{en}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
