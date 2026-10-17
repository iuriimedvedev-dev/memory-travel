# Presentation mode — «Презентация: как работает память»

A guided 9-chapter walkthrough of how the HARS long-term memory works, driven
entirely by real data (the exported 47k-entity graph + one real `memory_recall`
trace). Launched from the tour button on the cosmos panel; `Esc` exits.

Bilingual from day one: **EN (default)** and RU, switchable mid-presentation via
the RU/EN toggle (top-right) — the chapter position is kept, only the strings
swap. Language persists in `localStorage` (`mt.lang.v1`); a fresh browser (or a
cleared key) boots in English, and only an explicitly stored `ru` switches to
Russian.

## Controls

| Key / UI | Action |
| --- | --- |
| `←` / `→` | previous / next chapter |
| `Space` | play / pause the current chapter's animation |
| `F` | fullscreen |
| `Esc` | close chapter menu, or exit the presentation |
| «Главы» button | chapter menu overlay |
| «данные этапа» button (gear icon) | opens the stage inspector over the live scene (trace chapters) |
| RU / EN toggle | switch narration language without losing position |

Every control glyph is a monochrome inline SVG (`components/icons.tsx`): the
presentation ships **zero emoji**, enforced by `npm run lint:no-emoji`
(also wired as `prebuild`, so `npm run build` fails on a pasted emoji).

## Cards (AnimatedCard)

One reusable card component (`components/AnimatedCard.tsx`) draws the frame and
the content in two phases (gradient frame sweeps on → content slides in; quick
fade on exit). It is used for:

- the **narration** card (`plain` / `lg`) and the **fact** card (`accent` / `md`)
  in the bottom panel — keyed by chapter id, so every chapter change replays
  the entrance;
- the **node selection tooltip** in the cosmos view (`accent` / `sm`);
- the **docked chapter cards** (below);
- the two **ingest panels** (chapter 2).

Props/slots: `open`, `children`, `title`, `meta`, `variant` (`accent|gold|plain`),
`size` (`sm|md|lg`), `className`, `style`, `delayMs` (stagger), `onClose`,
`closeTitle`.

## Docked chapter cards (chapters 3–8)

Chapters 3–8 (the transformation chapters) dock a row of AnimatedCards at the
top of the cosmos view, staggered left→right (`delayMs = i * 110`) while the
camera flight keeps playing behind them. Every number comes straight out of the
loaded trace (`components/PresStageCards.tsx`), never invented:

| Chapter | Cards |
| --- | --- |
| 3 question→embedding | question text; embedding (model/dim + real UMAP x,y,z strip, candidate pool, dense ms, top score, top-12 dense score bars) |
| 4 channels | vector channel (hits/top score/dense ms + bars), BM25 channel (hits/top score/sparse ms/BM25 chunks + bars), graph channel (seeds/nodes/edges traversed + degree bars) |
| 5 fusion | fused ranking (fused bars + per-channel dense/sparse contribution bars with dense/sparse ranks, α from the trace) |
| 6 rerank | before/after top-5 ordering with moved rows, backend/pool/blocked inversions/moved count (or the honest skip reason) |
| 7 context | assembled chars / 15 000 budget, entity facts, relations, sources, preview quotes + entity list |
| 8 synthesis | answer quote + client latency, quotes/citations counts, citation list (`[A1]…`, `[ref n]`) |

Model identity (EmbeddingGemma 768-d, Qwen3-Reranker-0.6B on iGPU) is a shared
constant in `app/src/lib/presentation.ts` (`PIPELINE`) — the same facts the
narrations state, not per-trace telemetry.

## Chapters (viz source: `cosmos` = full 47k starfield, `trace` = the recall subgraph)

The narration texts below are the exact strings from
`app/src/lib/presentation.ts` (type-safe `L10n {ru, en}` pairs — a missing
translation is a build error). `{…}` are filled with real trace telemetry at
runtime.

### 1. Что это / What this is — `cosmos`
- **RU:** «Перед вами долговременная память агента: 1 854 заметки превращены в {nodes} сущностей и {edges} связей. Это GraphRAG-гибрид: векторный поиск по смыслу + knowledge graph + BM25 по словам. Каждая звезда — реальная сущность продакшн-индекса, положение — 3D UMAP по 768-мерным векторам.»
- **EN:** “This is an agent's long-term memory: 1,854 notes distilled into {nodes} entities and {edges} relations. A GraphRAG hybrid: semantic vector search + a knowledge graph + BM25 over words. Every star is a real entity of the production index; positions are a 3D UMAP of 768-dim vectors.”
- **Fact:** `47 355 сущностей · 54 502 связей — не мокап, а живой индекс.`

### 2. Как знание попадает в память / How knowledge enters memory — `cosmos`
- Two panels (`components/IngestPanel.tsx`): LEFT the teacher's REAL extraction
  records (entities/relations from the index `llm_response_cache`, in
  AnimatedCards); RIGHT the REAL note (`docs-specs-demo-alignment-task.spec.md`)
  rendered as structured text with the **chunk windows visualised** — each
  index window's line range tinted (alternating), overlapping ranges marked
  with a striped band, heading boundaries tagged, and per-window token counts.
- **Parameterised split preview**: the parameter table is derived from
  `app/src/lib/chunkingParams.ts` (`chunk_token_size` 2048,
  `chunk_overlap_token_size` 64, `mode` `md_struct`, `min_section_merge`
  200 chars, derived `target_chars` = tokens × 4). The numbers are editable in
  place and the note is re-split live by `splitNote()` — a client-side mirror of
  the production splitter `hars_memory/ingest/md_structure.py` (section
  boundaries → paragraph/table/fence blocks, `[A > B]` breadcrumb repeated,
  runt sections merged up), labelled as an illustration.
- **Two lanes, on purpose**: "как в индексе" shows the verbatim index windows
  (the sampled note was ingested by LightRAG's token chunker: five windows of
  exactly 2048 / 2048 / 2048 / 2048 / 308 tokens with real line overlaps at
  186–217, 476–520, 760–793, 1035–1068), while "md_struct, по параметрам выше"
  shows the mirror split (25 section-aligned windows, no overlap unless the
  overlap parameter is raised). The caption states this difference instead of
  pretending one splitter explains the other.
- **Hover works both ways**: a window lights its extraction records (by
  `chunk_id` for index windows, by line-range intersection for mirror windows)
  and dims the rest of the note; hovering a record lights its window and its
  lines. Clicking a window pins the highlight and scrolls the note to its first
  line.
- Data: `scripts/export_ingest_fixture.py` (read-only) → `app/public/data/ingest_fixture.json`,
  which now carries the note's full `doc.text` + `doc.line_count` so the panel
  can render the same lines the chunk ranges index into (32 227 chars / 1 074 lines).
- **RU:** «Заметка разрезается md_struct-чанкером по секциям (заголовки → секции → чанки с номерами строк). Учитель — локальная 27B модель — извлекает из каждого чанка сущности и связи; мердж идёт в общий граф. Справа в карточке — настоящая заметка и её настоящие extraction-записи из кэша учителя.»

### 3. Вопрос → эмбеддинг / Question → embedding — `trace` (stage: query)
- The magenta query beacon lands at the question's true UMAP position.
- **Fact (real):** «dense-поиск по 30 чанкам занял 36.65 мс.»

### 4. Параллельные каналы / Parallel channels — `trace` (stage: vector)
- Cyan vector hits pulse in staggered by score; the narration contrasts the
  channels' failure modes.

### 5. Фьюжн / Fusion — `trace` (stage: fusion)
- Orange fused-ranking pulses; real α = 0.5; fact: `fusion recall@10 = 0.979 при 12.7 мс`.

### 6. Реранк / Rerank — `trace` (stage: rerank)
- White flares mark chunks that moved; guardrail/skip behaviour from telemetry.

### 7. Сборка контекста / Context assembly — `trace` (stage: context)
- Gold lines connect the query marker to every context entity; budget numbers
  (15 000 chars, 6 000 per doc, whole-document granularity).

### 8. Синтез / Synthesis — `trace` (stage: answer)
- The pink journey trail through query → fusion hits → answer anchors, camera
  pulled back; per-fact citations.

### 9. Цифры / The numbers — `cosmos`
- Measured results: `fusion recall@10 = 0.979 @ 12.7 мс; реранк ~1.6 с на iGPU;
  1 854 документа, 60 117 связей`.

## Data provenance

- Full graph: `app/public/data/graph.json` (+3D UMAP coords) — exported from
  the production index, see `docs/SETUP.md` §3.
- Trace: `app/public/data/traces/trace_01.json` — compiled from a captured
  `memory_recall` fixture.
- Ingest fixture: `app/public/data/ingest_fixture.json` — verbatim index
  records (no synthesis): the note text, its index chunk windows and the
  teacher's extraction records.

## Zero-emoji gate

`npm run lint:no-emoji` (`scripts/no-emoji-check.mjs`, stdlib only) sweeps
`app/src` (ts/tsx/css/html), `app/index.html` and `app/public/data` JSON and
fails on any emoji/pictograph codepoint (emoji blocks, dingbats, misc symbols,
geometric shapes, flags, variation selectors). It runs as `prebuild`, so
`npm run build` cannot go green with an emoji in the tree. Typographic glyphs
the copy legitimately uses are not hits (arrows `← → ↑ ↓`, `· — – … « » × ≤ ≥ ≈ α §`);
in data fixtures the geometric-shapes block is allowed because it appears in
verbatim markdown ASCII-art diagrams (box drawing), while UI sources are
scanned with the full class. Replace a hit with an icon from
`app/src/components/icons.tsx`.

## Reduced motion / fallback

`prefers-reduced-motion` collapses the CSS animations globally (media query in
`index.css`); without WebGL2 the Canvas2D fallback renderer drives the same
chapters in flat projection (camera flights degrade to eased zooms).
