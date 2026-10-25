import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Box, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Code2,
  Copy, Cpu, Download, Eye, EyeOff, Focus, FolderOpen, Grid2X2, History, Layers3, LoaderCircle, Maximize2, Minus, MousePointer2,
  Move3D, PanelLeftClose, PanelRightClose, Plus, Redo2, Rotate3D, Ruler, ScanLine, Send, Settings2, ShieldCheck,
  Sparkles, Trash2, TriangleAlert, Undo2, X } from "lucide-react";
import { SAMPLE, specSchema, type PartSpec } from "@/lib/contracts";
import { addPrimitive, commitEdit, editableSpec, placements, redoEdit, undoEdit, type EditHistory, type Part, type Placement } from "@/lib/editor";
import type { EngineeringResults, ModelCatalog } from "@/lib/engineering";
import type { MeshData, ViewportHandle, ViewTool } from "./Viewport";
import PartInspector, { NumberField } from "./PartInspector";
import ProviderSettings from "./ProviderSettings";
import EngineeringPanel from "./EngineeringPanel";
const Viewport = lazy(() => import("./Viewport"));

type Report = { passed: boolean; checks: { name: string; passed: boolean; detail: string }[]; warnings: string[]; bounds_mm: number[]; volume_mm3: number; solids: number };
type Revision = { id: string; created_at: number; spec: string; report: string; provenance: string };
type Project = { id: string; title: string; current_revision: string | null; updated_at?: number };
type Job = { id: string; status: string; stage: string; error: string | null; provider: string; prompt: string };
type NodeInfo = { name: string; seen_at: number };
type ProjectData = { project: Project; revisions: Revision[]; jobs: Job[] };
const providerNames: Record<string, string> = { codex: "Codex CLI", claude: "Claude Code", local: "Локальная модель", api: "Свой API", manual: "CAD-движок" };
const defaultColors = ["#b3bcc2", "#60727e", "#bca881", "#e2dfd3", "#637768"];
const initialSpec = editableSpec(SAMPLE);
async function api<T>(route: string, body?: unknown, method?: string): Promise<T> {
  const r = await fetch("/api/" + route, { method: method || (body ? "POST" : "GET"), ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const value = await r.json(); if (!r.ok) throw new Error(value.error || "Локальный сервер недоступен"); return value;
}
function IconButton({ label, children, onClick, active, disabled, className = "" }: { label: string; children: ReactNode; onClick: () => void; active?: boolean; disabled?: boolean; className?: string }) {
  return <button title={label} aria-label={label} aria-pressed={active} className={`icon-button ${active ? "active" : ""} ${className}`} disabled={disabled} onClick={onClick}>{children}</button>;
}
function Modal({ title, onClose, children, className = "" }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  const el = useRef<HTMLElement>(null), close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    el.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close.current(); }
      if (e.key === "Tab") {
        const nodes = Array.from(el.current?.querySelectorAll<HTMLElement>("button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]") || []).filter(n => n.offsetParent !== null);
        if (!nodes.length) return;
        if (e.shiftKey && (document.activeElement === nodes[0] || document.activeElement === el.current)) { e.preventDefault(); nodes.at(-1)?.focus(); }
        else if (!e.shiftKey && document.activeElement === nodes.at(-1)) { e.preventDefault(); nodes[0].focus(); }
      }
    };
    el.current?.addEventListener("keydown", key);
    const current = el.current; return () => { current?.removeEventListener("keydown", key); before?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section ref={el} tabIndex={-1} className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={title}>
    <div className="modal-title"><div><span className="eyebrow">neofab / studio</span><h2>{title}</h2></div><IconButton label="Закрыть" onClick={onClose}><X size={18} /></IconButton></div>{children}</section></div>;
}

export default function Studio() {
  const [history, setHistory] = useState<EditHistory>({ past: [], present: initialSpec, future: [] });
  const spec = history.present;
  const [builtSpec, setBuiltSpec] = useState<PartSpec | null>(initialSpec);
  const [mesh, setMesh] = useState<MeshData | null>(null), [report, setReport] = useState<Report | null>(null);
  const [projects, setProjects] = useState<Project[]>([]), [project, setProject] = useState<Project | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]), [revision, setRevision] = useState<string | null>(null), [jobs, setJobs] = useState<Job[]>([]);
  const [engineering, setEngineering] = useState<EngineeringResults | null>(null), [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null), [provider, setProvider] = useState("local"), [model, setModel] = useState("");
  const [selected, setSelected] = useState("fork"), [hidden, setHidden] = useState<string[]>([]), [isolated, setIsolated] = useState<string | null>(null);
  const [colors, setColors] = useState<Record<string, string>>({}), [tool, setTool] = useState<ViewTool>("select");
  const [wire, setWire] = useState(false), [ghost, setGhost] = useState(false), [grid, setGrid] = useState(true), [exploded, setExploded] = useState(false);
  const [view, setView] = useState("iso"), [snap, setSnap] = useState(false), [clipAxis, setClipAxis] = useState<"x" | "y" | "z" | null>(null), [clipPosition, setClipPosition] = useState(50);
  const [mobileInspector, setMobileInspector] = useState(false);
  const [focusMode, setFocusMode] = useState(false), [leftOpen, setLeftOpen] = useState(true), [rightOpen, setRightOpen] = useState(true);
  const [drawer, setDrawer] = useState<"engineering" | "checks" | "history" | "export" | null>(null);
  const [settings, setSettings] = useState(false), [projectsOpen, setProjectsOpen] = useState(false), [addOpen, setAddOpen] = useState(false);
  const [newDialog, setNewDialog] = useState(false), [newTitle, setNewTitle] = useState("");
  const [jsonOpen, setJsonOpen] = useState(false), [jsonDraft, setJsonDraft] = useState(""), [jsonError, setJsonError] = useState("");
  const [help, setHelp] = useState(false), [prompt, setPrompt] = useState(""), [assistantExpanded, setAssistantExpanded] = useState(false);
  const [error, setError] = useState(""), [toast, setToast] = useState(""), [busy, setBusy] = useState(false), [token, setToken] = useState("");
  const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);
  const [appearanceKey, setAppearanceKey] = useState("");
  const viewport = useRef<ViewportHandle | null>(null), file = useRef<HTMLInputElement>(null);
  const loadToken = useRef(0), projectRef = useRef<Project | null>(null), revisionRef = useRef<string | null>(null);
  const pending = useRef<{ id: string; manual: boolean } | null>(null);
  const pinnedRevision = useRef(false);
  const specRef = useRef(spec), dirtyRef = useRef(false), toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = !builtSpec ? !!spec.components.length : JSON.stringify(spec) !== JSON.stringify(builtSpec);
  specRef.current = spec; dirtyRef.current = dirty; projectRef.current = project; revisionRef.current = revision;
  const active = jobs.find(j => ["queued", "running"].includes(j.status));
  const locked = busy || !!active;
  const node = nodes.find(n => Date.now() - n.seen_at < 45000);
  const part = spec.components.find(p => p.id === selected) || spec.components[0], selection = part?.id || "";
  const currentPlacements = useMemo(() => placements(spec), [spec]);
  const basePlacements = useMemo(() => builtSpec ? placements(builtSpec) : {}, [builtSpec]);
  const availableModels = catalog?.models[provider] || [], selectedModel = availableModels.find(m => m.id === model);
  const firstModel = availableModels[0]?.id || "";
  const source = revisions.find(r => r.id === revision);
  const provenance = source ? JSON.parse(source.provenance) : null;
  const note = useCallback((message: string) => {
    setToast(message); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(""), 3800);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  const commit = useCallback((value: PartSpec) => { setHistory(h => commitEdit(h, value)); }, []);
  const edit = useCallback((mutate: (s: PartSpec) => void) => { const next = structuredClone(specRef.current); mutate(next); commit(next); }, [commit]);
  const guard = (action: () => void) => { if (dirty) setConfirmAction(() => action); else action(); };
  const showJson = () => { setJsonDraft(JSON.stringify(spec, null, 2)); setJsonError(""); setJsonOpen(true); };
  const setPreset = (name: string) => setView(name + ":" + Date.now());

  const loadRevision = useCallback(async (rev: Revision, pin = false) => {
    pinnedRevision.current = pin;
    const request = ++loadToken.current;
    const [geometry, results] = await Promise.all([
      api<MeshData>("artifacts/" + rev.id + "/mesh.json"), api<EngineeringResults>("artifacts/" + rev.id + "/engineering.json").catch(() => null),
    ]);
    if (request !== loadToken.current) return;
    const next = editableSpec(specSchema.parse(JSON.parse(rev.spec)));
    const preserve = pending.current?.id === rev.id && pending.current.manual;
    setHistory(h => preserve ? { ...h, present: next } : { past: [], present: next, future: [] });
    setBuiltSpec(next); setMesh(geometry); setReport(JSON.parse(rev.report)); setEngineering(results); setRevision(rev.id); revisionRef.current = rev.id;
    setSelected(id => next.components.some(c => c.id === id) ? id : next.components[0]?.id || "");
    setHidden(ids => ids.filter(id => next.components.some(c => c.id === id))); setIsolated(null); setError(""); pending.current = null;
  }, []);
  const refreshProject = useCallback(async (id: string) => {
    const data = await api<ProjectData>("projects/" + id);
    if (projectRef.current?.id !== id) return;
    setProject(data.project); setRevisions(data.revisions); setJobs(data.jobs);
    if (pending.current && data.jobs.some(j => j.id === pending.current?.id && j.status === "failed")) pending.current = null;
    if (data.project.current_revision && data.project.current_revision !== revisionRef.current &&
      (pending.current?.id === data.project.current_revision || (!pinnedRevision.current && !dirtyRef.current && !pending.current))) {
      const rev = data.revisions.find(r => r.id === data.project.current_revision); if (rev) await loadRevision(rev);
    }
  }, [loadRevision]);
  const refresh = useCallback(async () => {
    const [state, models] = await Promise.all([api<{ projects: Project[]; nodes: NodeInfo[] }>("state"), api<ModelCatalog>("models").catch(() => null)]);
    setProjects(state.projects); setNodes(state.nodes); setCatalog(models);
    if (projectRef.current) await refreshProject(projectRef.current.id);
  }, [refreshProject]);
  const chooseProject = useCallback(async (p: Project) => {
    loadToken.current++; pinnedRevision.current = false; projectRef.current = p; revisionRef.current = null; pending.current = null;
    setProject(p); setRevision(null); setRevisions([]); setJobs([]); setEngineering(null); setMesh(null); setReport(null); setBuiltSpec(null);
    setHidden([]); setIsolated(null); setDrawer(null); setProjectsOpen(false); setError("");
    const empty: PartSpec = { ...structuredClone(initialSpec), name: p.title, components: [], joints: [], operations: [], assumptions: [], missing_geometry: [], engineering: null, requirements: { expected_solids: 1, bounds: null, tolerance: 0.01 } };
    setHistory({ past: [], present: empty, future: [] }); dirtyRef.current = false;
    window.history.replaceState(null, "", "?project=" + encodeURIComponent(p.id)); await refreshProject(p.id);
  }, [refreshProject]);
  const loadSample = useCallback(async () => {
    const request = ++loadToken.current;
    const [geometry, checks] = await Promise.all([fetch("/example-mesh.json").then(r => r.json()), fetch("/example-report.json").then(r => r.json())]);
    if (loadToken.current !== request) return;
    const next = structuredClone(initialSpec);
    pinnedRevision.current = false; projectRef.current = null; revisionRef.current = null; pending.current = null;
    setProject(null); setRevision(null); setRevisions([]); setJobs([]); setEngineering(null); setHistory({ past: [], present: next, future: [] });
    setBuiltSpec(next); setMesh(geometry); setReport(checks); setSelected("fork"); setHidden([]); setIsolated(null); setDrawer(null); setProjectsOpen(false);
    window.history.replaceState(null, "", window.location.pathname); setError("");
  }, []);
  useEffect(() => {
    let live = true;
    const requested = new URLSearchParams(window.location.search).get("project");
    void (requested ? api<ProjectData>("projects/" + encodeURIComponent(requested)).then(d => { if (live) return chooseProject(d.project); }) : loadSample()).catch(e => { if (live) setError(e.message); });
    void refresh().catch(e => { if (live) setError(e.message); });
    const timer = setInterval(() => { void refresh().catch(e => { if (live) setError(e.message); }); }, 4000);
    return () => { live = false; clearInterval(timer); loadToken.current++; };
  }, [chooseProject, loadSample, refresh]);
  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem("forma-model-v3") || "null"); if (saved && ["local", "api", "codex", "claude"].includes(saved.provider)) { setProvider(saved.provider); setModel(saved.model || ""); } } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem("forma-model-v3", JSON.stringify({ provider, model })); } catch {} }, [provider, model]);
  useEffect(() => { if (!model && firstModel) setModel(firstModel); }, [model, firstModel]);
  useEffect(() => {
    const key = "neofab-view:" + (project?.id || "sample");
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "{}");
      setColors(Object.fromEntries(Object.entries(saved.colors || {}).filter(([, value]) => typeof value === "string" && /^#[a-fA-F0-9]{6}$/.test(value)) as [string, string][]));
      setHidden(Array.isArray(saved.hidden) ? saved.hidden.filter((id: unknown) => typeof id === "string") : []);
    } catch { setColors({}); setHidden([]); }
    setAppearanceKey(key);
  }, [project?.id]);
  useEffect(() => {
    const key = "neofab-view:" + (project?.id || "sample");
    if (appearanceKey !== key) return;
    try { localStorage.setItem(key, JSON.stringify({ colors, hidden })); } catch {}
  }, [colors, hidden, appearanceKey, project?.id]);


  async function createProject(title: string) {
    const p = await api<Project>("projects", { title }); projectRef.current = p; setProject(p); setProjects(prev => [p, ...prev]);
    window.history.replaceState(null, "", "?project=" + p.id); return p;
  }
  async function createEmpty() {
    if (!newTitle.trim()) return;
    try { setBusy(true); const p = await createProject(newTitle.trim()); await chooseProject(p); setNewDialog(false); setNewTitle(""); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function submit(manual = false, override?: PartSpec) {
    if (locked) return;
    setError(""); setBusy(true);
    try {
      const current = override || specRef.current;
      if (manual) specSchema.parse(current);
      let p = projectRef.current;
      if (!p) p = await createProject(manual ? current.name : prompt.trim().slice(0, 65));
      const result = await api<{ id: string }>("projects/" + p.id + "/jobs", { provider: manual ? "manual" : provider, model: manual ? "" : model,
        prompt: manual ? "Ручное редактирование neofab" : prompt, ...(current.components.length ? { spec: current } : {}) });
      pending.current = { id: result.id, manual };
      if (!manual) setPrompt(""); await refreshProject(p.id); note(manual ? "CAD-движок строит новую версию" : "Задача передана выбранной модели");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function updatePart(value: Part) { edit(s => { s.components = s.components.map(c => c.id === value.id ? value : c); }); }
  function duplicatePart() {
    if (!part || locked || spec.components.length >= 24) return;
    const duplicate = structuredClone(part); duplicate.id = "part_" + crypto.randomUUID().slice(0, 8); duplicate.name += " · копия";
    duplicate.at[0] += Math.max(report?.bounds_mm[0] || 40, 20) + 10;
    edit(s => { s.components.push(duplicate); s.requirements.expected_solids = s.components.length; });
    setSelected(duplicate.id); note("Копия добавлена. Построй CAD, чтобы увидеть новую деталь.");
  }
  function deletePart() {
    if (!part || locked) return;
    if (spec.joints.some(j => j.components.includes(part.id)) || spec.engineering?.strength?.component_id === part.id || spec.engineering?.manufacturing.dimensions.some(d => d.component_id === part.id)) {
      setError("У детали есть связи или заданные расчёты. Сначала удали их в разделе «Инженерия»."); return;
    }
    edit(s => { s.components = s.components.filter(c => c.id !== part.id); s.requirements.expected_solids = Math.max(s.components.length, 1); });
    setSelected(spec.components.find(c => c.id !== part.id)?.id || ""); note("Деталь удалена из проекта. Ctrl/⌘ Z — отменить.");
  }
  function addPart(type: "box" | "cylinder") {
    if (locked || spec.components.length >= 24) return;
    const next = addPrimitive(spec, type); commit(next); setSelected(next.components.at(-1)!.id); setAddOpen(false); setRightOpen(true);
    note("Деталь добавлена в спецификацию. Нажми «Построить CAD».");
  }
  async function loadEngineeringExample(kind: string) {
    try {
      const r = await fetch("/benchmarks/" + kind + ".json"); if (!r.ok) throw new Error("Пример недоступен");
      const next = editableSpec(specSchema.parse(await r.json())); const p = await createProject(next.name); await chooseProject(p);
      setHistory({ past: [], present: next, future: [] }); setSelected(next.components[0]?.id || ""); setDrawer("engineering");
      note("Контрольный пример загружен. Запусти расчёт.");
    } catch (e) { setError((e as Error).message); }
  }
  const actions = useRef({ submit, duplicatePart, deletePart, locked }); actions.current = { submit, duplicatePart, deletePart, locked };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))) {
        return;
      }
      if (document.querySelector('[aria-modal="true"]')) return;
      if ((e.ctrlKey || e.metaKey) && (e.code === "KeyZ" || e.key.toLowerCase() === "z") && !actions.current.locked) { e.preventDefault(); setHistory(h => e.shiftKey ? redoEdit(h) : undoEdit(h)); return; }
      if ((e.ctrlKey || e.metaKey) && (e.code === "KeyD" || e.key.toLowerCase() === "d")) { e.preventDefault(); actions.current.duplicatePart(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.code === "KeyF" || e.key.toLowerCase() === "f")) { e.preventDefault(); viewport.current?.fit(true); }
      if ((e.code === "KeyV" || e.key.toLowerCase() === "v")) setTool("select");
      if ((e.code === "KeyG" || e.key.toLowerCase() === "g") && !actions.current.locked) { setTool("translate"); setExploded(false); }
      if ((e.code === "KeyR" || e.key.toLowerCase() === "r") && !actions.current.locked) { setTool("rotate"); setExploded(false); }
      if ((e.code === "KeyM" || e.key.toLowerCase() === "m")) setTool("measure");
      if ((e.code === "KeyX" || e.key.toLowerCase() === "x")) setGhost(v => !v);
      if (e.key === "Escape") { setTool("select"); setIsolated(null); setAddOpen(false); setProjectsOpen(false); }
    }; window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!projectsOpen && !addOpen) return;
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest(".project-switcher")) setProjectsOpen(false);
      if (!event.target.closest(".tree-actions")) setAddOpen(false);
    };
    window.addEventListener("pointerdown", outside); return () => window.removeEventListener("pointerdown", outside);
  }, [projectsOpen, addOpen]);
  const download = (name: string) => revision ? `/api/artifacts/${revision}/${name}?download=1` : "/examples/" + name;
  const canExport = !!mesh && !dirty && !locked;
  const toolbar: { tool: ViewTool; label: string; key: string; icon: ReactNode }[] = [
    { tool: "select", label: "Выбор детали", key: "V", icon: <MousePointer2 size={18} /> }, { tool: "translate", label: "Переместить", key: "G", icon: <Move3D size={19} /> },
    { tool: "rotate", label: "Повернуть", key: "R", icon: <Rotate3D size={19} /> }, { tool: "measure", label: "Измерить по сетке", key: "M", icon: <Ruler size={19} /> },
  ];
  const lastFailed = jobs[0]?.status === "failed" ? jobs[0].error : null;

  return <main className={`neofab ${focusMode ? "focus-mode" : ""} ${!leftOpen ? "hide-tree" : ""} ${!rightOpen ? "hide-inspector" : ""} ${mobileInspector ? "inspector-visible" : ""}`}>
    <header className="studio-header">
      <button className="wordmark" onClick={() => guard(() => { void loadSample(); })} aria-label="neofab — учебная сборка"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 24V8l8-4 16 8v16l-8 4V16L4 8m8-4v16l8 4m0-8 8-4" /></svg><span>neofab<span className="wordmark-dot">.</span></span><small>STUDIO</small></button>
      <div className="project-switcher"><span className="header-slash">/</span><button aria-label="Выбрать проект" onClick={() => setProjectsOpen(v => !v)}>{spec.name || "Новый проект"}<ChevronDown size={14} /></button><span className={"save-state " + (dirty ? "draft" : "")}><i />{locked ? "Построение" : dirty ? "Изменения" : revision ? (project?.current_revision !== revision ? "Архивная версия" : "Сохранено локально") : "Учебная сборка"}</span>
        {projectsOpen && <div className="project-menu surface"><div className="menu-heading">Твоя мастерская<small>{projects.length} проектов</small></div><button onClick={() => guard(() => { void loadSample(); })}><Box size={16} /><span>Роликовая опора<small>Ручной учебный образец</small></span></button>{projects.map(p => <button key={p.id} onClick={() => guard(() => { void chooseProject(p); })}><FolderOpen size={16} /><span>{p.title}</span>{p.id === project?.id && <Check size={14} />}</button>)}<button onClick={() => guard(() => { setProjectsOpen(false); setNewDialog(true); })}><Plus size={16} />Новый проект</button></div>}
      </div>
      <div className="header-actions"><span className="local-indicator"><i className={node ? "online" : ""} />{node ? "Local engine" : "Engine offline"}</span><IconButton label="Подключения моделей" onClick={() => setSettings(true)}><Settings2 size={18} /></IconButton><IconButton label="История версий" onClick={() => setDrawer("history")} active={drawer === "history"}><History size={18} /></IconButton><button className="button dark export-button" disabled={!canExport} onClick={() => setDrawer("export")}><ArrowUpRight size={16} /><span>Экспорт</span></button></div>
    </header>
    <div className="workbench">
      <div className="model-stage">
        {mesh && spec.components.length ? <Suspense fallback={<div className="canvas-empty"><LoaderCircle className="spin" />Загрузка 3D-сцены</div>}><Viewport data={mesh} selected={selection} onSelect={setSelected} exploded={exploded} wireframe={wire} view={view} tool={locked ? "select" : tool}
          apiRef={viewport} baseParts={builtSpec?.components} parts={spec.components} basePlacements={basePlacements} placements={currentPlacements} onTransform={(id, placement: Placement) => edit(s => { const p = s.components.find(c => c.id === id); if (p) Object.assign(p, placement); })}
          hidden={hidden} isolated={isolated} ghost={ghost} grid={grid} colors={colors} clipAxis={clipAxis} clipPosition={clipPosition} snap={snap} /></Suspense>
          : <div className="canvas-empty"><div className="empty-emblem"><Box size={48} strokeWidth={1} /></div><h1>Место для следующей идеи.</h1><p>Добавь деталь вручную или опиши конструкцию помощнику.</p><button className="button dark" onClick={() => addPart("box")}><Plus size={16} />Добавить первую деталь</button></div>}
      </div>
      <nav className="workspace-nav surface" aria-label="Разделы студии"><button className={!drawer ? "active" : ""} onClick={() => setDrawer(null)}><Box size={16} />Проектирование</button><button className={drawer === "engineering" ? "active" : ""} onClick={() => setDrawer(drawer === "engineering" ? null : "engineering")}><Cpu size={16} />Инженерия</button><button className={drawer === "checks" ? "active" : ""} onClick={() => setDrawer(drawer === "checks" ? null : "checks")}><ShieldCheck size={16} />Проверки{report && <span>{report.checks.filter(c => c.passed).length}/{report.checks.length}</span>}</button></nav>
      <div className="stage-toolbar surface" role="toolbar" aria-label="Инструменты модели">{toolbar.map(t => <button key={t.tool} aria-label={t.label} aria-pressed={tool === t.tool} title={`${t.label} · ${t.key}`} className={tool === t.tool ? "active" : ""} disabled={(t.tool === "translate" || t.tool === "rotate") && (locked || !mesh || !part)} onClick={() => { setTool(t.tool); if (t.tool === "translate" || t.tool === "rotate") setExploded(false); }}>{t.icon}<kbd>{t.key}</kbd></button>)}<i /><IconButton label="Отменить · ⌘ Z" onClick={() => setHistory(undoEdit)} disabled={!history.past.length || locked}><Undo2 size={18} /></IconButton><IconButton label="Повторить · ⇧ ⌘ Z" onClick={() => setHistory(redoEdit)} disabled={!history.future.length || locked}><Redo2 size={18} /></IconButton></div>

      <aside className="structure-panel surface">
        <div className="panel-heading"><span>Сборка<small>{spec.components.length.toString().padStart(2, "0")} детали</small></span><IconButton label="Скрыть дерево" onClick={() => setLeftOpen(false)}><PanelLeftClose size={15} /></IconButton></div>
        <div className="model-tree"><div className="tree-root"><ChevronDown size={12} /><Layers3 size={16} /><span>{spec.name}</span><small>mm</small></div>
          {spec.components.map((p, i) => <div className={`tree-part ${selection === p.id ? "selected" : ""} ${hidden.includes(p.id) ? "muted" : ""}`} key={p.id}>
            <button onClick={() => { setSelected(p.id); setRightOpen(true); setMobileInspector(true); }} onDoubleClick={() => { setSelected(p.id); viewport.current?.fit(true); }}><span className="tree-swatch" style={{ background: colors[p.id] || defaultColors[i % defaultColors.length] }} /><span>{p.name.replace(/^\d+\s*·\s*/, "")}<small>{p.material} · {p.operations.length} оп.</small></span></button>
            <IconButton label={hidden.includes(p.id) ? `Показать ${p.name}` : `Скрыть ${p.name}`} onClick={() => setHidden(ids => ids.includes(p.id) ? ids.filter(id => id !== p.id) : [...ids, p.id])}>{hidden.includes(p.id) ? <EyeOff size={14} /> : <Eye size={14} />}</IconButton>
          </div>)}
        </div>
        <div className="project-origin"><span>{!project ? "Учебный образец · создан вручную" : provenance?.provider === "manual" ? "Ручное построение · локальный CAD" : provenance ? `Создано ${providerNames[provenance.provider] || provenance.provider}` : "Новый локальный проект"}</span>{provenance?.provider !== "manual" && provenance?.model && <small>{provenance.model}</small>}</div>
        <div className="tree-actions"><button className="add-part" disabled={locked || spec.components.length >= 24} onClick={() => setAddOpen(v => !v)}><Plus size={16} />Добавить деталь<ChevronDown size={12} /></button>{addOpen && <div className="primitive-menu"><button onClick={() => addPart("box")}><Box size={17} />Пластина / блок<small>40 × 30 × 12</small></button><button onClick={() => addPart("cylinder")}><Layers3 size={17} />Цилиндр<small>Ø30 × 25</small></button><button onClick={() => { file.current?.click(); setAddOpen(false); }}><Code2 size={17} />Импорт JSON</button></div>}</div>
        <div className="tree-tools"><IconButton label="Изолировать выбранную деталь" active={!!isolated} onClick={() => setIsolated(isolated ? null : selection)} disabled={!selection}><Focus size={16} /></IconButton><IconButton label="Разнести сборку" active={exploded} onClick={() => { setExploded(v => !v); setTool("select"); }} disabled={spec.components.length < 2}><Layers3 size={16} /></IconButton><IconButton label="Импортировать спецификацию" onClick={() => file.current?.click()}><Code2 size={16} /></IconButton><span>Локальный проект<ShieldCheck size={12} /></span></div>
      </aside>
      {(!leftOpen || focusMode) && <button className="restore-tree surface" title="Показать сборку" onClick={() => { setLeftOpen(true); setFocusMode(false); }}><Layers3 size={18} /></button>}

      <aside className="inspector-panel surface">
        <div className="inspector-topline"><span><i />Редактор детали</span><IconButton label="Скрыть свойства" onClick={() => { setRightOpen(false); setMobileInspector(false); }}><PanelRightClose size={15} /></IconButton></div>
        <div className="inspector-scroll"><PartInspector part={part} onChange={updatePart} onDuplicate={duplicatePart} onDelete={deletePart} locked={locked} onJson={showJson}
          color={colors[selection] || defaultColors[Math.max(0, spec.components.findIndex(p => p.id === selection)) % defaultColors.length]} onColor={color => setColors(c => ({ ...c, [selection]: color }))} /></div>
        <div className="inspector-build"><div><i className={dirty ? "draft" : ""} /><span>{locked ? active?.stage || "Подготовка" : dirty ? "Есть непостроенные изменения" : "Геометрия актуальна"}</span></div><button className="button dark full" disabled={locked || !node || !spec.components.length} onClick={() => void submit(true)}>{locked ? <LoaderCircle size={15} className="spin" /> : <Rotate3D size={15} />}Построить CAD<kbd>↵</kbd></button></div>
      </aside>
      <button className={`restore-inspector surface ${rightOpen && !focusMode ? "desktop-hidden" : ""}`} title="Показать свойства детали" onClick={() => { setRightOpen(true); setFocusMode(false); setMobileInspector(true); }}><Settings2 size={18} /></button>

      <div className="scene-options surface"><IconButton label="Рёбра и сетка треугольников" active={wire} onClick={() => setWire(v => !v)}><Box size={17} /></IconButton><IconButton label="Прозрачный вид · X" active={ghost} onClick={() => setGhost(v => !v)}><ScanLine size={17} /></IconButton><IconButton label="Рабочая сетка" active={grid} onClick={() => setGrid(v => !v)}><Grid2X2 size={17} /></IconButton><IconButton label="Визуальное сечение" active={!!clipAxis} onClick={() => setClipAxis(v => v ? null : "z")}><Layers3 size={17} /></IconButton><IconButton label="Привязка · 1 мм / 5°" active={snap} onClick={() => setSnap(v => !v)}><Focus size={17} /></IconButton></div>
      {clipAxis && <div className="section-control surface"><span>Сечение по сетке</span><div>{(["x", "y", "z"] as const).map(a => <button key={a} className={clipAxis === a ? "selected" : ""} onClick={() => setClipAxis(a)}>{a.toUpperCase()}</button>)}</div><input aria-label="Положение сечения" type="range" min={0} max={100} value={clipPosition} onChange={e => setClipPosition(Number(e.target.value))} /><IconButton label="Закрыть сечение" onClick={() => setClipAxis(null)}><X size={13} /></IconButton></div>}
      <div className="navigation-dock"><div className="view-cube"><button title="Вид сверху" onClick={() => setPreset("top")}>TOP</button><div><button title="Вид спереди" onClick={() => setPreset("front")}>FRONT</button><button title="Вид справа" onClick={() => setPreset("right")}>R</button></div><button className="cube-iso" onClick={() => setPreset("iso")}>ISO</button></div><div className="zoom-controls surface"><IconButton label="Приблизить" onClick={() => viewport.current?.zoom(1)}><Plus size={17} /></IconButton><IconButton label="Отдалить" onClick={() => viewport.current?.zoom(-1)}><Minus size={17} /></IconButton><IconButton label="Вписать всю модель" onClick={() => viewport.current?.fit()}><Focus size={17} /></IconButton><IconButton label="Сосредоточиться на модели" active={focusMode} onClick={() => setFocusMode(v => !v)}><Maximize2 size={17} /></IconButton></div></div>

      <div className={`assistant-dock surface ${assistantExpanded ? "expanded" : ""}`}>
        <button className="assistant-caption" onClick={() => setAssistantExpanded(v => !v)}><span className="sparkle-badge"><Sparkles size={14} /></span><span>От идеи — к точной детали.<small>Опиши конструкцию или измени текущую</small></span><ChevronDown size={14} /></button>
        <textarea aria-label="Инженерная задача" value={prompt} placeholder="Например: добавь в корпус крепления под M4…" onFocus={() => setAssistantExpanded(true)} onChange={e => setPrompt(e.target.value)} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); if (prompt.trim() && model && node) void submit(); } }} />
        <div className="assistant-bottom"><button className="model-chip" onClick={() => setSettings(true)}><span className="model-orb" />{selectedModel?.label || "Подключить модель"}<ChevronDown size={12} /></button><span className="prompt-context">{active ? active.stage : `${spec.components.length} детали в контексте`}</span><button className="send-button" aria-label="Спроектировать" title="Спроектировать · ⌘ Enter" disabled={locked || !node || !model || !prompt.trim()} onClick={() => void submit()}>{locked ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={18} />}</button></div>
      </div>
      {dirty && !locked && <div className="draft-indicator"><span />Предпросмотр изменений · CAD-файлы ещё не обновлены</div>}
      {active && <div className="job-indicator"><LoaderCircle size={15} className="spin" /><span>{active.stage}</span><small>{providerNames[active.provider]}</small></div>}
      <div className="scene-status"><span className="axis-label"><b>X</b><b>Y</b><b>Z</b></span><span>{dirty ? "Предпросмотр · CAD не обновлён" : report ? `${report.bounds_mm.map(v => Number(v.toFixed(1))).join(" × ")} mm` : "Миллиметры"}</span><i /><span>{mesh ? `${mesh.triangles.length.toLocaleString("ru-RU")} треугольников` : "Геометрия ещё не построена"}</span><button onClick={() => setHelp(true)}><CircleHelp size={13} />Управление</button></div>
    </div>

    {drawer && <div className={`workspace-drawer surface ${drawer === "engineering" ? "analysis-drawer" : ""}`}><div className="drawer-heading"><div><span className="eyebrow">neofab / {drawer === "engineering" ? "engineering" : "project"}</span><h2>{drawer === "engineering" ? "Инженерная проверка" : drawer === "history" ? "Версии проекта" : drawer === "export" ? "Подготовить к изготовлению" : "Контроль геометрии"}</h2></div><IconButton label="Закрыть панель" onClick={() => setDrawer(null)}><X size={18} /></IconButton></div>
      {drawer === "engineering" ? <EngineeringPanel spec={spec} onChange={commit} onRun={s => void submit(true, s)} results={engineering} revision={revision} mesh={mesh} busy={locked} dirty={dirty} onExample={kind => guard(() => { void loadEngineeringExample(kind); })} />
        : <div className="drawer-scroll">
        {drawer === "checks" && <><div className={"result-overview " + (!dirty && report?.passed ? "good" : "review")}><ShieldCheck size={27} /><div><strong>{dirty ? "Сначала построй изменения" : report?.passed ? "Геометрические проверки пройдены" : "Нужно проверить конструкцию"}</strong><p>Численные проверки и допуски находятся в разделе «Инженерия».</p></div></div>
          <div className="constraint-card"><h3>Требования к геометрии</h3><p>Размеры из ТЗ сохраняются при ручном редактировании. Меняй их только если меняется само задание.</p><label className="provider-toggle"><input type="checkbox" checked={!!spec.requirements.bounds} disabled={locked} onChange={e => edit(s => { s.requirements.bounds = e.target.checked ? [50, 30, 10] : null; })} />Контролировать габарит XYZ</label>{spec.requirements.bounds && <div className="vector-inputs">{spec.requirements.bounds.map((n, i) => <NumberField key={i} label={`Габарит ТЗ ${["X", "Y", "Z"][i]}`} min={0.01} value={n} onCommit={v => edit(s => { s.requirements.bounds![i] = v; })} />)}</div>}</div>
          {report?.checks.map((c, i) => <div className="check-row" key={i}>{c.passed ? <CheckCircle2 size={17} /> : <TriangleAlert size={17} />}<div><strong>{c.name}</strong><p>{c.detail}</p></div></div>)}<div className="warning-list">{report?.warnings.map((w, i) => <p key={i}>{w}</p>)}</div></>}
        {drawer === "history" && <><p className="drawer-description">Каждое построение — отдельная сохранённая версия. Непостроенные изменения можно отменить через ⌘ Z.</p>{!revisions.length && <div className="drawer-empty"><History size={32} /><p>Построй первую версию, чтобы сохранить историю проекта.</p></div>}{revisions.map((r, i) => { const p = JSON.parse(r.provenance); return <button className={"revision-card " + (r.id === revision ? "selected" : "")} key={r.id} onClick={() => guard(() => { void loadRevision(r, true); setDrawer(null); })}><span>v{revisions.length - i}</span><div><strong>{p.provider === "manual" ? "Ручное построение" : providerNames[p.provider] || p.provider}</strong><small>{new Date(r.created_at).toLocaleString("ru-RU")} · {p.model}</small></div>{r.id === revision ? <Check size={16} /> : <ArrowUpRight size={16} />}</button>; })}</>}
        {drawer === "export" && <><p className="drawer-description">Точная геометрия и файлы каждой детали. Чертежи остаются DRAFT до инженерной проверки.</p>{[["model.step", "STEP", "Точная геометрия для CAD и ЧПУ"], ["model.stl", "STL", "Полигональная модель для слайсера"], ["parts.zip", "Все детали", "STEP, STL, чертежи и спецификация"], ["drawings.pdf", "Чертежи PDF", "Проекции, размеры и заданные допуски"], ["drawings.zip", "PDF + DXF", "Отдельные чертежи деталей"], ["bom.csv", "Спецификация", "Состав, материалы и изготовление"]].map(([name, title, desc]) => <a key={name} className={"export-card " + (!canExport ? "disabled" : "")} aria-disabled={!canExport} href={canExport ? download(name) : undefined}><span>{title}</span><small>{desc}</small><Download size={17} /></a>)}<p className="micro-copy">DXF — проекции, не траектории инструмента. CAM и G-code не формируются.</p></>}
      </div>}
    </div>}

    {(error || lastFailed) && <div className="error-toast" role="alert"><TriangleAlert size={17} /><span>{error || lastFailed}</span><button onClick={() => { setError(""); if (lastFailed) setJobs(j => j.slice(1)); }} aria-label="Закрыть ошибку"><X size={15} /></button></div>}
    {toast && <div className="toast" role="status"><Check size={14} />{toast}</div>}
    <input type="file" accept=".json,application/json" ref={file} hidden onChange={async e => {
      try { const f = e.target.files?.[0]; if (!f) return; if (f.size > 200000) throw new Error("JSON больше 200 КБ"); const next = editableSpec(specSchema.parse(JSON.parse(await f.text()))); commit(next); setSelected(next.components[0]?.id || ""); note("Спецификация загружена. Построй CAD для обновления геометрии."); }
      catch (e) { setError("Не удалось импортировать: " + (e as Error).message); } e.target.value = "";
    }} />

    {settings && <Modal title="Твои модели. Твой компьютер." onClose={() => setSettings(false)} className="settings-modal"><p className="modal-description">neofab работает без аккаунта. Подключи локальный сервер, свой API или отдельно авторизованный CLI.</p><ProviderSettings onSaved={() => { void refresh(); note("Подключения сохранены на этом компьютере"); }} />
      <div className="provider-options">{[["local", "Локальная модель", "Ollama / LM Studio"], ["api", "Свой API", "Совместимый сервер"], ["codex", "Codex CLI", "Авторизован отдельно"], ["claude", "Claude Code", "Авторизован отдельно"]].map(([id, title, description]) => <button className={provider === id ? "selected" : ""} key={id} onClick={() => { setProvider(id); setModel(catalog?.models[id]?.[0]?.id || ""); }}><Code2 size={18} /><div><strong>{title}</strong><small>{description}</small></div>{provider === id && <CheckCircle2 size={16} />}</button>)}</div>
      <label className="field-label">Модель<select aria-label="Доступная модель" value={model} onChange={e => setModel(e.target.value)}>{!availableModels.length && <option value={model}>Включи провайдера и обнови каталог</option>}{!!availableModels.length && !selectedModel && <option value={model}>Выбери модель</option>}{availableModels.map(m => <option key={m.id} value={m.id}>{m.label}{m.availability === "verified" ? " · запрос выполнен" : ""}</option>)}</select></label>
      <div className="catalog-actions"><button className="button" onClick={() => { void api("models/refresh", {}).then(() => note("Узел обновляет каталог моделей")).catch(e => setError(e.message)); }}><Rotate3D size={14} />Обновить каталог</button><small>{selectedModel?.availability === "verified" ? "Есть выполненный запрос neofab" : selectedModel?.availability === "configured" ? "Модель задана вручную" : "Каталог провайдера"}</small></div>{catalog?.errors[provider] && <p className="notice">{catalog.errors[provider]}</p>}
      <details className="agent-settings"><summary>API и подключение внешнего агента</summary><p>Студия доступна только на этом компьютере. MCP: <code>worker-node/mcp_server.py</code>. Восемь инструментов работают с проектами, CAD и расчётами.</p><button className="button" onClick={() => { void api<{ token: string }>("tokens", {}).then(d => setToken(d.token)).catch(e => setError(e.message)); }}>Создать токен агента</button>{token && <div className="token-result"><code>{token}</code><button className="button" onClick={() => { void navigator.clipboard.writeText(token).then(() => note("Токен скопирован")); }}>Копировать</button><small>Показывается один раз.</small></div>}<button className="text-button danger" onClick={() => { void api("tokens", undefined, "DELETE").then(() => { setToken(""); note("Токены агентов отозваны"); }).catch(e => setError(e.message)); }}>Отозвать токены</button></details><button className="button dark full" onClick={() => setSettings(false)}>Готово<Check size={16} /></button>
    </Modal>}
    {newDialog && <Modal title="Новая конструкция" onClose={() => setNewDialog(false)} className="compact"><p className="modal-description">Начни с примитива или опиши деталь помощнику.</p><label className="field-label">Название проекта<input aria-label="Название проекта" value={newTitle} onChange={e => setNewTitle(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void createEmpty(); }} placeholder="Например, привод подачи" maxLength={120} /></label><button className="button dark full" disabled={busy || !newTitle.trim()} onClick={() => void createEmpty()}>Создать проект<Plus size={16} /></button></Modal>}
    {jsonOpen && <Modal title="CAD-спецификация" onClose={() => setJsonOpen(false)} className="json-modal"><p className="modal-description">Редактируй геометрию в поддерживаемой декларативной схеме. Применение можно отменить через ⌘ Z.</p><textarea className="json-editor" aria-label="CAD-спецификация JSON" spellCheck={false} value={jsonDraft} onChange={e => setJsonDraft(e.target.value)} />{jsonError && <p className="notice">{jsonError}</p>}<button className="button dark full" disabled={locked} onClick={() => { try { const next = editableSpec(specSchema.parse(JSON.parse(jsonDraft))); commit(next); setJsonOpen(false); note("Спецификация применена. Геометрию обновит CAD-движок."); } catch (e) { setJsonError((e as Error).message); } }}>Применить изменения<Check size={16} /></button></Modal>}
    {help && <Modal title="Модель под рукой" onClose={() => setHelp(false)} className="compact"><div className="shortcuts">{[["Вращение", "ЛКМ + движение"], ["Панорамирование", "ПКМ / ⇧ + ЛКМ"], ["Масштаб", "Колесо / жест двумя пальцами"], ["Выбор / перемещение / поворот", "V / G / R"], ["Измерить по сетке", "M"], ["Фокус на выбранной детали", "F"], ["Прозрачный вид", "X"], ["Отменить / повторить", "⌘ Z / ⇧ ⌘ Z"], ["Дублировать деталь", "⌘ D"]].map(([label, key]) => <p key={label}><span>{label}</span><kbd>{key}</kbd></p>)}</div><p className="micro-copy">Преобразования видны сразу. Размеры и операции подтверждаются отдельным построением CAD. Измерение и сечение работают по полигональной сетке.</p></Modal>}
    {confirmAction && <Modal title="Есть непостроенные изменения" onClose={() => setConfirmAction(null)} className="compact"><p className="modal-description">Смена проекта уберёт текущий черновик. Для сохранения сначала построй CAD.</p><div className="dialog-actions"><button className="button" onClick={() => setConfirmAction(null)}>Остаться</button><button className="button dark" onClick={() => { const action = confirmAction; setConfirmAction(null); action(); }}>Перейти без сохранения</button></div></Modal>}
  </main>;
}
