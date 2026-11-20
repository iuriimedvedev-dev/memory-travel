import { useEffect, useMemo, useRef, useState } from "react";
import { fmt } from "../i18n/strings";
import { useI18n } from "../i18n/useI18n";
import {
  categoryForProject,
  groupProjectsByCategory,
  resolveActiveProject,
  sanitizeProjectId,
  type MemoryProject,
  type ProjectCategory,
  type ProjectKind,
} from "../lib/projects";
import {
  CheckIcon,
  ChevronDownIcon,
  DatabaseIcon,
  DeptScopeIcon,
  DialogScopeIcon,
  SearchIcon,
  XIcon,
} from "./icons";

export type ProjectConnStatus = "live" | "probing" | "demo" | "offline";

export interface ProjectSelectorProps {
  projects: MemoryProject[];
  activeProjectId: string;
  onSelectProject: (projectId: string) => void;
  loading?: boolean;
  status?: ProjectConnStatus;
  liveNodeCount?: number | null;
}

export function formatCompactCount(n: number | null | undefined): string | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

function ScopeIcon({ kind, size = 13 }: { kind: ProjectKind; size?: number }) {
  const cat = categoryForProject({ id: "", kind });
  if (cat === "personal_dialogs") return <DialogScopeIcon size={size} />;
  if (cat === "departments_environments") return <DeptScopeIcon size={size} />;
  return <DatabaseIcon size={size} />;
}

export default function ProjectSelector({
  projects,
  activeProjectId,
  onSelectProject,
  loading = false,
  status = "probing",
  liveNodeCount = null,
}: ProjectSelectorProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeProject = useMemo(
    () => resolveActiveProject(projects, activeProjectId),
    [projects, activeProjectId],
  );

  // Ensure the active project (e.g. deep-linked `?project=chat_123`) appears in the list
  const mergedProjects = useMemo(() => {
    if (projects.some((p) => p.id === activeProject.id)) return projects;
    return [...projects, activeProject];
  }, [projects, activeProject]);

  const groups = useMemo(
    () => groupProjectsByCategory(mergedProjects, query),
    [mergedProjects, query],
  );

  const customCandidate = useMemo(() => {
    const clean = sanitizeProjectId(query);
    if (!clean) return null;
    const exactExists = mergedProjects.some((p) => p.id.toLowerCase() === clean.toLowerCase());
    return exactExists ? null : clean;
  }, [mergedProjects, query]);

  const flatFiltered = useMemo(
    () => [...groups.kb, ...groups.personal_dialogs, ...groups.departments_environments],
    [groups],
  );

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 10);
    const onPointerDown = (ev: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const pickProject = (id: string) => {
    const clean = sanitizeProjectId(id);
    if (!clean) return;
    setOpen(false);
    setQuery("");
    onSelectProject(clean);
  };

  const categoryMeta: { key: ProjectCategory; label: string }[] = [
    { key: "kb", label: t.projCatKb },
    { key: "personal_dialogs", label: t.projCatPersonalDialogs },
    { key: "departments_environments", label: t.projCatDeptsEnvs },
  ];

  const pillNodeCount = useMemo(
    () => formatCompactCount(liveNodeCount ?? activeProject.nodes ?? null),
    [liveNodeCount, activeProject.nodes],
  );

  return (
    <div className="proj-selector" ref={rootRef}>
      <button
        type="button"
        className={`proj-pill${open ? " open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${t.projPickerLabel}: ${activeProject.name}`}
        title={`${activeProject.name} (${activeProject.id})`}
      >
        <span className={`proj-live-dot ${status}`} aria-hidden="true" />
        <span className="proj-pill-icon">
          <ScopeIcon kind={activeProject.kind} size={13} />
        </span>
        <span className="proj-pill-name">{activeProject.name}</span>
        {pillNodeCount && <span className="proj-node-chip">{pillNodeCount}</span>}
        {activeProject.id !== "default" && activeProject.id !== activeProject.name && (
          <span className="proj-pill-id">{activeProject.id}</span>
        )}
        <ChevronDownIcon size={12} className={`icon proj-pill-chev${open ? " open" : ""}`} />
      </button>

      {open && (
        <div className="proj-popover" role="dialog" aria-label={t.projPickerLabel}>
          <div className="proj-search-row">
            <SearchIcon size={13} />
            <input
              ref={inputRef}
              type="text"
              className="proj-search-input"
              value={query}
              placeholder={t.projSearchPlaceholder}
              aria-label={t.projSearchPlaceholder}
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const clean = sanitizeProjectId(query);
                  const exact = mergedProjects.find(
                    (p) =>
                      p.id.toLowerCase() === clean.toLowerCase() ||
                      p.name.toLowerCase() === query.trim().toLowerCase(),
                  );
                  if (exact) {
                    pickProject(exact.id);
                  } else if (flatFiltered.length === 1 && !customCandidate) {
                    pickProject(flatFiltered[0].id);
                  } else if (clean) {
                    pickProject(clean);
                  }
                }
              }}
            />
            {query && (
              <button
                type="button"
                className="ghostbtn"
                onClick={() => setQuery("")}
                title={t.searchClear}
              >
                <XIcon size={11} />
              </button>
            )}
          </div>

          <div className="proj-groups" role="listbox" aria-label={t.projPickerLabel}>
            {categoryMeta.map(({ key, label }) => {
              const items = groups[key];
              if (!items.length) return null;
              return (
                <div className="proj-group" key={key}>
                  <div className="proj-group-label">{label}</div>
                  {items.map((p) => {
                    const selected = p.id === activeProject.id;
                    const isEmpty = p.has_data === false || p.nodes === 0;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={`proj-option${selected ? " selected" : ""}`}
                        onClick={() => pickProject(p.id)}
                      >
                        <span className="proj-opt-icon">
                          <ScopeIcon kind={p.kind} size={13} />
                        </span>
                        <span className="proj-opt-main">
                          <span className="proj-opt-top">
                            <span className="proj-opt-name">{p.name}</span>
                            {p.id !== "default" && p.id !== p.name && (
                              <code className="proj-opt-code">{p.id}</code>
                            )}
                          </span>
                          {p.description && (
                            <span className="proj-opt-desc">{p.description}</span>
                          )}
                        </span>
                        <span className="proj-opt-meta">
                          {isEmpty ? (
                            <span className="proj-badge empty">{t.projEmptyBadge}</span>
                          ) : typeof p.nodes === "number" ? (
                            <span className="proj-badge">
                              {fmt(t.projNodesCount, { n: p.nodes.toLocaleString("en-US") })}
                            </span>
                          ) : typeof p.docs === "number" ? (
                            <span className="proj-badge">
                              {fmt(t.projDocsCount, { n: p.docs.toLocaleString("en-US") })}
                            </span>
                          ) : null}
                          {selected && <CheckIcon size={12} className="icon proj-check" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}

            {flatFiltered.length === 0 && !customCandidate && (
              <div className="proj-empty-hint">{t.projNoMatch}</div>
            )}

            {customCandidate && (
              <div className="proj-custom-wrap">
                <button
                  type="button"
                  className="proj-custom-btn"
                  onClick={() => pickProject(customCandidate)}
                >
                  <DialogScopeIcon size={13} />
                  <span>{fmt(t.projJumpCustom, { id: customCandidate })}</span>
                </button>
              </div>
            )}
          </div>
          {loading && <div className="proj-loading-foot">{t.srcProbing}</div>}
        </div>
      )}
    </div>
  );
}
