// Type-safe i18n for Memory Travel.
//
// RU is the source of truth (the primary audience is Russian-speaking).
// `Dict` is derived from typeof RU, so a missing key in EN is a BUILD
// error, never a runtime undefined. Switching language mid-presentation
// only swaps strings — the app keeps its position (chapter/stage state
// lives outside this module).

export type Lang = "ru" | "en";

/** {ru, en} pair for inline strings (chapter narrations, captions). */
export interface L10n {
  ru: string;
  en: string;
}

export function pick(l: L10n, lang: Lang): string {
  return l[lang];
}

const RU = {
  // ---- app chrome ----
  brandSub: "· как работает память",
  tabCosmos: "космос",
  tabTravel: "путешествие",
  aboutLink: "о приложении · v1",
  // cosmos panel
  cosmosTitle: "Космос памяти",
  cosmosSub:
    "Живой граф знаний HARS — {n} сущностей, {m} связей, разложенных по смыслу (3D UMAP по stored 768-мерным векторам — настоящая туманность, которую можно вращать). Не мокап: это продакшн-индекс.",
  searchPlaceholder: "найти сущность… (например VEA, DROID, checkpoint)",
  searchClear: "очистить поиск",
  searchMetaTop: "{n} совпадений — топ-{k} ниже, совпадения подсвечены на карте",
  searchMetaNone: "ничего не найдено",
  legendTitle: "типы сущностей",
  legendShown: "{a} / {b} показано",
  legendShowAll: "показать все типы",
  resetView: "сбросить вид",
  tourButton: "Презентация: как работает память",
  hintOrbit: "вращение — мышью · колесо — зум · правая кнопка — панорама · клик по звезде — детали",
  flyTo: "полететь",
  clearHighlight: "снять подсветку",
  degreeLinks1: "1 прямая связь",
  degreeLinksN: "{n} прямых связей",
  noDesc: "для этой сущности нет описания",
  loadingStars: "зажигаем 47k звёзд…",
  // query bar
  qbPlaceholder: "Спроси память… (живой recall, до 120с)",
  qbAsk: "спросить",
  qbCancel: "отменить",
  qbChars: "0/500",
  qbHistory: "недавние:",
  qbClearHistory: "очистить",
  // 2D fallback badge
  fallbackBadge:
    "резервный canvas2d — в этом браузере нет WebGL2, поэтому 3D-туманность недоступна; те же данные, то же путешествие, плоская проекция.",
  hudNodesEdges: "{n} узлов · {m} рёбер",
  // travel panel
  travelTitle: "Путешествие памяти",
  travelSub:
    "Путь одного реального запроса через машину памяти — каждый счёт, задержка и id ниже — сохранённая телеметрия, не мокап.",
  travelLive: "живой",
  travelLoadingTrace: "загружаю трейс…",
  travelSubgraphLoading: "загружаю подграф…",
  travelCanvasUnavailable:
    "Canvas недоступен (WebGL2 и 2D-резерв не запустились) — телеметрия ниже остаётся читаемой.",
  travelLiveNote:
    "Живой recall — тот же формат трейсов, что и фикстуры (сущности чанков по упоминаниям; маркер запроса в центроиде топ-хитов; эмбеддера в браузере нет).",
  cameraJourney: "камера: авто",
  cameraFree: "камера: свободная",
  journeyLogTitle: "журнал путешествия",
  journeyLogEmpty: "пусто — включите воспроизведение",
  journeyLogDropped: "{n} неразрешённых ссылок опущено",
  stagePrev: "предыдущий этап (←)",
  stageNext: "следующий этап (→)",
  stagePlay: "воспроизвести (пробел)",
  stagePause: "пауза (пробел)",
  stageScrubber: "ползунок этапов",
  speedTitle: "скорость воспроизведения",
  inspectTitle: "инспектор этапа",
  chunkTitle: "содержимое чанка",
  inspectClose: "закрыть",
  inspectOpen: "данные этапа",
  scoreDense: "dense",
  scoreSparse: "bm25",
  scoreFused: "fusion",
  scoreRerank: "rerank",
  inFinalContext: "в финальном контексте",
  notInFinalContext: "не вошёл в контекст",
  sourceFile: "источник",
  section: "секция",
  showMore: "показать больше",
  showLess: "свернуть",
  openSourceNote: "открыть исходную заметку",
  rank: "место",
  deltaToTop: "отставание от лидера",
  beforeAfter_in: "порядок fusion (до)",
  beforeAfter_out: "порядок подачи (после)",
  rerankSkipped: "реранк ПРОПУЩЕН — {reason}",
  ringAdded: "кольцо {d}: +{n} сущностей",
  edgesTraversed: "ребёр пройдено: {n}",
  contextBudget: "бюджет: {used} / {total} симв.",
  // presentation
  presLaunch: "Презентация: как работает память",
  presExit: "выйти (Esc)",
  presMenu: "главы",
  presLang: "язык",
  presAutoplay: "автоплей",
  presChapter: "глава {n} / {total}",
  presNext: "дальше (→)",
  presPrev: "назад (←)",
  presFullscreen: "полный экран (F)",
  presLoading: "готовлю данные…",
  // presentation: docked chapter cards (chapters 3-8, real trace data)
  cardsAria: "данные главы",
  cardQuestion: "вопрос",
  cardEmbedding: "эмбеддинг",
  cardVectorDims: "UMAP 768-d → x,y,z",
  cardTopDense: "топ-12 dense-скоров",
  cardPool: "пул кандидатов",
  cardLatencyDense: "dense, мс",
  cardLatencySparse: "bm25, мс",
  cardVectorCh: "векторный канал",
  cardSparseCh: "BM25-канал",
  cardGraphCh: "граф-канал",
  cardHits: "хитов",
  cardTopScore: "топ-скор",
  cardBm25Chunks: "чанков в BM25",
  cardSeeds: "сидов",
  cardEdges: "рёбер пройдено",
  cardNodes: "узлов подграфа",
  cardFused: "слитый рейтинг",
  cardAlpha: "α (вес dense)",
  cardMoved: "сдвинуто",
  cardApplied: "реранк применён",
  cardRerankPool: "пул реранка",
  cardBlocked: "заблокировано инверсий",
  cardEntityFacts: "фактов о сущностях",
  cardContext: "контекст",
  cardSources: "источников",
  cardAnswer: "ответ",
  cardCitations: "цитаты",
  cardQuotes: "цитат в превью",
  // presentation: chapter 2 ingest panel (two panels + split preview)
  ingestExtract: "extraction-записи учителя",
  ingestEntities: "сущности",
  ingestRelations: "связи",
  ingestNoRelations: "в этой выборке связей нет — учитель выпустил только сущности",
  ingestNoEntities: "в этой выборке нет записей",
  ingestDoc: "исходная заметка",
  ingestDocMeta: "{lines} строк · {chars} символов · {chunks} окон в индексе",
  ingestParams: "параметры чанкинга",
  ingestLaneIndex: "как в индексе",
  ingestLaneMirror: "md_struct, по параметрам выше",
  ingestOverlap: "перекрытие",
  ingestSection: "граница секции",
  ingestTokens: "{n} ток.",
  ingestEstTokens: "≈{n} ток. (chars//4)",
  ingestMirrorNote: "оценка без токенизатора: chars//4, как в md_struct.estimate_tokens",
  ingestReset: "значения индекса",
  ingestChunk: "чанк",
  ingestSectionTag: "секция",
  ingestHoverHint: "наведите на окно или на запись — подсветятся обе панели",
  ingestClickHint: "клик по окну — закрепить и прокрутить заметку к его строкам",
  ingestMeta: "{n} записей учителя · {r} связей · {c} окон в индексе",
  ingestCaption:
    "Продакшн-сплиттер — hars_memory/ingest/md_structure.py: секции заголовков → абзацы/таблицы/фенсы, мелкие секции подтягиваются вверх, брейдкрамб [A > B] повторяется в каждой части. Панель повторяет этот контракт для иллюстрации: поменяйте параметры — текст будет нарезан заново.",
  ingestHonest:
    "Честно про образец: окна в индексе нарезаны token-чанкером LightRAG (ровно 2048 токенов, перекрытия 186–217, 476–520, 760–793, 1035–1068 строк), а md_struct не перекрывает окна и выравнивает их по секциям. Поэтому дорожек две.",
  ingestKindSection: "секция целиком",
  ingestKindPart: "часть секции",
  ingestKindMerged: "слито вверх",
} as const;

export type Dict = Record<keyof typeof RU, string>;

const EN: Dict = {
  brandSub: "· how machine memory works",
  tabCosmos: "cosmos",
  tabTravel: "travel",
  aboutLink: "about · v1",
  cosmosTitle: "Memory Cosmos",
  cosmosSub:
    "The live HARS knowledge graph — {n} entities, {m} relations, laid out by meaning (3D UMAP over stored 768-dim vectors — a true starfield you can orbit). Not a mock: this is the production index.",
  searchPlaceholder: "find an entity… (e.g. VEA, DROID, checkpoint)",
  searchClear: "clear search",
  searchMetaTop: "{n} matches — top {k} below, matches lit on the map",
  searchMetaNone: "no entities match",
  legendTitle: "entity types",
  legendShown: "{a} / {b} shown",
  legendShowAll: "show all types",
  resetView: "reset view",
  tourButton: "Presentation: how the memory works",
  hintOrbit: "drag to orbit · scroll to zoom · right-drag to pan · click a star for details",
  flyTo: "fly to",
  clearHighlight: "clear highlight",
  degreeLinks1: "1 direct relation",
  degreeLinksN: "{n} direct relations",
  noDesc: "no description stored for this entity",
  loadingStars: "lighting up 47k stars…",
  qbPlaceholder: "Ask the memory… (live recall, up to 120s)",
  qbAsk: "ask",
  qbCancel: "cancel",
  qbChars: "0/500",
  qbHistory: "recent:",
  qbClearHistory: "clear",
  fallbackBadge:
    "canvas2d fallback — no WebGL2 in this browser, so the 3D starfield can't run; same data, same journey, flat projection.",
  hudNodesEdges: "{n} nodes · {m} edges",
  travelTitle: "Memory Travel",
  travelSub:
    "One real query's journey through the memory machinery — every score, latency and id below is saved telemetry, not a mockup.",
  travelLive: "live",
  travelLoadingTrace: "loading trace…",
  travelSubgraphLoading: "loading subgraph…",
  travelCanvasUnavailable:
    "Canvas unavailable (WebGL2 + 2D fallback both failed) — the telemetry text below stays readable.",
  travelLiveNote:
    "Live recall — same trace format as fixtures (per-chunk entities by mention; query marker at the top-hits centroid; no embedder in the browser).",
  cameraJourney: "camera: journey",
  cameraFree: "camera: free",
  journeyLogTitle: "journey log",
  journeyLogEmpty: "empty — press play",
  journeyLogDropped: "{n} unresolved refs omitted",
  stagePrev: "previous stage (←)",
  stageNext: "next stage (→)",
  stagePlay: "play (space)",
  stagePause: "pause (space)",
  stageScrubber: "stage scrubber",
  speedTitle: "playback speed",
  inspectTitle: "stage inspector",
  chunkTitle: "chunk content",
  inspectClose: "close",
  inspectOpen: "stage data",
  scoreDense: "dense",
  scoreSparse: "bm25",
  scoreFused: "fusion",
  scoreRerank: "rerank",
  inFinalContext: "in final context",
  notInFinalContext: "not served to the LLM",
  sourceFile: "source",
  section: "section",
  showMore: "show more",
  showLess: "show less",
  openSourceNote: "open source note",
  rank: "rank",
  deltaToTop: "delta to top",
  beforeAfter_in: "fusion order (in)",
  beforeAfter_out: "served order (out)",
  rerankSkipped: "rerank SKIPPED — {reason}",
  ringAdded: "ring {d}: +{n} entities",
  edgesTraversed: "edges traversed: {n}",
  contextBudget: "budget: {used} / {total} chars",
  presLaunch: "Presentation: how the memory works",
  presExit: "exit (Esc)",
  presMenu: "chapters",
  presLang: "language",
  presAutoplay: "autoplay",
  presChapter: "chapter {n} / {total}",
  presNext: "next (→)",
  presPrev: "back (←)",
  presFullscreen: "fullscreen (F)",
  presLoading: "preparing data…",
  cardsAria: "chapter data",
  cardQuestion: "question",
  cardEmbedding: "embedding",
  cardVectorDims: "UMAP 768-d → x,y,z",
  cardTopDense: "top-12 dense scores",
  cardPool: "candidate pool",
  cardLatencyDense: "dense, ms",
  cardLatencySparse: "bm25, ms",
  cardVectorCh: "vector channel",
  cardSparseCh: "BM25 channel",
  cardGraphCh: "graph channel",
  cardHits: "hits",
  cardTopScore: "top score",
  cardBm25Chunks: "BM25 chunks",
  cardSeeds: "seeds",
  cardEdges: "edges traversed",
  cardNodes: "subgraph nodes",
  cardFused: "fused ranking",
  cardAlpha: "α (dense weight)",
  cardMoved: "moved",
  cardApplied: "rerank applied",
  cardRerankPool: "rerank pool",
  cardBlocked: "inversions blocked",
  cardEntityFacts: "entity facts",
  cardContext: "context",
  cardSources: "sources",
  cardAnswer: "answer",
  cardCitations: "citations",
  cardQuotes: "quotes in preview",
  ingestExtract: "teacher extraction records",
  ingestEntities: "entities",
  ingestRelations: "relations",
  ingestNoRelations: "no relations in this sample — the teacher emitted entities only",
  ingestNoEntities: "no records in this sample",
  ingestDoc: "source document",
  ingestDocMeta: "{lines} lines · {chars} chars · {chunks} index windows",
  ingestParams: "chunking parameters",
  ingestLaneIndex: "as ingested",
  ingestLaneMirror: "md_struct, re-split from the parameters above",
  ingestOverlap: "overlap",
  ingestSection: "section boundary",
  ingestTokens: "{n} tok",
  ingestEstTokens: "≈{n} tok (chars//4)",
  ingestMirrorNote: "tokenizer-free estimate chars//4, as in md_struct.estimate_tokens",
  ingestReset: "index values",
  ingestChunk: "chunk",
  ingestSectionTag: "section",
  ingestHoverHint: "hover a window or a record — both panels light up",
  ingestClickHint: "click a window to pin it and scroll the note to its lines",
  ingestMeta: "{n} teacher records · {r} relations · {c} index windows",
  ingestCaption:
    "The production splitter is hars_memory/ingest/md_structure.py: heading sections → paragraphs/tables/fences, tiny sections merge up, the [A > B] breadcrumb repeats in every part. This panel mirrors that contract for illustration: change the parameters and the text is cut again.",
  ingestHonest:
    "Honest about the sample: the index windows were cut by LightRAG's token chunker (exactly 2048 tokens, overlaps at lines 186–217, 476–520, 760–793, 1035–1068), while md_struct never overlaps and aligns to sections. Hence two lanes.",
  ingestKindSection: "whole section",
  ingestKindPart: "part of a section",
  ingestKindMerged: "merged up",
};

export const STRINGS: Record<Lang, Dict> = { ru: RU, en: EN };

const LANG_KEY = "mt.lang.v1";

export function loadLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return v === "en" ? "en" : "ru";
  } catch {
    return "ru";
  }
}

export function saveLang(l: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, l);
  } catch { /* private mode */ }
}

/** Interpolate {a}/{b} placeholders into a template. */
export function fmt(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

/** Tiny React hook (no context — one module-level listener set). */
let listeners: (() => void)[] = [];
let currentLang: Lang = loadLang();

export function getLang(): Lang {
  return currentLang;
}

export function setLang(l: Lang): void {
  currentLang = l;
  saveLang(l);
  listeners.forEach((fn) => fn());
}

export function subscribeLang(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((f) => f !== fn);
  };
}
