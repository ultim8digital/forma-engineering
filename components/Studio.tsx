"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Box,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Code2,
  Cpu,
  Download,
  FileJson,
  FileText,
  Folder,
  Layers3,
  LoaderCircle,
  Maximize2,
  Move3D,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import type { MeshData } from "./Viewport";
const Viewport = lazy(() => import("./Viewport"));
import { SAMPLE, specSchema, type PartSpec } from "@/lib/contracts";
type CheckResult = { name: string; passed: boolean; detail: string };
type Report = {
  passed: boolean;
  checks: CheckResult[];
  warnings: string[];
  bounds_mm: number[];
  volume_mm3: number;
  solids: number;
};
type Revision = {
  id: string;
  created_at: number;
  spec: string;
  report: string;
  provenance: string;
};
type Project = { id: string; title: string; current_revision: string | null };
type Job = {
  id: string;
  status: string;
  stage: string;
  error: string | null;
  prompt: string;
  provider: string;
};
type ProjectData = { project: Project; revisions: Revision[]; jobs: Job[] };
type WorkspaceData = { projects: Project[]; nodes: NodeInfo[] };
type NodeInfo = { name: string; seen_at: number; capabilities: string };
async function api<T>(path: string, body?: unknown, method?: string) {
  const r = await fetch("/api/" + path, {
    method: method || (body ? "POST" : "GET"),
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await r.json();
  if (!r.ok)
    throw new Error((data as { error?: string }).error || "Сервис недоступен");
  return data as T;
}
const names: Record<string, string> = {
  codex: "Codex",
  claude: "Claude Code",
  compatible: "Свой API",
  manual: "CAD-движок",
};
export default function Studio() {
  const [projects, setProjects] = useState<Project[]>([]),
    [project, setProject] = useState<Project | null>(null),
    [nodes, setNodes] = useState<NodeInfo[]>([]),
    [revisions, setRevisions] = useState<Revision[]>([]),
    [revision, setRevision] = useState<string | null>(null),
    [jobs, setJobs] = useState<Job[]>([]),
    [spec, setSpec] = useState<PartSpec>(SAMPLE),
    [mesh, setMesh] = useState<MeshData | null>(null),
    [report, setReport] = useState<Report | null>(null),
    [selected, setSelected] = useState("fork"),
    [tab, setTab] = useState("model"),
    [exploded, setExploded] = useState(false),
    [wire, setWire] = useState(false),
    [view, setView] = useState("iso"),
    [prompt, setPrompt] = useState(""),
    [provider, setProvider] = useState("codex"),
    [model, setModel] = useState("gpt-6-astra"),
    [settings, setSettings] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [token, setToken] = useState(""),
    [toast, setToast] = useState(""),
    [projectMenu, setProjectMenu] = useState(false),
    [newDialog, setNewDialog] = useState(false),
    [newTitle, setNewTitle] = useState(""),
    [inspector, setInspector] = useState("parameters");
  const file = useRef<HTMLInputElement>(null),
    activeRef = useRef<string | null>(null),
    revisionRef = useRef<string | null>(null),
    projectRef = useRef<Project | null>(null);
  projectRef.current = project;
  const node = nodes.find((n) => Date.now() - n.seen_at < 45000);
  const active = jobs.find((j) => ["queued", "running"].includes(j.status));
  const fail = jobs[0]?.status === "failed" ? jobs[0] : undefined;
  const note = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(""), 3500);
  };
  const loadRevision = useCallback(async (rev: Revision) => {
    const s = JSON.parse(rev.spec);
    setSpec(s);
    setReport(JSON.parse(rev.report));
    setRevision(rev.id);
    setDirty(false);
    setSelected(s.components[0]?.id || "body");
    const m = await fetch("/api/artifacts/" + rev.id + "/mesh.json");
    if (!m.ok) throw new Error("Не удалось загрузить геометрию");
    setMesh((await m.json()) as MeshData);
  }, []);
  const refreshProject = useCallback(
    async (id: string) => {
      const data = await api<ProjectData>("projects/" + id);
      if (projectRef.current?.id !== id) return;
      setProject(data.project);
      setRevisions(data.revisions);
      setJobs(data.jobs);
      if (
        data.project.current_revision &&
        data.project.current_revision !== revisionRef.current
      ) {
        revisionRef.current = data.project.current_revision;
        const rev = data.revisions.find(
          (r: Revision) => r.id === data.project.current_revision,
        );
        if (rev) await loadRevision(rev);
      }
    },
    [loadRevision],
  );
  const refresh = useCallback(async () => {
    const data = await api<WorkspaceData>("state");
    setProjects(data.projects);
    setNodes(data.nodes);
    if (activeRef.current) await refreshProject(activeRef.current);
  }, [refreshProject]);
  useEffect(() => {
    let live = true;
    Promise.all([
      fetch("/example-mesh.json").then((r) => r.json()),
      fetch("/example-report.json").then((r) => r.json()),
    ])
      .then(([m, r]) => {
        if (live) {
          setMesh(m as MeshData);
          setReport(r as Report);
          const requested = new URLSearchParams(window.location.search).get(
            "project",
          );
          if (requested)
            void api<ProjectData>("projects/" + encodeURIComponent(requested))
              .then((d) => chooseProject(d.project))
              .catch((e) => setError(e.message));
        }
      })
      .catch(() => setError("Не удалось загрузить учебный образец"));
    refresh().catch((e) => setError(e.message));
    const timer = setInterval(
      () => refresh().catch((e) => setError(e.message)),
      4000,
    );
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [refresh]);
  async function chooseProject(p: Project) {
    setProject(p);
    projectRef.current = p;
    activeRef.current = p.id;
    window.history.replaceState(
      null,
      "",
      "?project=" + encodeURIComponent(p.id),
    );
    revisionRef.current = null;
    setRevision(null);
    setRevisions([]);
    setJobs([]);
    setMesh(null);
    setReport(null);
    setSpec({
      ...SAMPLE,
      name: p.title,
      operations: [],
      components: [],
      joints: [],
    });
    setProjectMenu(false);
    setError("");
    try {
      await refreshProject(p.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function createProject(title: string) {
    const p = await api<Project>("projects", { title });
    setProject(p);
    projectRef.current = p;
    activeRef.current = p.id;
    window.history.replaceState(
      null,
      "",
      "?project=" + encodeURIComponent(p.id),
    );
    setProjects((prev) => [p, ...prev]);
    return p;
  }
  async function createEmpty() {
    if (!newTitle.trim()) return;
    try {
      setBusy(true);
      const p = await createProject(newTitle.trim());
      await chooseProject(p);
      setNewDialog(false);
      setPrompt("");
      setNewTitle("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(manual = false) {
    setError("");
    setBusy(true);
    try {
      const current = manual ? specSchema.parse(spec) : spec;
      let p = project;
      if (!p) {
        p = await createProject(
          manual ? spec.name : prompt.trim().slice(0, 65),
        );
        if (!manual) {
          setMesh(null);
          setReport(null);
          setRevision(null);
          setDirty(false);
          setSpec({
            ...SAMPLE,
            name: p.title,
            operations: [],
            components: [],
            joints: [],
            assumptions: [],
          });
        }
      }
      await api("projects/" + p.id + "/jobs", {
        prompt: manual ? "Построение из параметров" : prompt,
        provider: manual ? "manual" : provider,
        model: manual ? "" : model,
        ...(manual || revision ? { spec: current } : {}),
      });
      if (!manual) setPrompt("");
      await refreshProject(p.id);
      note("Задача отправлена на вычислительный узел");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function changeProvider(value: string) {
    setProvider(value);
    setModel(
      value === "codex" ? "gpt-6-astra" : value === "claude" ? "opus" : "",
    );
  }
  const components = spec.components.length
    ? spec.components
    : [
        {
          id: "body",
          name: spec.name,
          material: spec.material,
          process: spec.process,
          operations: spec.operations,
          at: [0, 0, 0],
        },
      ];
  const component = components.find((c) => c.id === selected) || components[0];
  function changeOp(index: number, field: string, value: number | number[]) {
    if (!Number.isFinite(typeof value === "number" ? value : 0)) return;
    setSpec((prev) => {
      const next = structuredClone(prev);
      const ops = next.components.length
        ? next.components.find((c) => c.id === component.id)!.operations
        : next.operations;
      (ops[index] as unknown as Record<string, unknown>)[field] = value;
      return next;
    });
    setDirty(true);
  }
  const download = (name: string) =>
    revision
      ? "/api/artifacts/" + revision + "/" + name + "?download=1"
      : "/examples/" + name;
  const source = revisions.find((r) => r.id === revision);
  const provenance = source ? JSON.parse(source.provenance) : null;
  return (
    <main className="studio">
      <aside className="rail">
        <a className="brand" href="/" aria-label="FORMA">
          F<span />
        </a>
        <button
          className="rail-button active"
          title="Мастерская"
          onClick={() => setTab("model")}
        >
          <Box size={21} />
        </button>
        <button
          className="rail-button"
          title="Проекты"
          onClick={() => setProjectMenu(!projectMenu)}
        >
          <Folder size={20} />
        </button>
        <button
          className="rail-button"
          title="Проверки"
          onClick={() => setTab("checks")}
        >
          <ShieldCheck size={21} />
        </button>
        <div className="rail-spacer" />
        <button
          className="rail-button"
          title="Подключения"
          onClick={() => setSettings(true)}
        >
          <Settings2 size={21} />
        </button>
        <div className="avatar">О</div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="wordmark">
            FORMA<span>ENGINEERING WORKSPACE</span>
          </div>
          <div className="top-center">
            <span className="live-dot" />
            Личная мастерская
          </div>
          <button className="button subtle" onClick={() => setSettings(true)}>
            <Cpu size={15} />
            <span>{node ? "Узел подключён" : "Подключить узел"}</span>
            <ArrowUpRight size={14} />
          </button>
        </header>
        <div className="projectbar">
          <div className="project-title">
            <span className="project-icon">
              <Layers3 size={20} />
            </span>
            <div>
              <div className="eyebrow">
                {project ? "ПРОЕКТ" : "УЧЕБНЫЙ ОБРАЗЕЦ · СОЗДАН ВРУЧНУЮ"}
              </div>
              <button
                className="project-name"
                onClick={() => setProjectMenu(!projectMenu)}
              >
                {project?.title || "Роликовая опора"}
                <ChevronDown size={15} />
              </button>
            </div>
            {projectMenu && (
              <div className="dropdown project-dropdown">
                <strong>Проекты мастерской</strong>
                {projects.map((p) => (
                  <button key={p.id} onClick={() => chooseProject(p)}>
                    <Folder size={14} />
                    {p.title}
                  </button>
                ))}
                {!projects.length && <p>Пока нет сохранённых проектов</p>}
                <button
                  onClick={() => {
                    setNewDialog(true);
                    setProjectMenu(false);
                  }}
                >
                  <Plus size={15} />
                  Новый проект
                </button>
              </div>
            )}
          </div>
          <div className="project-actions">
            <span className="pill neutral">
              {revision
                ? "v" +
                  (revisions.length -
                    revisions.findIndex((r) => r.id === revision))
                : "Образец"}
            </span>
            <button className="button" onClick={() => file.current?.click()}>
              <FileJson size={15} />
              <span>Импорт JSON</span>
            </button>
            <a
              className={"button primary " + (!mesh || dirty ? "disabled" : "")}
              href={mesh && !dirty ? download("parts.zip") : undefined}
              aria-disabled={!mesh || dirty}
            >
              <Download size={15} />
              Файлы деталей
            </a>
          </div>
        </div>
        <div className="body-grid">
          <aside className="structure">
            <div className="panel-heading">
              Структура проекта
              <button
                className="icon-button"
                title="Новый проект"
                onClick={() => setNewDialog(true)}
              >
                <Plus size={16} />
              </button>
            </div>
            <div className="tree-root">
              <ChevronDown size={13} />
              <Layers3 size={16} />
              <span>{spec.components.length ? "Сборка" : "Деталь"}</span>
              <small>{components.length}</small>
            </div>
            <div className="parts-tree">
              {components.map((c, i) => (
                <button
                  key={c.id}
                  className={
                    "part-item " + (component?.id === c.id ? "selected" : "")
                  }
                  onClick={() => setSelected(c.id)}
                >
                  <span className={"part-color color-" + i} />
                  <Box size={15} />
                  <span>{c.name}</span>
                </button>
              ))}
            </div>
            <div className="section-label">
              ОПЕРАЦИИ <span>{component?.operations.length || 0}</span>
            </div>
            <div className="operation-list">
              {component?.operations.map((o, i) => (
                <div key={i}>
                  <span className="operation-icon">
                    {o.type === "cylinder"
                      ? "◉"
                      : o.type === "fillet"
                        ? "⌒"
                        : "▱"}
                  </span>
                  <span>{o.id}</span>
                  <small>{"mode" in o && o.mode === "cut" ? "−" : "+"}</small>
                </div>
              ))}
            </div>
            <div className="structure-bottom">
              <div className="section-label">ВЫЧИСЛЕНИЯ</div>
              <button
                className="compute-card"
                onClick={() => setSettings(true)}
              >
                <span className={"status-led " + (node ? "online" : "")} />
                <div>
                  <strong>
                    {node ? "Собственный узел" : "Узел не подключён"}
                  </strong>
                  <small>
                    {node ? "CadQuery · OpenCascade" : "Настроить подключение"}
                  </small>
                </div>
                <ChevronRight size={14} />
              </button>
              <div className="mini-note">
                <ShieldCheck size={13} />
                Геометрия проверяется отдельно от ИИ
              </div>
            </div>
          </aside>
          <section className="center-panel">
            <div className="canvas-tabs">
              <button
                className={tab === "model" ? "selected" : ""}
                onClick={() => setTab("model")}
              >
                <Box size={14} />
                Модель
              </button>
              <button
                className={tab === "bom" ? "selected" : ""}
                onClick={() => setTab("bom")}
              >
                <Layers3 size={14} />
                Состав
              </button>
              <button
                className={tab === "checks" ? "selected" : ""}
                onClick={() => setTab("checks")}
              >
                <ShieldCheck size={14} />
                Проверки
                {report && (
                  <span className="tab-count">{report.checks.length}</span>
                )}
              </button>
              <button
                className={tab === "history" ? "selected" : ""}
                onClick={() => setTab("history")}
              >
                <RotateCcw size={14} />
                Версии
              </button>
            </div>
            {tab === "model" && (
              <div className="canvas-area">
                {mesh ? (
                  <Suspense
                    fallback={
                      <div className="canvas-empty">Загрузка 3D-движка…</div>
                    }
                  >
                    <Viewport
                      data={mesh}
                      selected={selected}
                      onSelect={setSelected}
                      exploded={exploded}
                      wireframe={wire}
                      view={view}
                    />
                  </Suspense>
                ) : (
                  <div className="canvas-empty">
                    <Box size={44} />
                    <h2>Начни с инженерной задачи</h2>
                    <p>
                      Опиши деталь или сборку в панели справа.
                      <br />
                      Здесь появится геометрия из CAD-движка.
                    </p>
                  </div>
                )}
                <div className="canvas-top">
                  <span className="canvas-label">
                    <span className="live-dot" />
                    {spec.components.length ? "ASSEMBLY" : "PART"} <i>/</i>{" "}
                    {spec.units.toUpperCase()}
                  </span>
                  <div className="view-controls">
                    <button
                      className={exploded ? "toggled" : ""}
                      onClick={() => setExploded(!exploded)}
                      title="Разнесённый вид"
                    >
                      <Move3D size={17} />
                    </button>
                    <button
                      className={wire ? "toggled" : ""}
                      onClick={() => setWire(!wire)}
                      title="Каркас"
                    >
                      <Box size={17} />
                    </button>
                    <button
                      onClick={() =>
                        setView(view === "iso" ? "iso-reset" : "iso")
                      }
                      title="Изометрия"
                    >
                      <Maximize2 size={16} />
                    </button>
                  </div>
                </div>
                <div className="orientation">
                  <button onClick={() => setView("top")}>ВЕРХ</button>
                  <button onClick={() => setView("front")}>СПЕРЕДИ</button>
                  <button className="iso-button" onClick={() => setView("iso")}>
                    ISO
                  </button>
                </div>
                <div className="canvas-bottom">
                  <span>
                    <span className="axis-x">X</span>
                    <span className="axis-y">Y</span>
                    <span className="axis-z">Z</span>
                    <i />
                    Перетаскивай для вращения
                  </span>
                  <span>
                    {report
                      ? report.bounds_mm
                          .map((v) => Number(v.toFixed(1)))
                          .join(" × ") + " мм"
                      : "Миллиметры"}
                  </span>
                </div>
                {dirty && (
                  <div className="dirty-banner">
                    <TriangleAlert size={15} />
                    Параметры изменены — модель показывает предыдущую геометрию
                    <button
                      onClick={() => submit(true)}
                      disabled={!!active || busy}
                    >
                      Перестроить
                      <ArrowRight size={14} />
                    </button>
                  </div>
                )}
              </div>
            )}
            {tab === "bom" && (
              <div className="data-panel">
                <div className="content-heading">
                  <div className="eyebrow">BILL OF MATERIALS</div>
                  <h2>Каждая деталь — отдельно</h2>
                  <p>Материалы и способ изготовления заданы в спецификации.</p>
                </div>
                <div className="bom-list">
                  {components.map((c, i) => (
                    <article key={c.id}>
                      <span className={"part-swatch color-" + i}>
                        <Box size={23} />
                      </span>
                      <div>
                        <strong>{c.name}</strong>
                        <p>{c.material}</p>
                        <small>{c.process} · 1 шт.</small>
                      </div>
                      <button
                        className="icon-button"
                        onClick={() => {
                          setSelected(c.id);
                          setTab("model");
                        }}
                        title="Показать деталь"
                      >
                        <ArrowUpRight size={17} />
                      </button>
                    </article>
                  ))}
                </div>
                <a className="button" href={download("bom.csv")}>
                  <ArrowDownToLine size={15} />
                  Скачать спецификацию CSV
                </a>
                <a className="button primary" href={download("parts.zip")}>
                  <Download size={15} />
                  STEP и STL каждой детали
                </a>
                {spec.joints.length > 0 && (
                  <div className="joint-card">
                    <strong>Связи компонентов</strong>
                    {spec.joints.map((j) => (
                      <p key={j.name}>
                        {j.name} <span className="pill neutral">{j.type}</span>
                        <small>{j.description}</small>
                      </p>
                    ))}
                    <small>
                      Связи описательные. Кинематический решатель не подключён.
                    </small>
                  </div>
                )}
              </div>
            )}
            {tab === "checks" && (
              <div className="data-panel">
                <div className="content-heading">
                  <div className="eyebrow">GEOMETRY VALIDATION</div>
                  <h2>
                    {report
                      ? report.passed
                        ? "Геометрия прошла проверки"
                        : "Найдены замечания"
                      : "Ожидаем построения"}
                  </h2>
                  <p>
                    Измерения выполнены CAD-движком. Область проверки —
                    геометрия.
                  </p>
                </div>
                {dirty && (
                  <div className="notice">
                    Параметры изменены. Ниже — проверки предыдущей геометрии.
                  </div>
                )}
                <div className="check-list">
                  {report?.checks.map((c, i) => (
                    <div key={i}>
                      {c.passed ? (
                        <CheckCircle2 size={18} />
                      ) : (
                        <TriangleAlert size={18} />
                      )}
                      <div>
                        <strong>{c.name}</strong>
                        <small>{c.detail}</small>
                      </div>
                      <span
                        className={"pill " + (c.passed ? "success" : "warning")}
                      >
                        {c.passed ? "Пройдено" : "Замечание"}
                      </span>
                    </div>
                  ))}
                </div>
                <h3>Требует инженерной проверки</h3>
                {report?.warnings.map((w, i) => (
                  <p className="warning-line" key={i}>
                    <Circle size={6} />
                    {w}
                  </p>
                ))}
                <a href={download("report.json")} className="button">
                  <FileText size={15} />
                  Отчёт JSON
                </a>
              </div>
            )}
            {tab === "history" && (
              <div className="data-panel">
                <div className="content-heading">
                  <div className="eyebrow">VERSION HISTORY</div>
                  <h2>История конструкции</h2>
                  <p>
                    Каждое построение сохраняет спецификацию, модели и
                    результаты проверок.
                  </p>
                </div>
                {revisions.length ? (
                  revisions.map((r, i) => {
                    const prov = JSON.parse(r.provenance);
                    return (
                      <button
                        className={
                          "revision-card " +
                          (r.id === revision ? "selected" : "")
                        }
                        key={r.id}
                        onClick={() =>
                          loadRevision(r).catch((e) => setError(e.message))
                        }
                      >
                        <span>v{revisions.length - i}</span>
                        <div>
                          <strong>{JSON.parse(r.spec).name}</strong>
                          <small>
                            {names[prov.provider] || prov.provider} ·{" "}
                            {prov.model} ·{" "}
                            {new Date(r.created_at).toLocaleString("ru-RU")}
                          </small>
                        </div>
                        <ChevronRight size={16} />
                      </button>
                    );
                  })
                ) : (
                  <div className="empty-state">
                    <RotateCcw size={28} />
                    <p>После первого построения здесь появятся версии.</p>
                  </div>
                )}
              </div>
            )}
            <div className="validation-bar">
              <div>
                <ShieldCheck size={17} />
                <strong>
                  {dirty
                    ? "Нужно перестроить"
                    : report
                      ? report.passed ? "Геометрия проверена" : "Есть замечания"
                      : "Ожидает проверки"}
                </strong>
                <span>
                  {report
                    ? report.solids +
                      " тела · " +
                      report.checks.filter((c) => c.passed).length +
                      "/" +
                      report.checks.length +
                      " проверок"
                    : "CAD-движок"}
                </span>
              </div>
              <button onClick={() => setTab("checks")}>
                Отчёт
                <ArrowUpRight size={14} />
              </button>
            </div>
            <div className="brief-panel">
              <div className="brief-header">
                <span className="blue-mark">
                  <SlidersHorizontal size={17} />
                </span>
                <h3>{component?.name || "Параметры конструкции"}</h3>
                <div className="segmented">
                  <button
                    className={inspector === "parameters" ? "selected" : ""}
                    onClick={() => setInspector("parameters")}
                  >
                    Параметры
                  </button>
                  <button
                    className={inspector === "spec" ? "selected" : ""}
                    onClick={() => setInspector("spec")}
                  >
                    JSON
                  </button>
                </div>
              </div>
              {inspector === "parameters" ? (
                <div className="parameters">
                  <div className="material-field">
                    <label>Материал</label>
                    <strong>{component?.material || "Не задан"}</strong>
                    <small>{component?.process}</small>
                  </div>
                  {component?.operations.slice(0, 4).map((o, i) =>
                    "size" in o ? (
                      <div className="dimension-field" key={i}>
                        <label>{o.id} · XYZ, мм</label>
                        <div>
                          {o.size.map((v, j) => (
                            <input
                              key={j}
                              type="number"
                              aria-label={o.id + " " + ["X", "Y", "Z"][j]}
                              value={v}
                              step="0.1"
                              min="0.01"
                              max="2000"
                              onChange={(e) =>
                                changeOp(
                                  i,
                                  "size",
                                  o.size.map((n, k) =>
                                    j === k ? Number(e.target.value) : n,
                                  ),
                                )
                              }
                            />
                          ))}
                        </div>
                      </div>
                    ) : "radius" in o ? (
                      <div className="dimension-field" key={i}>
                        <label>{o.id} · радиус, мм</label>
                        <input
                          type="number"
                          aria-label={o.id + " радиус"}
                          value={o.radius}
                          step="0.1"
                          min="0.01"
                          max="2000"
                          onChange={(e) =>
                            changeOp(i, "radius", Number(e.target.value))
                          }
                        />
                      </div>
                    ) : null,
                  )}
                  <button
                    className="button rebuild"
                    onClick={() => submit(true)}
                    disabled={!!active || busy || !mesh}
                  >
                    <RotateCcw size={14} />
                    {busy ? "Отправка…" : "Перестроить"}
                  </button>
                </div>
              ) : (
                <textarea
                  className="json-editor"
                  aria-label="CAD-спецификация JSON"
                  value={JSON.stringify(spec, null, 2)}
                  readOnly
                />
              )}
            </div>
          </section>
          <aside className="assistant">
            <div className="assistant-heading">
              <span className="ai-icon">
                <Sparkles size={18} />
              </span>
              <div>
                <strong>Инженерный помощник</strong>
                <small>Задача → конструкция → проверка</small>
              </div>
              <button
                className="icon-button"
                onClick={() => setSettings(true)}
                title="Настроить модель"
              >
                <Settings2 size={16} />
              </button>
            </div>
            <div className="conversation">
              <div className="assistant-intro">
                <div className="eyebrow">ПРОЕКТИРУЕМ ВМЕСТЕ</div>
                <h2>
                  От замысла
                  <br />к точной геометрии.
                </h2>
                <p>
                  Опиши назначение, размеры и способ изготовления. Помощник
                  подготовит конструкцию, CAD-движок построит и проверит её.
                </p>
              </div>
              <div className="workflow-steps">
                <div>
                  <span>01</span>
                  <strong>Техническое задание</strong>
                  <small>Размеры, материал, ограничения</small>
                </div>
                <div>
                  <span>02</span>
                  <strong>Детали и сборка</strong>
                  <small>Параметры и отдельные компоненты</small>
                </div>
                <div>
                  <span>03</span>
                  <strong>Проверка и экспорт</strong>
                  <small>B-Rep, пересечения, STEP / STL</small>
                </div>
              </div>
              {!project && (
                <div className="sample-note">
                  <Box size={16} />
                  <div>
                    <strong>Открыт учебный образец</strong>
                    <p>
                      Роликовая опора из 3 деталей. Можно разобрать, изменить
                      параметры и перестроить.
                    </p>
                  </div>
                </div>
              )}
              {active && (
                <div className="job-progress">
                  <LoaderCircle className="spin" size={17} />
                  <div>
                    <strong>{active.stage}</strong>
                    <small>{names[active.provider]} · задача выполняется</small>
                  </div>
                </div>
              )}
              {fail && !active && (
                <div className="notice error">
                  <TriangleAlert size={16} />
                  {fail.error}
                </div>
              )}
              {provenance && (
                <div className="provenance">
                  <Check size={14} />
                  {names[provenance.provider]} · {provenance.model}
                  <small>
                    {provenance.attempts} попыток · {provenance.elapsed_seconds}{" "}
                    с
                  </small>
                </div>
              )}
              <div className="suggestions">
                <span>МОЖНО НАЧАТЬ ТАК</span>
                {[
                  "Спроектируй корпус 100×60×30 мм с крышкой для FDM-печати",
                  "Сделай сборку из вала Ø8 и двух опор для обработки на ЧПУ",
                ].map((s) => (
                  <button key={s} onClick={() => setPrompt(s)}>
                    {s}
                    <ArrowUpRight size={14} />
                  </button>
                ))}
              </div>
            </div>
            <div className="composer-area">
              {error && (
                <div className="notice error" role="alert">
                  <TriangleAlert size={14} />
                  {error}
                  <button
                    className="icon-button"
                    onClick={() => setError("")}
                    title="Закрыть ошибку"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
              <div className="composer">
                <textarea
                  aria-label="Инженерная задача"
                  placeholder={
                    "Что будем проектировать?\nУкажи размеры, нагрузки и оборудование…"
                  }
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      (e.metaKey || e.ctrlKey) &&
                      e.key === "Enter" &&
                      !busy &&
                      !active &&
                      prompt.trim()
                    )
                      submit();
                  }}
                />
                <div className="composer-bottom">
                  <button
                    className="provider-chip"
                    onClick={() => setSettings(true)}
                  >
                    <span className="live-dot" />
                    {names[provider]}
                    <ChevronDown size={12} />
                  </button>
                  <button
                    className="send-button"
                    title="Спроектировать"
                    onClick={() => submit()}
                    disabled={busy || !!active || !prompt.trim()}
                  >
                    {busy || active ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : (
                      <ArrowRight size={18} />
                    )}
                  </button>
                </div>
              </div>
              <div className="composer-note">
                {node
                  ? "Вычисления на твоём узле"
                  : "Для построения подключи вычислительный узел"}
                <span>⌘ ↵</span>
              </div>
            </div>
          </aside>
        </div>
        <footer className="statusbar">
          <span>
            <span className={"status-led " + (node ? "online" : "")} />
            {node ? "Compute online" : "Compute offline"}
            <i />
            mm
            <i />
            B-Rep / OpenCascade
          </span>
          <span>
            FORMA <b>0.1</b>
            <i />
            Инженерный пилот
          </span>
        </footer>
      </div>
      <input
        type="file"
        accept=".json,application/json"
        ref={file}
        hidden
        onChange={async (e) => {
          try {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > 200000) throw new Error("JSON больше 200 КБ");
            const s = specSchema.parse(JSON.parse(await f.text()));
            setSpec(s);
            setSelected(s.components[0]?.id || "body");
            setDirty(true);
            note("Спецификация загружена. Нажми «Перестроить».");
          } catch (err) {
            setError("Не удалось импортировать: " + (err as Error).message);
          }
          e.target.value = "";
        }}
      />
      {settings && (
        <div className="modal-backdrop" onClick={() => setSettings(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Подключения"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              onClick={() => setSettings(false)}
              title="Закрыть"
            >
              <X size={20} />
            </button>
            <div className="eyebrow">YOUR MODELS. YOUR COMPUTE.</div>
            <h2>Подключения</h2>
            <p>Выбери, кто проектирует. Геометрию всегда строит CAD-узел.</p>
            <div className="provider-options">
              {[
                ["codex", "Codex", "Локальный вход ChatGPT"],
                ["claude", "Claude Code", "Локальный вход Anthropic"],
                [
                  "compatible",
                  "Совместимый API",
                  "LM Studio, Ollama или свой сервер",
                ],
              ].map(([v, title, desc]) => (
                <button
                  className={provider === v ? "selected" : ""}
                  key={v}
                  onClick={() => changeProvider(v)}
                >
                  <Code2 size={20} />
                  <div>
                    <strong>{title}</strong>
                    <small>{desc}</small>
                  </div>
                  {provider === v && <CheckCircle2 size={18} />}
                </button>
              ))}
            </div>
            <label className="field-label">
              Модель
              <input
                value={model}
                placeholder={
                  provider === "compatible"
                    ? "ID модели на сервере"
                    : "ID модели"
                }
                onChange={(e) => setModel(e.target.value)}
              />
            </label>
            <div className="connection-status">
              <Cpu size={20} />
              <div>
                <strong>
                  {node ? "Узел подключён" : "Вычислительный узел не подключён"}
                </strong>
                <small>
                  {node
                    ? node.name
                    : "Запусти узел на своём компьютере или сервере"}
                </small>
              </div>
            </div>
            <code className="code-block">
              .venv/bin/python worker-node/runner.py
            </code>
            <p className="small-copy">
              Вход в Codex / Claude выполняется в их CLI на узле. Ключи API
              хранятся в окружении узла. FORMA не получает пароль от подписки.
            </p>
            <details>
              <summary>API и подключение внешнего агента</summary>
              <p>
                REST API: <code>/api/projects</code>,{" "}
                <code>/api/projects/:id/jobs</code>. MCP:{" "}
                <code>worker-node/mcp_server.py</code>. Для приватного сайта
                также нужен сервисный доступ Sites.
              </p>
              <button
                className="button"
                onClick={async () => {
                  try {
                    const d = await api<{ token: string }>("tokens", {});
                    setToken(d.token);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Создать токен агента
              </button>
              {token && (
                <div className="token-result">
                  <code>{token}</code>
                  <button
                    className="button"
                    onClick={() =>
                      navigator.clipboard
                        .writeText(token)
                        .then(() => note("Токен скопирован"))
                    }
                  >
                    Копировать
                  </button>
                  <small>Показывается один раз. Сохрани на своём узле.</small>
                </div>
              )}
              <button
                className="text-button"
                onClick={async () => {
                  try {
                    await api("tokens", undefined, "DELETE");
                    setToken("");
                    note("Токены агентов отозваны");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Отозвать все токены агентов
              </button>
            </details>
            <button
              className="button primary full"
              onClick={() => setSettings(false)}
            >
              Сохранить выбор
              <ArrowRight size={15} />
            </button>
          </section>
        </div>
      )}
      {newDialog && (
        <div className="modal-backdrop" onClick={() => setNewDialog(false)}>
          <section
            className="modal compact"
            role="dialog"
            aria-modal="true"
            aria-label="Новый проект"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              onClick={() => setNewDialog(false)}
              title="Закрыть"
            >
              <X size={20} />
            </button>
            <div className="eyebrow">НОВАЯ КОНСТРУКЦИЯ</div>
            <h2>Новый проект</h2>
            <label className="field-label">
              Название
              <input
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Например, привод подачи"
                onKeyDown={(e) => {
                  if (e.key === "Enter") createEmpty();
                }}
              />
            </label>
            <button
              className="button primary full"
              disabled={!newTitle.trim() || busy}
              onClick={createEmpty}
            >
              Создать проект
              <Plus size={15} />
            </button>
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
    </main>
  );
}
