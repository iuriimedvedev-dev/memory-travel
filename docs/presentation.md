# Presentation mode — «Презентация: как работает память»

A guided 9-chapter walkthrough of how the HARS long-term memory works, driven
entirely by real data (the exported 47k-entity graph + one real `memory_recall`
trace). Launched from the tour button on the cosmos panel; `Esc` exits.

Bilingual from day one: RU (default) and EN, switchable mid-presentation via
the RU/EN toggle (top-right) — the chapter position is kept, only the strings
swap. Language persists in `localStorage` (`mt.lang.v1`).

## Controls

| Key / UI | Action |
| --- | --- |
| `←` / `→` | previous / next chapter |
| `Space` | play / pause the current chapter's animation |
| `F` | fullscreen |
| `Esc` | close chapter menu, or exit the presentation |
| «Главы» button | chapter menu overlay |
| «данные этапа ⚙» | opens the stage inspector over the live scene (trace chapters) |
| RU / EN toggle | switch narration language without losing position |

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
- Shows a REAL note (`docs-specs-demo-alignment-task.spec.md`), its REAL
  md_struct section chunks (heading path / line ranges / tokens), and the
  teacher's REAL extraction records — exported verbatim from the index kv
  stores by `scripts/export_ingest_fixture.py` into `app/public/data/ingest_fixture.json`.
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
  records (no synthesis).

## Reduced motion / fallback

`prefers-reduced-motion` collapses the CSS animations globally (media query in
`index.css`); without WebGL2 the Canvas2D fallback renderer drives the same
chapters in flat projection (camera flights degrade to eased zooms).
