import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CosmosCanvas, { type RenderMode } from "./components/CosmosCanvas";
import CosmosView from "./components/CosmosView";
import AboutModal from "./components/AboutModal";
import ErrorOverlay from "./components/ErrorOverlay";
import PresentationView from "./components/PresentationView";
import ProjectSelector from "./components/ProjectSelector";
import QueryBar, { type HistoryEntry } from "./components/QueryBar";
import PipelineWidget from "./components/PipelineWidget";
import UiScaleSlider from "./components/UiScaleSlider";
import {
  ArrowLeftIcon,
  DatabaseIcon,
  DialogScopeIcon,
  InfoIcon,
  KnotGateLogoMark,
  MoonIcon,
  NodesIcon,
  RouteIcon,
  SunIcon,
  XIcon,
} from "./components/icons";
import { INK, toWorld3, type XYZ } from "./lib/cosmos";
import type { AnyCosmos } from "./lib/cosmos2d";
import { asJourney3D } from "./lib/cosmos3d";
import { compileLiveTrace } from "./lib/compileLive";
import {
  loadDemoCosmos,
  loadLiveCosmos,
  probeGraphStats,
  type LoadedCosmos,
  type SourcePhase,
} from "./lib/cosmosSource";
import {
  BRIDGE_PROXY_PATH,
  applyTraceEvent,
  emptyBridgeInfo,
  emptySteps,
  estimateSteps,
  keywordsFor,
  markStepsError,
  memoryRecallLive,
  memoryStatusLive,
  mergeTraceStart,
  parseRecallTelemetry,
  probeTraceSupport,
  stepsFromTelemetry,
  streamRecallTrace,
  type ConnState,
  type RecallStep,
} from "./lib/live";
import { OAuthRedirectInProgressError, isOAuthRedirectInProgress } from "./lib/oauth";
import {
  DEFAULT_PROJECT_ID,
  defaultProjectEntry,
  fetchMemoryProjects,
  readInitialProjectFromUrl,
  readInitialQuestionFromUrl,
  resolveActiveProject,
  resolveSafeReturnTo,
  syncProjectInUrl,
  type MemoryProject,
} from "./lib/projects";
import { useTheme } from "./lib/theme";
import type { CosmosGraph, TravelTrace } from "./lib/types";
import { fmt } from "./i18n/strings";
import { useI18n } from "./i18n/useI18n";

const HISTORY_KEY = "mt.history.v1";
const HISTORY_MAX = 8;

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(h: HistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, HISTORY_MAX)));
  } catch {
    /* private mode etc — history just won't persist */
  }
}

export default function App() {
  const { t, lang, setLangL10n } = useI18n();
  const { theme, toggleTheme } = useTheme();

  // Deep-link URL parameters (?project=..., ?returnTo=..., ?q=...)
  const [projectId, setProjectId] = useState<string>(() => readInitialProjectFromUrl());
  const [projects, setProjects] = useState<MemoryProject[]>(() => [defaultProjectEntry()]);
  const [projectsLoading, setProjectsLoading] = useState<boolean>(true);
  const returnToHref = useMemo(() => resolveSafeReturnTo(), []);
  const initialUrlQuestion = useMemo(() => readInitialQuestionFromUrl(), []);
  const initialQuestionRanRef = useRef(false);

  const [presenting, setPresenting] = useState(false);
  const [cosmosFull, setCosmosFull] = useState<AnyCosmos | null>(null);
  const [graph, setGraph] = useState<CosmosGraph | null>(null);
  const [names, setNames] = useState<string[] | null>(null);
  const [progress, setProgress] = useState<string | null>(t.loadingIndex);
  const [dataError, setDataError] = useState<string | null>(null);
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [renderMode, setRenderMode] = useState<string | null>(null);
  const [modeDismissed, setModeDismissed] = useState(false);
  const [posByIdx, setPosByIdx] = useState<(XYZ | null)[] | null>(null);
  const [chunkXyz, setChunkXyz] = useState<Record<string, [number, number, number]>>({});

  // Live Q&A state (one box above both views).
  const [liveTrace, setLiveTrace] = useState<TravelTrace | null>(null);
  const [activeQuestion, setActiveQuestion] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState<number>(0);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [askNote, setAskNote] = useState<string | null>(null);
  const [elapsedS, setElapsedS] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [steps, setSteps] = useState<RecallStep[]>([]);
  const [about, setAbout] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef(0);
  const tracingRef = useRef(false);

  const activeProject = useMemo(
    () => resolveActiveProject(projects, projectId),
    [projects, projectId],
  );

  // Discover available projects (/memory/api/graph-stats/projects -> MCP fallback)
  useEffect(() => {
    let cancelled = false;
    setProjectsLoading(true);
    fetchMemoryProjects()
      .then((res) => {
        if (!cancelled) {
          setProjects(res.projects);
        }
      })
      .catch(() => {
        /* fallback already guarantees PIER KB */
      })
      .finally(() => {
        if (!cancelled) setProjectsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Connection identity for the selected scope
  const [conn, setConn] = useState<ConnState>({ kind: "connecting" });

  const refreshConn = useCallback(
    (targetProject?: string) => {
      const scope = targetProject ?? projectId;
      memoryStatusLive(scope)
        .then((info) => setConn({ kind: "connected", info }))
        .catch((e: unknown) => {
          if (e instanceof OAuthRedirectInProgressError || isOAuthRedirectInProgress()) {
            setConn({ kind: "connecting" });
            return;
          }
          setConn({ kind: "offline", error: e instanceof Error ? e.message : String(e) });
        });
    },
    [projectId],
  );

  useEffect(() => {
    refreshConn(projectId);
  }, [projectId, refreshConn]);

  const highlightStageInCosmos = useCallback(
    (stageIdx: number, tr: TravelTrace | null, qText: string) => {
      if (!cosmosFull || !graph || !names) return;
      if (stageIdx === 1) {
        let hitIdxs: number[] = [];
        if (tr && tr.vector_hits.length) {
          const entNames = new Set(tr.vector_hits.flatMap((h) => h.entities));
          hitIdxs = names
            .map((name, i) => (entNames.has(name) ? i : -1))
            .filter((i) => i >= 0);
        }
        if (!hitIdxs.length && qText) {
          const kws = keywordsFor(qText).map((k) => k.toLowerCase());
          hitIdxs = names
            .map((name, i) => (kws.some((k) => name.toLowerCase().includes(k)) ? i : -1))
            .filter((i) => i >= 0)
            .slice(0, 20);
        }
        if (!hitIdxs.length && graph && graph.nodes.length) {
          hitIdxs = graph.nodes
            .slice(0, 40)
            .sort((a, b) => b.deg - a.deg)
            .slice(0, 12)
            .map((_, i) => i);
        }
        if (hitIdxs.length) {
          cosmosFull.pulseCluster(hitIdxs, INK.vector, true);
        }
      } else if (stageIdx === 2) {
        let hitIdxs: number[] = [];
        if (tr && tr.bm25_hits.length) {
          const entNames = new Set(tr.bm25_hits.flatMap((h) => h.entities));
          hitIdxs = names
            .map((name, i) => (entNames.has(name) ? i : -1))
            .filter((i) => i >= 0);
        }
        if (!hitIdxs.length && graph && graph.nodes.length) {
          hitIdxs = graph.nodes
            .slice(5, 35)
            .sort((a, b) => b.deg - a.deg)
            .slice(0, 8)
            .map((_, i) => i + 5);
        }
        if (hitIdxs.length) {
          cosmosFull.pulseCluster(hitIdxs, INK.bm25, true);
        }
      } else if (stageIdx === 3) {
        let allGraphIdxs: number[] = [];
        const seedIdxSet = new Set<number>();
        if (tr && tr.graph.nodes.length) {
          allGraphIdxs = tr.graph.nodes.map((n) => n.i).filter((i) => i >= 0 && i < graph.nodes.length);
          tr.graph.nodes.forEach((n) => {
            if (n.seed && n.i >= 0 && n.i < graph.nodes.length) seedIdxSet.add(n.i);
          });
        }
        if (!allGraphIdxs.length && qText) {
          const kws = keywordsFor(qText).map((k) => k.toLowerCase());
          allGraphIdxs = names
            .map((name, i) => (kws.some((k) => name.toLowerCase().includes(k)) ? i : -1))
            .filter((i) => i >= 0)
            .slice(0, 15);
          allGraphIdxs.slice(0, 5).forEach((i) => seedIdxSet.add(i));
        }
        if (!allGraphIdxs.length && graph && graph.nodes.length) {
          allGraphIdxs = graph.nodes
            .slice(12, 45)
            .sort((a, b) => b.deg - a.deg)
            .slice(0, 14)
            .map((_, i) => i + 12);
          allGraphIdxs.slice(0, 4).forEach((i) => seedIdxSet.add(i));
        }
        if (allGraphIdxs.length) {
          // Graph Walk: Polar Gold (#EBCB8B) seeds + Borealis Violet (#B48EAD) walked neighbors
          cosmosFull.pulseCluster(allGraphIdxs, INK.gold, true);
          const paints = new Map<number, { color: typeof INK.gold; size?: number }>();
          const halos: { idx: number; color: typeof INK.gold; size: number }[] = [];
          for (const idx of allGraphIdxs) {
            const isSeed = seedIdxSet.has(idx);
            const col = isSeed ? INK.gold : INK.violet;
            paints.set(idx, { color: col, size: isSeed ? 3.2 : 2.5 });
            halos.push({ idx, color: col, size: isSeed ? 1.4 : 1.05 });
          }
          cosmosFull.paint(paints);
          cosmosFull.setHalos(halos);
        }
      } else if (stageIdx === 4 || stageIdx === 5) {
        let hitIdxs: number[] = [];
        if (tr && tr.fusion.length) {
          const entNames = new Set(tr.fusion.flatMap((h) => h.entities));
          hitIdxs = names
            .map((name, i) => (entNames.has(name) ? i : -1))
            .filter((i) => i >= 0);
        }
        if (hitIdxs.length) {
          cosmosFull.pulseCluster(hitIdxs, stageIdx === 5 ? INK.rerank : INK.orange, true);
        }
      } else if (stageIdx === 6) {
        let ansIdxs: number[] = [];
        if (tr && tr.answer_preview.length) {
          const entNames = new Set(tr.answer_preview.flatMap((b) => b.entities));
          ansIdxs = names
            .map((name, i) => (entNames.has(name) ? i : -1))
            .filter((i) => i >= 0);
        }
        if (!ansIdxs.length && tr && tr.fusion.length) {
          const entNames = new Set(tr.fusion.slice(0, 4).flatMap((h) => h.entities));
          ansIdxs = names
            .map((name, i) => (entNames.has(name) ? i : -1))
            .filter((i) => i >= 0);
        }
        if (ansIdxs.length) {
          cosmosFull.pulseCluster(ansIdxs, INK.frost, true);
        }
      }
    },
    [cosmosFull, graph, names],
  );

  useEffect(() => {
    if (!asking) return;
    setElapsedS(0);
    const id = window.setInterval(() => {
      const ms = performance.now() - startedAtRef.current;
      const s = ms / 1000;
      setElapsedS(s);
      if (!tracingRef.current) setSteps(estimateSteps(ms));

      let nextStage = 0;
      if (s >= 14.0) nextStage = 6;
      else if (s >= 11.5) nextStage = 5;
      else if (s >= 8.5) nextStage = 4;
      else if (s >= 5.5) nextStage = 3;
      else if (s >= 3.5) nextStage = 2;
      else if (s >= 1.2) nextStage = 1;

      setCurrentStage((prev) => {
        if (prev !== nextStage) {
          highlightStageInCosmos(nextStage, liveTrace, activeQuestion ?? "");
          return nextStage;
        }
        return prev;
      });
    }, 100);
    return () => window.clearInterval(id);
  }, [asking, activeQuestion, highlightStageInCosmos, liveTrace]);

  // ---- cosmos data source (scoped by projectId) ---------------------------
  const [source, setSource] = useState<SourcePhase>({ phase: "probing" });
  const [cosmosData, setCosmosData] = useState<LoadedCosmos | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [demoNoteDismissed, setDemoNoteDismissed] = useState(false);
  const loadGenRef = useRef(0);

  const applyCosmosData = useCallback(
    (data: LoadedCosmos) => {
      setCosmosData(data);
      setGraph(data.graph);
      setNames(data.names);
      setChunkXyz(data.chunkCoords);
      if (data.empty || data.graph.nodes.length === 0) {
        setPosByIdx([]);
        setProgress(null);
        cosmosFull?.clear();
        return;
      }
      const m = new Map<string, XYZ>();
      data.coords.ids.forEach((id, i) => {
        const v = data.coords.xyz?.[i];
        if (v) m.set(id, v);
        else {
          const xy = data.coords.xy[i];
          if (xy) m.set(id, [xy[0], xy[1], 0]);
        }
      });
      let hit = 0;
      const aligned = data.graph.nodes.map((n) => {
        const v = m.get(n.id) ?? null;
        if (v) hit++;
        return v ? toWorld3(v) : null;
      });
      setPosByIdx(aligned);
      setProgress(
        fmt(t.coordCoverage, { p: ((100 * hit) / Math.max(1, data.graph.nodes.length)).toFixed(1) }),
      );
    },
    [cosmosFull, t],
  );

  const loadLive = useCallback(
    (targetProject?: string) => {
      const scope = targetProject ?? projectId;
      let dead = false;
      const gen = ++loadGenRef.current;
      setSource({ phase: "probing" });
      setSourceError(null);
      setDataError(null);
      setProgress(t.srcProbing);
      probeGraphStats(scope)
        .then((stats) => {
          if (dead || gen !== loadGenRef.current) return;
          setProgress(t.loadingIndex);
          return loadLiveCosmos(stats, scope);
        })
        .then((data) => {
          if (dead || !data || gen !== loadGenRef.current) return;
          applyCosmosData(data);
          setSource({ phase: "live" });
        })
        .catch((e: unknown) => {
          if (dead || gen !== loadGenRef.current) return;
          if (e instanceof OAuthRedirectInProgressError || isOAuthRedirectInProgress()) {
            setSource({ phase: "probing" });
            return;
          }
          const msg = e instanceof Error ? e.message : String(e);
          setSourceError(msg);
          setSource({ phase: "unreachable", error: msg });
          setProgress(null);
        });
      return () => {
        dead = true;
      };
    },
    [applyCosmosData, projectId, t],
  );

  const handleSelectProject = useCallback(
    (nextProjectId: string) => {
      abortRef.current?.abort();
      setAsking(false);
      setActiveQuestion(null);
      setLiveTrace(null);
      setAskError(null);
      setAskNote(null);
      setSteps([]);
      setCosmosData(null);
      setGraph(null);
      setNames(null);
      setPosByIdx(null);
      cosmosFull?.clear();
      syncProjectInUrl(nextProjectId);
      setProjectId(nextProjectId);
    },
    [cosmosFull],
  );

  const openDemo = useCallback(() => {
    const gen = ++loadGenRef.current;
    setProgress(t.loadingIndex);
    setSourceError(null);
    loadDemoCosmos()
      .then((data) => {
        if (gen !== loadGenRef.current) return;
        applyCosmosData(data);
        setSource({ phase: "demo" });
      })
      .catch((e: unknown) => {
        if (gen !== loadGenRef.current) return;
        const msg = e instanceof Error ? e.message : String(e);
        setDataError(msg);
        setProgress(fmt(t.dataLoadFailed, { e: msg }));
      });
  }, [applyCosmosData, t]);

  const enterPresentation = useCallback(() => {
    setPresenting(true);
    if (source.phase !== "live") loadLive(projectId);
  }, [source.phase, loadLive, projectId]);

  useEffect(() => {
    const cleanup = loadLive(projectId);
    return cleanup;
    // Reload whenever `projectId` changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!cosmosFull || !graph || !posByIdx) return;
    if (graph.nodes.length === 0) {
      cosmosFull.clear();
      setProgress(null);
      return;
    }
    let dead = false;
    setProgress(t.loadingStars);
    cosmosFull
      .load(graph, posByIdx, (done, total) => {
        if (!dead && total > 0) setProgress(`${t.loadingStars} ${((done / total) * 100).toFixed(0)}%`);
      })
      .then(() => !dead && setProgress(null))
      .catch((e: unknown) => {
        if (dead) return;
        const msg = e instanceof Error ? e.message : String(e);
        setCanvasError(fmt(t.canvasLoadFailed, { e: msg }));
        setProgress(fmt(t.canvasLoadFailed, { e: msg }));
      });
    return () => {
      dead = true;
    };
  }, [cosmosFull, graph, posByIdx, t]);

  const focusNode = useCallback(
    (idx: number) => {
      if (!cosmosFull || !posByIdx) return;
      const p = posByIdx[idx];
      if (!p) return;
      const j = asJourney3D(cosmosFull);
      if (j) {
        j.flyToNode(p, 9.5, 850);
      } else {
        cosmosFull.flyTo(p[0], p[1], cosmosFull.currentZoom() * 3.2, 1400);
      }
    },
    [cosmosFull, posByIdx],
  );

  const onCanvasError = useCallback((e: Error) => {
    setCanvasError(e.message);
  }, []);

  const onMode = useCallback((m: RenderMode) => {
    setRenderMode(m);
  }, []);

  const isEmptyScope = Boolean(
    source.phase === "live" && (cosmosData?.empty || (graph !== null && graph.nodes.length === 0)),
  );
  const liveReady = graph !== null && graph.nodes.length > 0 && names !== null && posByIdx !== null;

  const askLive = useCallback(
    async (question: string) => {
      if (!graph || !names || !posByIdx || graph.nodes.length === 0) return;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      startedAtRef.current = performance.now();
      tracingRef.current = false;
      setActiveQuestion(question);
      setCurrentStage(0);
      highlightStageInCosmos(0, null, question);
      setSteps(emptySteps());
      setAsking(true);
      setAskError(null);
      setAskNote(null);
      try {
        const t0 = performance.now();
        const kws = keywordsFor(question);
        let result: Record<string, unknown> | null = null;
        let clientLatencyS = 0;
        let endpoint = BRIDGE_PROXY_PATH;
        if (await probeTraceSupport()) {
          try {
            result = await streamRecallTrace(
              question,
              (ev) => {
                tracingRef.current = true;
                if (ev.event === "trace_start") setConn((prev) => mergeTraceStart(prev, ev.data));
                setSteps((prev) => applyTraceEvent(prev, ev));
              },
              { signal: ctrl.signal, project: projectId },
              projectId,
            );
            if (result) clientLatencyS = (performance.now() - t0) / 1000;
          } catch (e) {
            if (e instanceof DOMException && e.name === "AbortError") throw e;
            if (e instanceof OAuthRedirectInProgressError || isOAuthRedirectInProgress()) throw e;
            result = null;
          }
        }
        if (!result) {
          const one = await memoryRecallLive(question, projectId, { signal: ctrl.signal });
          result = one.result;
          clientLatencyS = one.clientLatencyS;
          endpoint = one.endpoint;
        }
        setConn((prev) =>
          prev.kind === "connected" ? prev : { kind: "connected", info: { ...emptyBridgeInfo(), endpoint } },
        );
        const idxOf = new Map(names.map((n, i) => [n, i] as const));
        const entityXy = new Map<string, [number, number]>();
        const entityXyz = new Map<string, XYZ>();
        graph.nodes.forEach((n, i) => {
          const v = posByIdx[i];
          if (v) {
            entityXyz.set(n.id, v);
            entityXy.set(n.id, [v[0], v[1]]);
          }
        });
        const trace = compileLiveTrace(question, result, clientLatencyS, {
          graph,
          idxOf,
          entityXy,
          entityXyz,
          chunkXyz,
        });
        setLiveTrace(trace);
        tracingRef.current = true;
        const measured = stepsFromTelemetry(
          parseRecallTelemetry(result, clientLatencyS, kws, {
            seeds: trace.graph.nodes.filter((n) => n.seed).length,
            nodes: trace.graph.nodes.length,
            edges: trace.graph.edges.length,
          }),
        );
        setSteps((prev) =>
          prev.length === measured.length
            ? prev.map((r, i) =>
                r.estimated || r.status === "pending" || r.status === "active" ? measured[i] : r,
              )
            : measured,
        );
        setCurrentStage(6);
        highlightStageInCosmos(6, trace, question);
        const hits = trace.graph.nodes.filter((n) => n.seed).map((n) => n.i);
        const tookS = (performance.now() - t0) / 1000;
        setHistory((prev) => {
          const next = [{ q: question, ts: Date.now(), ms: tookS }, ...prev.filter((h) => h.q !== question)];
          saveHistory(next);
          return next.slice(0, HISTORY_MAX);
        });
        if (cosmosFull && hits.length) {
          focusNode(hits[0]);
          setAskNote(
            fmt(t.askNoteHits, {
              s: tookS.toFixed(1),
              via: endpoint.includes("/api/memory") ? t.askViaProxy : t.askViaDirect,
              n: hits.length,
            }),
          );
        } else if (!cosmosFull) {
          setAskNote(fmt(t.askNoteNoCanvas, { s: tookS.toFixed(1) }));
        } else {
          setAskNote(fmt(t.askNoteNoHits, { s: tookS.toFixed(1) }));
        }
      } catch (e) {
        tracingRef.current = true;
        if (e instanceof OAuthRedirectInProgressError || isOAuthRedirectInProgress()) {
          return;
        }
        if (e instanceof DOMException && e.name === "AbortError") {
          setAskError(t.askCancelled);
          setSteps((prev) => markStepsError(prev, "cancelled"));
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          setAskError(msg);
          setSteps((prev) => markStepsError(prev, msg));
        }
      } finally {
        abortRef.current = null;
        setAsking(false);
      }
    },
    [graph, names, posByIdx, chunkXyz, cosmosFull, focusNode, highlightStageInCosmos, projectId, t],
  );

  // If `?q=<question>` was deep-linked from a KnotGate dialog, run it once when live graph is ready
  useEffect(() => {
    if (!initialUrlQuestion || initialQuestionRanRef.current || !liveReady || asking) return;
    initialQuestionRanRef.current = true;
    void askLive(initialUrlQuestion);
  }, [initialUrlQuestion, liveReady, asking, askLive]);

  const cancelAsk = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const identity = cosmosData?.identity ?? null;
  const sampled = cosmosData?.sampled ?? null;
  const badgeLabel =
    source.phase === "live" && identity
      ? fmt(t.srcLiveBadge, { id: activeProject.name })
      : source.phase === "demo"
        ? t.srcDemoBadge
        : source.phase === "probing"
          ? t.srcProbing
          : t.srcOfflineBadge;
  const badgeTitle =
    source.phase === "live" && identity
      ? [
          fmt(t.srcLiveTitle, {
            id: `${activeProject.name} (${identity.index_id})`,
            docs: identity.docs ?? "?",
            n: identity.nodes != null ? identity.nodes.toLocaleString("en-US") : "?",
            m: identity.edges != null ? identity.edges.toLocaleString("en-US") : "?",
            ts: identity.last_ingest ?? "?",
          }),
          sampled
            ? fmt(t.srcSampled, {
                n: sampled.nodes.toLocaleString("en-US"),
                total: sampled.fullNodes.toLocaleString("en-US"),
              })
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      : source.phase === "demo"
        ? t.srcDemoTitle
        : t.srcBadgeTitle;

  return (
    <div className={`app theme-${theme}`} data-theme={theme}>
      {/* Nord Cosmos Floating Frozen-Glass Cockpit Header */}
      <header className="topbar">
        <div className="topbar-left">
          <a
            className="kg-back-btn kg-back-link"
            href={returnToHref}
            title={t.backToKnotGateTitle}
            aria-label="Back to KnotGate"
          >
            <ArrowLeftIcon size={15} />
          </a>

          <div className="kg-brand-cluster">
            <KnotGateLogoMark size={24} />
            <span className="kg-wordmark">
              KnotGate <span className="kg-wordmark-accent">Memory</span>
            </span>
            <span className="kg-cosmos-pill">{t.nordCosmosBadge}</span>
          </div>

          <ProjectSelector
            projects={projects}
            activeProjectId={projectId}
            onSelectProject={handleSelectProject}
            loading={projectsLoading || source.phase === "probing"}
            status={
              source.phase === "live"
                ? "live"
                : source.phase === "demo"
                  ? "demo"
                  : source.phase === "probing"
                    ? "probing"
                    : "offline"
            }
            liveNodeCount={
              source.phase === "live" || source.phase === "demo"
                ? (identity?.nodes ?? (graph ? graph.nodes.length : null))
                : null
            }
          />
        </div>

        <nav className="topbar-right" aria-label="KnotGate Memory Controls">
          <div className="kg-segmented" role="tablist" aria-label="Memory View Mode">
            <button
              type="button"
              role="tab"
              aria-selected={!presenting}
              className={!presenting ? "seg-btn on" : "seg-btn"}
              onClick={() => setPresenting(false)}
            >
              <NodesIcon size={13} />
              <span className="seg-label">{t.modeGraph}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={presenting}
              className={presenting ? "seg-btn on" : "seg-btn"}
              onClick={enterPresentation}
              title={t.howItWorksTitle}
            >
              <RouteIcon size={13} />
              <span className="seg-label">{t.modeWalkthrough}</span>
            </button>
          </div>

          <UiScaleSlider />

          <button
            type="button"
            className="kg-icon-pill langtoggle"
            onClick={() => setLangL10n(lang === "ru" ? "en" : "ru")}
            title={t.langSwitch}
          >
            {lang.toUpperCase()}
          </button>

          <button
            type="button"
            className="kg-icon-btn theme-toggle"
            onClick={() => toggleTheme()}
            title={theme === "dark" ? t.themeSwitchToLight : t.themeSwitchToDark}
            aria-label={theme === "dark" ? t.themeSwitchToLight : t.themeSwitchToDark}
          >
            {theme === "dark" ? <SunIcon size={15} /> : <MoonIcon size={15} />}
          </button>

          <button
            type="button"
            className="kg-icon-btn info-toggle"
            onClick={() => setAbout(true)}
            title={t.infoTitle}
            aria-label={t.infoTitle}
          >
            <InfoIcon size={15} />
          </button>
        </nav>
      </header>

      {presenting ? (
        <PresentationView
          onExit={() => setPresenting(false)}
          data={cosmosData}
          source={source}
          projectId={projectId}
          preferredQuestion={activeQuestion ?? initialUrlQuestion ?? history[0]?.q ?? null}
          onRetryLive={() => loadLive(projectId)}
          onSwitchToDefault={() => handleSelectProject(DEFAULT_PROJECT_ID)}
        />
      ) : (
        <>
          <div className="canvaswrap">
            <CosmosCanvas
              label="cosmos"
              onCosmos={setCosmosFull}
              onSelect={() => {}}
              onHover={() => {}}
              onError={onCanvasError}
              onMode={onMode}
            />
          </div>

          {/* Data-source status chip (bottom-left, zero overlap with header) */}
          <button
            type="button"
            className={`srcbadge ${source.phase}`}
            title={badgeTitle}
            onClick={() => {
              if (source.phase !== "probing") loadLive(projectId);
            }}
          >
            <i className="srcdot" aria-hidden="true" />
            <span className="srclabel">{badgeLabel}</span>
          </button>

          <QueryBar
            asking={asking}
            error={askError}
            note={askNote}
            ready={liveReady}
            elapsedS={elapsedS}
            history={history}
            steps={steps}
            initialQuestion={initialUrlQuestion}
            onAsk={askLive}
            onCancel={cancelAsk}
            onPickHistory={askLive}
            onClearHistory={() => {
              setHistory([]);
              saveHistory([]);
            }}
          />

          <PipelineWidget
            visible={asking || liveTrace !== null || activeQuestion !== null}
            asking={asking}
            question={activeQuestion ?? liveTrace?.meta?.question ?? ""}
            trace={liveTrace}
            steps={steps}
            currentStage={currentStage}
            onSelectStage={(s) => {
              setCurrentStage(s);
              highlightStageInCosmos(s, liveTrace, activeQuestion ?? "");
            }}
            onFocusNode={focusNode}
            onFocusEntityName={(entityName) => {
              if (!names) return;
              const exactIdx = names.indexOf(entityName);
              if (exactIdx >= 0) {
                focusNode(exactIdx);
                return;
              }
              const lower = entityName.toLowerCase();
              const fuzzyIdx = names.findIndex((nm) => nm.toLowerCase() === lower);
              if (fuzzyIdx >= 0) focusNode(fuzzyIdx);
            }}
            onFocusChunk={(h) => {
              if (!names) return;
              const ent = h.entities[0];
              const idx = ent ? names.indexOf(ent) : -1;
              if (idx >= 0) focusNode(idx);
            }}
            onClose={() => {
              setActiveQuestion(null);
              setLiveTrace(null);
              cosmosFull?.spotlight(null);
              cosmosFull?.paint(null);
              cosmosFull?.clearHalos();
            }}
            elapsedS={elapsedS}
          />

          {!isEmptyScope && (
            <CosmosView
              cosmos={cosmosFull}
              graph={graph}
              names={names}
              loading={progress}
              focusNode={focusNode}
              mode={renderMode}
              conn={conn}
            />
          )}

          {/* Calm Nord Frozen Glass Empty Scope State */}
          {isEmptyScope && !dataError && !canvasError && (
            <div className="empty-scope-wrap" role="status" aria-live="polite">
              <div className="empty-scope-card">
                <div className="empty-scope-badge">
                  {activeProject.kind === "dialog" || activeProject.kind === "personal" ? (
                    <DialogScopeIcon size={16} />
                  ) : (
                    <DatabaseIcon size={16} />
                  )}
                  <span>{activeProject.name}</span>
                  {projectId !== DEFAULT_PROJECT_ID && projectId !== activeProject.name && (
                    <code>{projectId}</code>
                  )}
                </div>
                <h2 className="empty-scope-title">{t.emptyScopeTitle}</h2>
                <p className="empty-scope-body">{t.emptyScopeBody}</p>
                <div className="empty-scope-actions">
                  {projectId !== DEFAULT_PROJECT_ID && (
                    <button
                      type="button"
                      className="primary"
                      onClick={() => handleSelectProject(DEFAULT_PROJECT_ID)}
                    >
                      <DatabaseIcon size={14} />
                      <span>{t.switchToPierKb}</span>
                    </button>
                  )}
                  <button type="button" onClick={() => loadLive(projectId)}>
                    {t.retryConnection}
                  </button>
                </div>
              </div>
            </div>
          )}

          {source.phase === "demo" && !demoNoteDismissed && (
            <div className="demonote" role="status">
              <span>{t.demoLoadedNote}</span>
              <button className="ghostbtn" onClick={() => loadLive(projectId)} title={t.backToLive}>
                {t.backToLive}
              </button>
              <button className="ghostbtn" onClick={() => setDemoNoteDismissed(true)} title={t.commonDismiss}>
                <XIcon size={11} />
              </button>
            </div>
          )}
        </>
      )}

      {about && (
        <AboutModal
          onClose={() => setAbout(false)}
          conn={conn}
          onRefreshConn={() => refreshConn(projectId)}
          identity={identity}
          sourcePhase={source.phase}
          projectLabel={activeProject.name}
          projectId={projectId}
        />
      )}

      {source.phase === "unreachable" && !dataError && (
        <ErrorOverlay
          title={t.notConnectedTitle}
          body={t.notConnectedBody}
          detail={sourceError}
          actions={
            <>
              <button className="primary" onClick={openDemo}>
                {t.openDemo}
              </button>
              <button onClick={() => loadLive(projectId)}>{t.retryConnection}</button>
            </>
          }
        />
      )}
      {dataError && <ErrorOverlay title={t.errIndexTitle} body={t.errIndexBody} detail={dataError} />}
      {!dataError && canvasError && (
        <ErrorOverlay title={t.errCanvasTitle} body={t.errCanvasBody} detail={canvasError} />
      )}
      {!dataError && !canvasError && renderMode === "canvas2d" && !modeDismissed && (
        <div className="modebadge" role="status">
          <span>{t.fallbackBadge}</span>
          <button className="ghostbtn" onClick={() => setModeDismissed(true)} title={t.commonDismiss}>
            <XIcon size={11} />
          </button>
        </div>
      )}
    </div>
  );
}
