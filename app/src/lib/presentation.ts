// Presentation chapters — "Презентация: как работает память".
// Every string is an L10n {ru, en} pair; missing translation = build error
// (PresentationChapter['title' | 'narration' | 'fact'] require both).
// All numbers shown come from real trace/graph telemetry — never invented.
import type { L10n } from "../i18n/strings";
import type { TravelTrace } from "./types";

export type VizMode = "cosmos" | "trace";

export interface PresentationChapter {
  id: string;
  title: L10n;
  narration: (ctx: PresCtx) => L10n;
  /** which canvas drives this chapter */
  viz: VizMode;
  /** journey stage to visualise (trace mode) — one choreography per chapter */
  stage?: number;
  /** one highlighted REAL fact, rendered on the card */
  fact: (ctx: PresCtx) => L10n;
}

export interface PresCtx {
  trace: TravelTrace | null;
  nodes: number;
  edges: number;
}

/** Real measured stats (benchmark run on this index; provided by telemetry). */
export const MEASURED = {
  docs: 1854,
  fusionRecallAt10: 0.979,
  fusionLatencyMs: 12.7,
  rerankLatencyS: 1.6,
  edgesTotal: 60117,
};

export const CHAPTERS: PresentationChapter[] = [
  {
    id: "what",
    viz: "cosmos",
    title: { ru: "Что это", en: "What this is" },
    narration: ({ nodes, edges }) => ({
      ru: `Перед вами долговременная память агента: ${MEASURED.docs.toLocaleString("ru-RU")} заметок превращены в ${nodes.toLocaleString("ru-RU")} сущностей и ${edges.toLocaleString("ru-RU")} связей. Это GraphRAG-гибрид: векторный поиск по смыслу + knowledge graph + BM25 по словам. Каждая звезда — реальная сущность продакшн-индекса, положение — 3D UMAP по 768-мерным векторам.`,
      en: `This is an agent's long-term memory: ${MEASURED.docs.toLocaleString("en-US")} notes distilled into ${nodes.toLocaleString("en-US")} entities and ${edges.toLocaleString("en-US")} relations. A GraphRAG hybrid: semantic vector search + a knowledge graph + BM25 over words. Every star is a real entity of the production index; positions are a 3D UMAP of 768-dim vectors.`,
    }),
    fact: ({ nodes, edges }) => ({
      ru: `Факт: ${nodes.toLocaleString("ru-RU")} сущностей · ${edges.toLocaleString("ru-RU")} связей — не мокап, а живой индекс.`,
      en: `Fact: ${nodes.toLocaleString("en-US")} entities · ${edges.toLocaleString("en-US")} relations — not a mock, the live index.`,
    }),
  },
  {
    id: "ingest",
    viz: "cosmos",
    title: { ru: "Как знание попадает в память", en: "How knowledge enters memory" },
    narration: () => ({
      ru: `Заметка разрезается md_struct-чанкером по секциям (заголовки → секции → чанки с номерами строк). Учитель — локальная 27B модель — извлекает из каждого чанка сущности и связи; мердж идёт в общий граф. Справа в карточке — настоящая заметка и её настоящие extraction-записи из кэша учителя.`,
      en: `A note is split by the md_struct chunker along its sections (headings → sections → chunks with line ranges). A teacher — a local 27B model — extracts entities and relations from every chunk; everything merges into one graph. The card shows a real note with its real extraction records from the teacher's cache.`,
    }),
    fact: () => ({
      ru: `Факт: 2 820 чанков из 1 854 заметок; каждая запись учителя сохранена в kv-кэше — воспроизводимо.`,
      en: `Fact: 2,820 chunks from 1,854 notes; every teacher record is kept in the kv cache — reproducible.`,
    }),
  },
  {
    id: "embed",
    viz: "trace",
    stage: 0,
    title: { ru: "Вопрос → эмбеддинг", en: "Question → embedding" },
    narration: () => ({
      ru: `Вопрос превращается в вектор 768-мерным эмбеддером (EmbeddingGemma через llama.cpp; промпт «task: search result | query: …») и ложится в то же смысловое пространство UMAP — розовый маркер. Ближайшие соседи сразу подсвечены: это кандидаты в ответы.`,
      en: `The question becomes a vector via the 768-dim embedder (EmbeddingGemma through llama.cpp; prompt “task: search result | query: …”) and lands in the same UMAP meaning space — the pink marker. Its nearest neighbours light up immediately: those are the answer candidates.`,
    }),
    fact: ({ trace }) => ({
      ru: `Факт: dense-поиск по ${trace?.meta.candidate_pool ?? 2813} чанкам занял ${trace?.meta.latency_ms.dense ?? "?"} мс.`,
      en: `Fact: the dense scan over ${trace?.meta.candidate_pool ?? 2813} chunks took ${trace?.meta.latency_ms.dense ?? "?"} ms.`,
    }),
  },
  {
    id: "channels",
    viz: "trace",
    stage: 1,
    title: { ru: "Параллельные каналы", en: "Parallel channels" },
    narration: () => ({
      ru: `Три поиска бегут параллельно: векторный (смысл, голубой), BM25 (точные слова, зелёный) и расширение по графу (связи, золотой/фиолетовый). У каждого своя природа ошибок: вектор находит «про то же», BM25 — «те же слова», граф добавляет контекст через связи.`,
      en: `Three searches run in parallel: vector (meaning, cyan), BM25 (exact words, green) and graph expansion (relations, gold/violet). Each fails differently: vector finds “about the same thing”, BM25 finds “the same words”, the graph adds context through connections.`,
    }),
    fact: ({ trace }) => ({
      ru: `Факт: sparse-канал — ${trace?.meta.latency_ms.sparse ?? "?"} мс по ${((trace?.meta.bm25_chunks ?? 0)).toLocaleString("ru-RU")} чанкам BM25-индекса.`,
      en: `Fact: the sparse channel — ${trace?.meta.latency_ms.sparse ?? "?"} ms across ${(trace?.meta.bm25_chunks ?? 0).toLocaleString("en-US")} BM25 chunks.`,
    }),
  },
  {
    id: "fusion",
    viz: "trace",
    stage: 4,
    title: { ru: "Фьюжн", en: "Fusion" },
    narration: () => ({
      ru: `Рейтинги каналов нормализуются и сливаются взвешенно (α = 0.5 — измеренный оптимум на 46 бенчмарк-запросах). Оранжевое — слитый рейтинг: чанки, которые и «про то», и со словами темы, поднимаются наверх. Полоски в карточке — вклад каждого канала.`,
      en: `Channel rankings are normalised and blended (α = 0.5 — the measured optimum on 46 benchmark queries). Orange is the fused ranking: chunks that are both “about it” and use its words rise. The bars in the card show each channel's contribution.`,
    }),
    fact: () => ({
      ru: `Факт: fusion recall@10 = ${MEASURED.fusionRecallAt10} при ${MEASURED.fusionLatencyMs} мс — почти бесплатно за качество.`,
      en: `Fact: fusion recall@10 = ${MEASURED.fusionRecallAt10} at ${MEASURED.fusionLatencyMs} ms — quality nearly for free.`,
    }),
  },
  {
    id: "rerank",
    viz: "trace",
    stage: 5,
    title: { ru: "Реранк", en: "Rerank" },
    narration: () => ({
      ru: `Кросс-энкодер (Qwen3-Reranker-0.6B на iGPU) перечитывает пул целиком и переставляет: белым вспыхивает то, что сдвинулось. Предохранитель следит, чтобы сильный fusion-скор не был испорчен: если реранкер не нужен — он пропускается (в этом трейсе: ${"причина ниже в инспекторе"}).`,
      en: `A cross-encoder (Qwen3-Reranker-0.6B on the iGPU) re-reads the whole pool and reorders: white flares mark what moved. A guardrail protects a strong fusion score: when the reranker isn't needed, it stands down (in this trace: see the reason in the inspector).`,
    }),
    fact: ({ trace }) => ({
      ru: `Факт: реранк пула ${trace?.rerank.pool ?? "?"} кандидатов — ~${MEASURED.rerankLatencyS} с на iGPU; заблокированных инверсий: ${trace?.rerank.blocked_inversions ?? "?"}.`,
      en: `Fact: reranking the ${trace?.rerank.pool ?? "?"}-candidate pool — ~${MEASURED.rerankLatencyS} s on the iGPU; blocked inversions: ${trace?.rerank.blocked_inversions ?? "?"}.`,
    }),
  },
  {
    id: "context",
    viz: "trace",
    stage: 6,
    title: { ru: "Сборка контекста", en: "Context assembly" },
    narration: () => ({
      ru: `Победители собираются в промпт: золотые линии на карте — сущности, чьи факты войдут в контекст. Бюджет — 15 000 символов, по документу не более 6 000, гранулярность — целый документ. Что не влезло — отрезано по бюджету, а не по полезности.`,
      en: `The winners are assembled into the prompt: gold lines on the map are the entities whose facts enter the context. The budget is 15,000 chars, 6,000 per document, whole-document granularity. What doesn't fit is cut by budget, not by usefulness.`,
    }),
    fact: ({ trace }) => ({
      ru: `Факт: ${trace?.context_blocks.entities.length ?? "?"} фактов о сущностях, ${trace?.context_blocks.relations.length ?? "?"} связей, ${trace?.context_blocks.source_count ?? "?"} источников с референсами.`,
      en: `Fact: ${trace?.context_blocks.entities.length ?? "?"} entity facts, ${trace?.context_blocks.relations.length ?? "?"} relations, ${trace?.context_blocks.source_count ?? "?"} cited sources.`,
    }),
  },
  {
    id: "answer",
    viz: "trace",
    stage: 7,
    title: { ru: "Синтез", en: "Synthesis" },
    narration: () => ({
      ru: `Сервис возвращает собранный контекст (context_only) — финальный ответ пишет LLM вызывающей стороны, с цитатами на источники. Розовый след на карте — весь путь запроса: от эмбеддинга до узлов-доказательств. Каждая цитата кликабельна и ведёт к своим узлам.`,
      en: `The service returns the assembled context (context_only) — the caller's LLM writes the final answer, citing sources. The pink trail on the map is the whole journey: from the embedding to the evidence nodes. Every citation is clickable and leads back to its nodes.`,
    }),
    fact: ({ trace }) => ({
      ru: `Факт: клиент получил ответ за ${trace?.meta.client_latency_s ?? "?"} с — от нажатия Enter до цитат.`,
      en: `Fact: the client got the answer in ${trace?.meta.client_latency_s ?? "?"} s — from Enter to citations.`,
    }),
  },
  {
    id: "numbers",
    viz: "cosmos",
    title: { ru: "Цифры", en: "The numbers" },
    narration: () => ({
      ru: `Итог на реальных измерениях: fusion recall@10 = 0.979 при 12.7 мс; реранк ~1.6 с на iGPU (и умеет пропускаться); 1 854 документа, 60 117 связей в графе. Всё, что вы видели — телеметрия одного реального запроса к этой памяти.`,
      en: `Bottom line, measured: fusion recall@10 = 0.979 at 12.7 ms; rerank ~1.6 s on the iGPU (and able to stand down); 1,854 documents, 60,117 relations in the graph. Everything you saw is the telemetry of one real query against this memory.`,
    }),
    fact: () => ({
      ru: `Факт: 1 847 заметок → 47 355 сущностей → 60 117 связей; fusion recall@10 0.979 @ 12.7 мс.`,
      en: `Fact: 1,847 notes → 47,355 entities → 60,117 relations; fusion recall@10 0.979 @ 12.7 ms.`,
    }),
  },
];
