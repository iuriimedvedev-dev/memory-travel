// Presentation chapter 2 — "how knowledge enters memory", two panels:
//
//   LEFT  teacher extraction records (entities/relations, verbatim from the
//         index's llm_response_cache) as AnimatedCards;
//   RIGHT the SOURCE DOCUMENT preview — the note's real text rendered as
//         structured markdown with the chunk WINDOWS visualised on it,
//         plus the parameterised chunk-split table.
//
// Everything on the right is driven by `chunkingParams.ts` (values + mirror
// splitter) — no number is written in this file. The note text, the index
// windows and the extraction records all come from ingest_fixture.json.
//
// Hover works both ways: a window highlights its extraction records and a
// record highlights its window (real chunks by chunk_id, mirror windows by
// line-range intersection, which is stated in the labels).
import { useMemo, useRef, useState } from "react";
import {
  CHUNKING_PARAMS,
  type ChunkingParams,
  MD_STRUCT_PATH,
  TOKEN_CHUNKER_SOURCE,
  overlapRegions,
  paramRows,
  sectionBoundaries,
  splitNote,
  windowOf,
} from "../lib/chunkingParams";
import type { IngestFixture } from "../lib/types";
import { fmt, type Dict, type Lang } from "../i18n/strings";
import { AnimatedCard } from "./AnimatedCard";

type Hover = { kind: "real" | "mirror"; i: number } | null;

export function IngestPanel({ fixture, lang, t }: { fixture: IngestFixture; lang: Lang; t: Dict }) {
  const text = fixture.doc.text || fixture.doc.preview;
  const lines = useMemo(() => text.replace(/\s+$/, "").split("\n"), [text]);
  const [params, setParams] = useState<ChunkingParams>(CHUNKING_PARAMS);
  const [hover, setHover] = useState<Hover>(null);
  const [pinned, setPinned] = useState<Hover>(null);
  const [hoverChunkId, setHoverChunkId] = useState<string | null>(null);
  const docRef = useRef<HTMLDivElement | null>(null);

  /** Bring a window's first line into view (a pinned window scrolls the note). */
  const scrollToLine = (line: number) => {
    const el = docRef.current;
    const row = el?.querySelector<HTMLElement>(`[data-line="${line}"]`);
    if (!el || !row) return;
    const delta = row.getBoundingClientRect().top - el.getBoundingClientRect().top;
    el.scrollTop += delta - el.clientHeight * 0.3;
  };

  const real = useMemo(
    () => fixture.chunks.map((c) => ({ startLine: c.start_line, endLine: c.end_line })),
    [fixture.chunks],
  );
  const mirror = useMemo(() => splitNote(text, params), [text, params]);
  const realOverlaps = useMemo(() => overlapRegions(real), [real]);
  const boundaries = useMemo(() => sectionBoundaries(text), [text]);
  // line -> "is inside any overlap region" (drawn distinctly on the gutter)
  const overlapLines = useMemo(() => {
    const s = new Set<number>();
    realOverlaps.forEach((o) => {
      for (let l = o.start; l <= o.end; l++) s.add(l);
    });
    return s;
  }, [realOverlaps]);
  const boundaryLines = useMemo(() => new Map(boundaries.map((b) => [b.line, b])), [boundaries]);

  const active: Hover =
    hover ??
    pinned ??
    (() => {
      if (!hoverChunkId) return null;
      const i = fixture.chunks.findIndex((c) => c.chunk_id === hoverChunkId);
      return i >= 0 ? { kind: "real" as const, i } : null;
    })();

  /** Real chunk indices the active window touches (the two panels' joint key). */
  const litChunks = useMemo(() => {
    if (!active) return new Set<number>();
    if (active.kind === "real") return new Set([active.i]);
    const w = mirror[active.i];
    if (!w) return new Set<number>();
    return new Set(
      real
        .map((r, i) => (r.startLine <= w.endLine && r.endLine >= w.startLine ? i : -1))
        .filter((i) => i >= 0),
    );
  }, [active, mirror, real]);

  const litChunkIds = useMemo(() => {
    const ids = new Set<string>();
    litChunks.forEach((i) => fixture.chunks[i] && ids.add(fixture.chunks[i].chunk_id));
    return ids;
  }, [litChunks, fixture.chunks]);

  const maxLine = Math.max(1, lines.length, ...real.map((r) => r.endLine));
  const pct = (line: number) => `${((line - 1) / maxLine) * 100}%`;
  const width = (from: number, to: number) => `${((to - from + 1) / maxLine) * 100}%`;
  const kindLabel = (k: string) => (k === "part" ? t.ingestKindPart : k === "merged" ? t.ingestKindMerged : t.ingestKindSection);

  const set = (patch: Partial<ChunkingParams>) => setParams((p) => ({ ...p, ...patch }));

  return (
    <div className="ingest" aria-label={t.ingestDoc}>
      {/* ---------------- LEFT: teacher extraction records ---------------- */}
      <div className="ingest-col left">
        <AnimatedCard
          open
          variant="accent"
          size="md"
          title={t.ingestExtract}
          meta={fmt(t.ingestMeta, { n: fixture.entities.length, r: fixture.relations.length, c: fixture.chunks.length })}
        >
          <p className="dim ingesthint">{t.ingestHoverHint}</p>
          <p className="dim ingesthint">{t.ingestClickHint}</p>
          <h4>{t.ingestEntities}</h4>
          {fixture.entities.length === 0 && <p className="dim">{t.ingestNoEntities}</p>}
          <ul className="recs">
            {fixture.entities.map((e, i) => {
              const chunkIdx = fixture.chunks.findIndex((c) => c.chunk_id === e.chunk);
              const lit = litChunkIds.has(e.chunk);
              return (
                <li
                  key={`${e.name}-${i}`}
                  className={lit ? "rec lit" : "rec"}
                  onMouseEnter={() => {
                    setHoverChunkId(e.chunk);
                    if (chunkIdx >= 0) setHover({ kind: "real", i: chunkIdx });
                  }}
                  onMouseLeave={() => {
                    setHoverChunkId(null);
                    setHover(null);
                  }}
                >
                  <span className="recname">{e.name}</span>
                  <span className="rectype">{e.type}</span>
                  <span className="reccap">{sectionCaption(fixture, e.chunk, t)}</span>
                  <span className="recdesc dim">{e.desc}</span>
                </li>
              );
            })}
          </ul>
          <h4>{t.ingestRelations}</h4>
          {fixture.relations.length === 0 ? (
            <p className="dim">{t.ingestNoRelations}</p>
          ) : (
            <ul className="recs">
              {fixture.relations.map((r, i) => (
                <li key={`${r.source}-${r.target}-${i}`} className="rec">
                  <span className="recname">
                    {r.source} <span className="dim">→</span> {r.target}
                  </span>
                  <span className="rectype">{r.weight}</span>
                  <span className="recdesc dim">{r.desc}</span>
                </li>
              ))}
            </ul>
          )}
        </AnimatedCard>
      </div>

      {/* ---------------- RIGHT: source document + chunk windows ------------- */}
      <div className="ingest-col right">
        <AnimatedCard
          open
          variant="plain"
          size="lg"
          title={fixture.doc.file_path}
          meta={fmt(t.ingestDocMeta, {
            lines: (fixture.doc.line_count || lines.length).toLocaleString(lang === "ru" ? "ru-RU" : "en-US"),
            chars: fixture.doc.size_chars.toLocaleString(lang === "ru" ? "ru-RU" : "en-US"),
            chunks: fixture.chunks.length,
          })}
        >
          {/* parameters: values come from chunkingParams.ts, never from here */}
          <div className="smalls">
            <h5>{t.ingestParams}</h5>
            <table>
              <tbody>
                {paramRows(params).map((row) => (
                  <tr key={row.id}>
                    <td className="k">{row.id}</td>
                    <td className="v">
                      {row.id === "chunk_token_size" ? (
                        <input
                          type="number"
                          min={64}
                          max={8192}
                          step={64}
                          value={params.chunkTokenSize}
                          onChange={(e) => set({ chunkTokenSize: Math.max(1, Number(e.target.value) || 1) })}
                        />
                      ) : row.id === "chunk_overlap_token_size" ? (
                        <input
                          type="number"
                          min={0}
                          max={1024}
                          step={8}
                          value={params.chunkOverlapTokenSize}
                          onChange={(e) => set({ chunkOverlapTokenSize: Math.max(0, Number(e.target.value) || 0) })}
                        />
                      ) : row.id === "min_section_merge" ? (
                        <input
                          type="number"
                          min={0}
                          max={4000}
                          step={50}
                          value={params.minMergeChars}
                          onChange={(e) => set({ minMergeChars: Math.max(0, Number(e.target.value) || 0) })}
                        />
                      ) : (
                        row.value
                      )}
                    </td>
                    <td className="src dim">{row.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="paramfoot dim">
              <span>
                {t.ingestChunk}: {mirror.length}
              </span>
              <button className="reset" onClick={() => setParams(CHUNKING_PARAMS)}>
                {t.ingestReset}
              </button>
            </div>
            <p className="dim caption">{t.ingestCaption}</p>
          </div>

          {/* the two window lanes over the same line axis */}
          <div className="lanes">
            <Lane
              label={t.ingestLaneIndex}
              wins={fixture.chunks.map((c, i) => ({
                key: c.chunk_id,
                start: c.start_line,
                end: c.end_line,
                text: fmt(t.ingestTokens, { n: c.tokens }),
                cap: `${t.ingestSectionTag}: ${c.section || c.heading_path.slice(-1)[0] || ""}`,
                i,
              }))}
              active={active?.kind === "real" ? active.i : -1}
              pct={pct}
              width={width}
              onHover={(i) => setHover(i === null ? null : { kind: "real", i })}
              onPin={(i) => {
                setPinned(i === null ? null : { kind: "real", i });
                if (i !== null && fixture.chunks[i]) scrollToLine(fixture.chunks[i].start_line);
              }}
            />
            <Lane
              label={t.ingestLaneMirror}
              wins={mirror.map((w, i) => ({
                key: `${w.index}-${w.startLine}`,
                start: w.startLine,
                end: w.endLine,
                text: fmt(t.ingestEstTokens, { n: w.estTokens }),
                cap: `${kindLabel(w.kind)} · ${w.section || ""}`,
                i,
              }))}
              active={active?.kind === "mirror" ? active.i : -1}
              pct={pct}
              width={width}
              onHover={(i) => setHover(i === null ? null : { kind: "mirror", i })}
              onPin={(i) => {
                setPinned(i === null ? null : { kind: "mirror", i });
                if (i !== null && mirror[i]) scrollToLine(mirror[i].startLine);
              }}
            />
            <div className="lanelegend dim">
              <span className="lg overlap">{t.ingestOverlap}</span>
              <span className="lg section">{t.ingestSection}</span>
              <span>{t.ingestMirrorNote}</span>
            </div>
          </div>

          {/* the note itself, tinted by the index windows */}
          <div className="doc" ref={docRef}>
            {lines.map((line, i) => {
              const n = i + 1;
              const rw = windowOf(real, n);
              const mw = windowOf(mirror, n);
              const hot = rw !== null && rw === (active?.kind === "real" ? active.i : -1);
              const cls = [
                "dl",
                rw !== null ? `rw rw${rw % 3}` : "",
                overlapLines.has(n) ? "ov" : "",
                mw !== null ? "mw" : "",
                hot ? "hot" : "",
                active && litChunks.size ? (rw !== null && litChunks.has(rw) ? "lit" : "rest") : "",
              ]
                .filter(Boolean)
                .join(" ");
              const b = boundaryLines.get(n);
              return (
                <div className={cls} key={n} data-line={n}>
                  <span className="ln">{n}</span>
                  <span className={`lt ${lineKind(line)}${b ? " ishead" : ""}`}>
                    {b && <i className={`htag h${b.level}`}>{b.title}</i>}
                    {line}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="dim caption">{t.ingestHonest}</p>
          <p className="dim caption srcs">
            {MD_STRUCT_PATH} · {TOKEN_CHUNKER_SOURCE}
          </p>
        </AnimatedCard>
      </div>
    </div>
  );
}

/** One window lane over the shared line axis (index reality or mirror split). */
function Lane({
  label,
  wins,
  active,
  pct,
  width,
  onHover,
  onPin,
}: {
  label: string;
  wins: { key: string; start: number; end: number; text: string; cap: string; i: number }[];
  active: number;
  pct: (line: number) => string;
  width: (a: number, b: number) => string;
  onHover: (i: number | null) => void;
  onPin: (i: number | null) => void;
}) {
  return (
    <div className="lane">
      <span className="lanelabel">{label}</span>
      <div className="track" onMouseLeave={() => onHover(null)}>
        {wins.map((w) => (
          <button
            key={w.key}
            className={w.i === active ? "win on" : "win"}
            style={{ left: pct(w.start), width: width(w.start, w.end) }}
            title={`${w.cap} · ${w.start}–${w.end}`}
            onMouseEnter={() => onHover(w.i)}
            onClick={() => onPin(w.i === active ? null : w.i)}
          >
            <b>{w.text}</b>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Rough markdown line classification for the structured-text rendering. */
function lineKind(line: string): string {
  const s = line.trim();
  if (/^#{1,6}\s/.test(s)) return "head";
  if (/^```|^~~~/.test(s)) return "fence";
  if (/^\|/.test(s)) return "table";
  if (/^-{3,}$|^\*{3,}$|^_{3,}$/.test(s)) return "hr";
  if (/^\[Document:/.test(s)) return "metahead";
  if (/^\*\*[^*]+\*\*:/.test(s)) return "kv";
  if (/^[-*]\s/.test(s)) return "list";
  return "";
}

/** Which index window an extraction record came from (compact caption). */
function sectionCaption(fixture: IngestFixture, chunkId: string, t: Dict): string {
  const c = fixture.chunks.find((x) => x.chunk_id === chunkId);
  if (!c) return "";
  const sec = c.section || c.heading_path.slice(-1)[0] || "";
  return `${t.ingestChunk} ${c.start_line}–${c.end_line}${sec ? ` · ${sec}` : ""}`;
}
