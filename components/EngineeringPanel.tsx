"use client";
import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import {
  Activity,
  ArrowRight,
  Download,
  FileText,
  Play,
  Plus,
  RotateCcw,
  Square,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type { PartSpec } from "@/lib/contracts";
import {
  EMPTY_ENGINEERING,
  type Engineering,
  type EngineeringResults,
} from "@/lib/engineering";
import type { MeshData } from "./Viewport";
const Viewport = lazy(() => import("./Viewport"));
type Field = {
  vertices: number[][];
  triangles: number[][];
  displacements: number[][];
  von_mises_mpa: number[];
  max_von_mises_mpa?: number;
  component_id?: string;
};
const numeric = (n: number | undefined, d = 3) => {
  if (n === undefined) return "—";
  if (n !== 0 && (Math.abs(n) < 0.001 || Math.abs(n) >= 1e6))
    return n.toExponential(d - 1).replace(".", ",");
  return new Intl.NumberFormat("ru-RU", { maximumSignificantDigits: d }).format(
    n,
  );
};
const stateNames: Record<string, string> = {
  not_configured: "Не настроено",
  failed: "Ошибка расчёта",
  within_limits: "В пределах заданных условий",
  needs_review: "Требует проверки",
  sampled_clear: "В проверенных положениях свободно",
  collision: "Обнаружены столкновения",
  underconstrained: "Есть неопределённые степени свободы",
  dimensioned_draft: "Размеры и допуски заданы",
};
function Metric({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="engineering-metric">
      <span>{label}</span>
      <strong>
        {value}
        <small>{unit}</small>
      </strong>
    </div>
  );
}
function N({
  label,
  value,
  onChange,
  step = 1,
  min,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
}) {
  return (
    <label className="engineering-field">
      {label}
      <input
        type="number"
        value={Number.isFinite(value) ? value : ""}
        step={step}
        min={min}
        onChange={(e) =>
          onChange(e.target.value === "" ? 0 : Number(e.target.value))
        }
      />
    </label>
  );
}
function Notes({ values }: { values?: string[] }) {
  return (
    <div className="engineering-notes">
      {values?.map((n, i) => (
        <p key={i}>
          <TriangleAlert size={12} />
          {n}
        </p>
      ))}
    </div>
  );
}
export default function EngineeringPanel({
  spec,
  onChange,
  onRun,
  results,
  revision,
  mesh,
  busy,
  dirty,
  onExample,
}: {
  spec: PartSpec;
  onChange: (s: PartSpec) => void;
  onRun: (s: PartSpec) => void;
  results: EngineeringResults | null;
  revision: string | null;
  mesh: MeshData | null;
  busy: boolean;
  dirty: boolean;
  onExample: (kind: string) => void;
}) {
  const [section, setSection] = useState("strength"),
    [frame, setFrame] = useState(0),
    [playing, setPlaying] = useState(false),
    [field, setField] = useState<Field | null>(null),
    [deformation, setDeformation] = useState(1);
  const engineering = spec.engineering || structuredClone(EMPTY_ENGINEERING);
  const components = spec.components.length
    ? spec.components
    : [{ id: "body", name: spec.name }];
  const update = (next: Engineering) =>
    onChange({ ...spec, engineering: next });
  const strength = engineering.strength;
  const motion = engineering.motion;
  const motionResult = results?.motion,
    frames = motionResult?.frames || [];
  const strengthResult = results?.strength,
    drawings = results?.drawings;
  useEffect(() => {
    setPlaying(false);
    setFrame(0);
    setField(null);
    if (!revision) return;
    let current = true;
    fetch("/api/artifacts/" + revision + "/strength-mesh.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (current) setField(d as Field | null);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [revision]);
  useEffect(() => {
    if (!playing || !frames.length) return;
    const timer = setInterval(
      () => setFrame((v) => (v + 1) % frames.length),
      150,
    );
    return () => clearInterval(timer);
  }, [playing, frames.length]);
  const fieldMesh = useMemo<MeshData | null>(
    () =>
      field?.vertices.length
        ? {
            vertices: field.vertices.map((v, i) =>
              v.map(
                (x, j) => x + (field.displacements[i]?.[j] || 0) * deformation,
              ),
            ),
            triangles: field.triangles,
            groups: [
              {
                id: field.component_id || "analysis",
                name: "Расчётная деталь",
                start: 0,
                count: field.triangles.length,
                center: [0, 0, 0],
              },
            ],
            bounds: mesh?.bounds || [100, 100, 100],
            scalars: field.von_mises_mpa,
            scalarMax: field.max_von_mises_mpa,
          }
        : null,
    [field, deformation, mesh],
  );
  const link = (name: string) =>
    revision
      ? "/api/artifacts/" + revision + "/" + name + "?download=1"
      : undefined;
  function configureStrength() {
    update({
      ...engineering,
      strength: {
        component_id: components[0].id,
        youngs_modulus_mpa: 0,
        poisson_ratio: 0.3,
        yield_strength_mpa: 0,
        material_source: "",
        material_basis: "isotropic_bulk",
        target_safety_factor: 2,
        mesh_size_mm: 3,
        refine: true,
        fixtures: [{ axis: "x", side: "min" }],
        loads: [{ axis: "x", side: "max", force_n: [0, 0, -100] }],
      },
    });
  }
  function addJoint() {
    if (components.length < 2) return;
    const name = "Связь " + (spec.joints.length + 1);
    onChange({
      ...spec,
      joints: [
        ...spec.joints,
        {
          name,
          type: "revolute",
          components: [components[0].id, components[1].id],
          description: "Связь, заданная пользователем",
          axis: [0, 0, 1],
          origin: [0, 0, 0],
          limits: [-180, 180],
          home: 0,
        },
      ],
    });
  }
  function jointChange(
    index: number,
    patch: Partial<PartSpec["joints"][number]>,
  ) {
    onChange({
      ...spec,
      joints: spec.joints.map((j, i) => (i === index ? { ...j, ...patch } : j)),
      engineering:
        patch.name && engineering.motion
          ? {
              ...engineering,
              motion: {
                ...engineering.motion,
                drivers: engineering.motion.drivers.map((d) =>
                  d.joint_name === spec.joints[index].name
                    ? { ...d, joint_name: patch.name! }
                    : d,
                ),
              },
            }
          : engineering,
    });
  }
  function run() {
    setPlaying(false);
    onRun(spec);
  }
  const configured =
    section === "strength"
      ? !!strength
      : section === "motion"
        ? !!motion
        : true;
  return (
    <div className="engineering-workbench">
      <div className="engineering-nav">
        {[
          ["strength", "Прочность"],
          ["motion", "Движение"],
          ["drawings", "Чертежи"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={section === id ? "selected" : ""}
            onClick={() => setSection(id)}
          >
            {label}
          </button>
        ))}
        <span>Данные → расчёт → версия</span>
      </div>
      <div className="engineering-scroll">
        <fieldset className="engineering-fields" disabled={busy}>
          <div className="engineering-title">
            <div className="eyebrow">
              {section === "strength"
                ? "FINITE ELEMENT ANALYSIS"
                : section === "motion"
                  ? "ASSEMBLY MOTION"
                  : "MANUFACTURING DRAWINGS"}
            </div>
            <h2>
              {section === "strength"
                ? "Прочность по геометрии CAD"
                : section === "motion"
                  ? "Проверка движения сборки"
                  : "Чертежи деталей с допусками"}
            </h2>
            <p>
              {section === "strength"
                ? "Линейная статика выбранной детали: сетка, нагрузки, закрепления и контроль сходимости."
                : section === "motion"
                  ? "Задай шарниры и траекторию. CAD-движок проверит пересечения в каждом положении."
                  : "Три ортогональных вида, измеренные размеры, координаты осей и числовые допуски."}
            </p>
          </div>
          {dirty && (
            <div className="notice">
              Исходные данные изменены. Результаты ниже относятся к предыдущей
              сохранённой версии.
            </div>
          )}
          {section === "strength" && (
            <>
              {!strength ? (
                <div className="engineering-start">
                  <Activity size={25} />
                  <p>
                    Для расчёта нужны свойства материала, нагрузка и
                    закрепление.
                  </p>
                  <button
                    className="button primary"
                    onClick={configureStrength}
                  >
                    Задать условия
                    <Plus size={14} />
                  </button>
                  <button className="button" onClick={() => onExample("beam")}>
                    Контрольный пример: балка
                  </button>
                </div>
              ) : (
                <details
                  className="engineering-conditions"
                  open={
                    !strengthResult ||
                    strengthResult.status === "not_configured"
                  }
                >
                  <summary>Исходные данные: материал, нагрузки и сетка</summary>
                  <div className="engineering-form-grid">
                    <label className="engineering-field">
                      Расчётная деталь
                      <select
                        value={strength.component_id}
                        onChange={(e) =>
                          update({
                            ...engineering,
                            strength: {
                              ...strength,
                              component_id: e.target.value,
                            },
                          })
                        }
                      >
                        {components.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="engineering-field">
                      Модель материала
                      <select
                        value={strength.material_basis}
                        onChange={(e) =>
                          update({
                            ...engineering,
                            strength: {
                              ...strength,
                              material_basis: e.target.value as
                                "isotropic_bulk" | "fdm_coupon_effective",
                            },
                          })
                        }
                      >
                        <option value="isotropic_bulk">
                          Изотропный объёмный
                        </option>
                        <option value="fdm_coupon_effective">
                          Эффективный по образцу FDM
                        </option>
                      </select>
                    </label>
                    <N
                      label="Модуль E, МПа"
                      value={strength.youngs_modulus_mpa}
                      onChange={(n) =>
                        update({
                          ...engineering,
                          strength: { ...strength, youngs_modulus_mpa: n },
                        })
                      }
                      min={0}
                    />
                    <N
                      label="Коэффициент Пуассона ν"
                      value={strength.poisson_ratio}
                      step={0.01}
                      onChange={(n) =>
                        update({
                          ...engineering,
                          strength: { ...strength, poisson_ratio: n },
                        })
                      }
                    />
                    <N
                      label="Предел текучести, МПа"
                      value={strength.yield_strength_mpa}
                      min={0}
                      onChange={(n) =>
                        update({
                          ...engineering,
                          strength: { ...strength, yield_strength_mpa: n },
                        })
                      }
                    />
                    <N
                      label="Требуемый запас"
                      value={strength.target_safety_factor}
                      step={0.1}
                      min={1}
                      onChange={(n) =>
                        update({
                          ...engineering,
                          strength: { ...strength, target_safety_factor: n },
                        })
                      }
                    />
                  </div>
                  <label className="engineering-field wide">
                    Источник свойств материала
                    <input
                      placeholder="Паспорт материала или протокол испытания образца"
                      value={strength.material_source}
                      onChange={(e) =>
                        update({
                          ...engineering,
                          strength: {
                            ...strength,
                            material_source: e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                  <div className="engineering-form-grid">
                    <label className="engineering-field">
                      Заделка · ось
                      <select
                        value={strength.fixtures[0].axis}
                        onChange={(e) =>
                          update({
                            ...engineering,
                            strength: {
                              ...strength,
                              fixtures: [
                                {
                                  ...strength.fixtures[0],
                                  axis: e.target.value as "x" | "y" | "z",
                                },
                              ],
                            },
                          })
                        }
                      >
                        {["x", "y", "z"].map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    </label>
                    <label className="engineering-field">
                      Заделка · грань
                      <select
                        value={strength.fixtures[0].side}
                        onChange={(e) =>
                          update({
                            ...engineering,
                            strength: {
                              ...strength,
                              fixtures: [
                                {
                                  ...strength.fixtures[0],
                                  side: e.target.value as "min" | "max",
                                },
                              ],
                            },
                          })
                        }
                      >
                        <option value="min">Минимум координаты</option>
                        <option value="max">Максимум координаты</option>
                      </select>
                    </label>
                    <label className="engineering-field">
                      Нагрузка · ось грани
                      <select
                        value={strength.loads[0].axis}
                        onChange={(e) =>
                          update({
                            ...engineering,
                            strength: {
                              ...strength,
                              loads: [
                                {
                                  ...strength.loads[0],
                                  axis: e.target.value as "x" | "y" | "z",
                                },
                              ],
                            },
                          })
                        }
                      >
                        {["x", "y", "z"].map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    </label>
                    <label className="engineering-field">
                      Нагрузка · грань
                      <select
                        value={strength.loads[0].side}
                        onChange={(e) =>
                          update({
                            ...engineering,
                            strength: {
                              ...strength,
                              loads: [
                                {
                                  ...strength.loads[0],
                                  side: e.target.value as "min" | "max",
                                },
                              ],
                            },
                          })
                        }
                      >
                        <option value="min">Минимум координаты</option>
                        <option value="max">Максимум координаты</option>
                      </select>
                    </label>
                    {["X", "Y", "Z"].map((x, i) => (
                      <N
                        key={x}
                        label={"Сила F" + x + ", Н"}
                        value={strength.loads[0].force_n[i]}
                        onChange={(n) =>
                          update({
                            ...engineering,
                            strength: {
                              ...strength,
                              loads: [
                                {
                                  ...strength.loads[0],
                                  force_n: strength.loads[0].force_n.map(
                                    (v, j) => (i === j ? n : v),
                                  ) as [number, number, number],
                                },
                              ],
                            },
                          })
                        }
                      />
                    ))}
                    <N
                      label="Размер элемента, мм"
                      value={strength.mesh_size_mm}
                      step={0.1}
                      min={0.2}
                      onChange={(n) =>
                        update({
                          ...engineering,
                          strength: { ...strength, mesh_size_mm: n },
                        })
                      }
                    />
                  </div>
                  <label className="engineering-checkbox">
                    <input
                      type="checkbox"
                      checked={strength.refine}
                      onChange={(e) =>
                        update({
                          ...engineering,
                          strength: { ...strength, refine: e.target.checked },
                        })
                      }
                    />
                    Повторить на сетке в 1,5 раза мельче и оценить сходимость
                  </label>
                  <p className="engineering-caption">
                    Оси и грани заданы в локальной системе детали. Сила
                    распределяется по площади выбранной плоской грани. Свойства
                    материала не определяются по его названию.
                  </p>
                </details>
              )}
              {strengthResult && strengthResult.status !== "not_configured" && (
                <div className="engineering-result">
                  <div
                    className={
                      "analysis-state " +
                      (strengthResult.status === "within_limits"
                        ? "good"
                        : "review")
                    }
                  >
                    {stateNames[strengthResult.status] || strengthResult.status}
                  </div>
                  {strengthResult.error ? (
                    <div className="notice error">{strengthResult.error}</div>
                  ) : (
                    <>
                      <div className="engineering-metrics">
                        <Metric
                          label="Макс. перемещение"
                          value={numeric(strengthResult.max_displacement_mm)}
                          unit="мм"
                        />
                        <Metric
                          label="Пик von Mises"
                          value={numeric(strengthResult.max_von_mises_mpa)}
                          unit="МПа"
                        />
                        <Metric
                          label="Запас до текучести"
                          value={numeric(strengthResult.safety_factor)}
                        />
                      </div>
                      <p className="engineering-caption">
                        {strengthResult.nodes} узлов · {strengthResult.elements}{" "}
                        тетраэдров · невязка{" "}
                        {numeric(strengthResult.relative_residual)} · баланс сил{" "}
                        {numeric(strengthResult.force_balance_error)}
                      </p>
                      {strengthResult.convergence && (
                        <p className="engineering-caption">
                          Уточнение: перемещение Δ
                          {numeric(
                            strengthResult.convergence.displacement_change *
                              100,
                          )}
                          %, пиковое напряжение Δ
                          {numeric(
                            strengthResult.convergence.peak_stress_change * 100,
                          )}
                          %.{" "}
                          {strengthResult.convergence.passed
                            ? "Критерий сходимости выполнен."
                            : "Требуется дальнейшее уточнение."}
                        </p>
                      )}
                      {fieldMesh && (
                        <>
                          <div className="analysis-viewport">
                            <Suspense fallback={<p>Загрузка…</p>}>
                              <Viewport
                                data={fieldMesh}
                                selected=""
                                onSelect={() => {}}
                                exploded={false}
                                wireframe={false}
                                view="iso"
                              />
                            </Suspense>
                            <div className="stress-legend">
                              <span>0</span>
                              <i />
                              <span>
                                {numeric(field?.max_von_mises_mpa)} МПа
                              </span>
                            </div>
                          </div>
                          <label className="engineering-field">
                            Масштаб отображения деформации
                            <select
                              value={deformation}
                              onChange={(e) =>
                                setDeformation(Number(e.target.value))
                              }
                            >
                              <option value={1}>
                                ×1 — реальное перемещение
                              </option>
                              <option value={10}>
                                ×10 — увеличено для просмотра
                              </option>
                              <option value={100}>
                                ×100 — увеличено для просмотра
                              </option>
                            </select>
                          </label>
                        </>
                      )}
                      <Notes values={strengthResult.warnings} />
                    </>
                  )}
                </div>
              )}
            </>
          )}
          {section === "motion" && (
            <>
              <div className="engineering-actions">
                <button
                  className="button"
                  onClick={addJoint}
                  disabled={components.length < 2}
                >
                  <Plus size={14} />
                  Добавить связь
                </button>
                <button className="button" onClick={() => onExample("slider")}>
                  Контрольный пример: столкновение
                </button>
                <button className="button" onClick={() => onExample("fourbar")}>
                  Четырёхзвенник
                </button>
              </div>
              <details
                className="engineering-conditions"
                open={!motionResult || motionResult.status === "not_configured"}
              >
                <summary>Связи сборки · {spec.joints.length}</summary>
                {spec.joints.map((joint, index) => (
                  <div className="joint-editor" key={index}>
                    <div className="joint-editor-heading">
                      <input
                        aria-label={"Имя связи " + (index + 1)}
                        value={joint.name}
                        onChange={(e) =>
                          jointChange(index, { name: e.target.value })
                        }
                      />
                      <button
                        title="Удалить связь"
                        className="icon-button"
                        onClick={() => {
                          const next = structuredClone(engineering);
                          if (next.motion)
                            next.motion.drivers = next.motion.drivers.filter(
                              (d) => d.joint_name !== joint.name,
                            );
                          onChange({
                            ...spec,
                            joints: spec.joints.filter((_, i) => i !== index),
                            engineering: next,
                          });
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="engineering-form-grid">
                      <label className="engineering-field">
                        Тип
                        <select
                          value={joint.type}
                          onChange={(e) =>
                            jointChange(index, {
                              type: e.target.value as
                                "fixed" | "revolute" | "prismatic",
                            })
                          }
                        >
                          <option value="revolute">Вращение</option>
                          <option value="prismatic">Поступательное</option>
                          <option value="fixed">Жёсткая связь</option>
                        </select>
                      </label>
                      {[0, 1].map((i) => (
                        <label className="engineering-field" key={i}>
                          {i ? "Дочерняя деталь" : "Родительская деталь"}
                          <select
                            value={joint.components[i]}
                            onChange={(e) =>
                              jointChange(index, {
                                components: joint.components.map((v, j) =>
                                  i === j ? e.target.value : v,
                                ) as [string, string],
                              })
                            }
                          >
                            {components.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                    {joint.type !== "fixed" && (
                      <>
                        <div className="engineering-form-grid">
                          {["X", "Y", "Z"].map((axis, i) => (
                            <N
                              key={axis}
                              label={"Ось · " + axis}
                              value={joint.axis?.[i] ?? (i === 2 ? 1 : 0)}
                              step={0.1}
                              onChange={(n) =>
                                jointChange(index, {
                                  axis: (joint.axis || [0, 0, 1]).map((v, j) =>
                                    i === j ? n : v,
                                  ) as [number, number, number],
                                })
                              }
                            />
                          ))}
                          {["X", "Y", "Z"].map((axis, i) => (
                            <N
                              key={axis}
                              label={"Центр · " + axis + ", мм"}
                              value={joint.origin?.[i] || 0}
                              onChange={(n) =>
                                jointChange(index, {
                                  origin: (joint.origin || [0, 0, 0]).map(
                                    (v, j) => (i === j ? n : v),
                                  ) as [number, number, number],
                                })
                              }
                            />
                          ))}
                        </div>
                        <div className="engineering-form-grid">
                          <N
                            label={
                              "Исходное положение, " +
                              (joint.type === "revolute" ? "°" : "мм")
                            }
                            value={joint.home || 0}
                            onChange={(n) => jointChange(index, { home: n })}
                          />
                          <N
                            label="Нижний предел"
                            value={joint.limits?.[0] ?? -180}
                            onChange={(n) =>
                              jointChange(index, {
                                limits: [n, joint.limits?.[1] ?? 180],
                              })
                            }
                          />
                          <N
                            label="Верхний предел"
                            value={joint.limits?.[1] ?? 180}
                            onChange={(n) =>
                              jointChange(index, {
                                limits: [joint.limits?.[0] ?? -180, n],
                              })
                            }
                          />
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </details>
              <p className="engineering-caption">
                Ось и центр связи задаются в исходной системе сборки. Для
                замкнутого механизма первая деталь — неподвижное основание.
                Настрой все связи и приводы.
              </p>
              {!motion ? (
                <button
                  className="button"
                  disabled={!spec.joints.some((j) => j.type !== "fixed")}
                  onClick={() => {
                    const joint = spec.joints.find((j) => j.type !== "fixed")!;
                    update({
                      ...engineering,
                      motion: {
                        drivers: [
                          {
                            joint_name: joint.name,
                            start: joint.home || 0,
                            end: joint.type === "revolute" ? 90 : 20,
                          },
                        ],
                        samples: 21,
                        clearance_mm: 0,
                      },
                    });
                  }}
                >
                  <Plus size={14} />
                  Задать траекторию
                </button>
              ) : (
                <>
                  <div className="engineering-form-grid">
                    <N
                      label="Число положений"
                      value={motion.samples}
                      min={2}
                      onChange={(n) =>
                        update({
                          ...engineering,
                          motion: { ...motion, samples: n },
                        })
                      }
                    />
                    <N
                      label="Минимальный зазор, мм"
                      value={motion.clearance_mm}
                      step={0.01}
                      min={0}
                      onChange={(n) =>
                        update({
                          ...engineering,
                          motion: { ...motion, clearance_mm: n },
                        })
                      }
                    />
                  </div>
                  {motion.drivers.map((driver, i) => (
                    <div className="driver-row" key={i}>
                      <label className="engineering-field">
                        Привод
                        <select
                          value={driver.joint_name}
                          onChange={(e) =>
                            update({
                              ...engineering,
                              motion: {
                                ...motion,
                                drivers: motion.drivers.map((d, j) =>
                                  i === j
                                    ? { ...d, joint_name: e.target.value }
                                    : d,
                                ),
                              },
                            })
                          }
                        >
                          {spec.joints
                            .filter((j) => j.type !== "fixed")
                            .map((j) => (
                              <option key={j.name}>{j.name}</option>
                            ))}
                        </select>
                      </label>
                      <N
                        label="От"
                        value={driver.start}
                        onChange={(n) =>
                          update({
                            ...engineering,
                            motion: {
                              ...motion,
                              drivers: motion.drivers.map((d, j) =>
                                i === j ? { ...d, start: n } : d,
                              ),
                            },
                          })
                        }
                      />
                      <N
                        label="До"
                        value={driver.end}
                        onChange={(n) =>
                          update({
                            ...engineering,
                            motion: {
                              ...motion,
                              drivers: motion.drivers.map((d, j) =>
                                i === j ? { ...d, end: n } : d,
                              ),
                            },
                          })
                        }
                      />
                      <button
                        className="icon-button"
                        title="Удалить привод"
                        onClick={() =>
                          update({
                            ...engineering,
                            motion: {
                              ...motion,
                              drivers: motion.drivers.filter((_, j) => i !== j),
                            },
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    className="button"
                    onClick={() => {
                      const j = spec.joints.find(
                        (j) =>
                          j.type !== "fixed" &&
                          !motion.drivers.some((d) => d.joint_name === j.name),
                      );
                      if (j)
                        update({
                          ...engineering,
                          motion: {
                            ...motion,
                            drivers: [
                              ...motion.drivers,
                              {
                                joint_name: j.name,
                                start: j.home || 0,
                                end: j.home || 0,
                              },
                            ],
                          },
                        });
                    }}
                  >
                    <Plus size={13} />
                    Ещё привод
                  </button>
                </>
              )}
              {motionResult && motionResult.status !== "not_configured" && (
                <div className="engineering-result">
                  <div
                    className={
                      "analysis-state " +
                      (motionResult.status === "sampled_clear"
                        ? "good"
                        : "review")
                    }
                  >
                    {stateNames[motionResult.status] || motionResult.status}
                  </div>
                  {motionResult.error && (
                    <div className="notice error">{motionResult.error}</div>
                  )}
                  {frames.length > 0 && mesh && (
                    <>
                      <div className="analysis-viewport">
                        <Suspense fallback={<p>Загрузка…</p>}>
                          <Viewport
                            data={mesh}
                            selected=""
                            onSelect={() => {}}
                            exploded={false}
                            wireframe={false}
                            view="iso"
                            pose={
                              frames[Math.min(frame, frames.length - 1)]
                                ?.transforms
                            }
                          />
                        </Suspense>
                        <span className="motion-frame">
                          Положение {frame + 1}/{frames.length}
                        </span>
                      </div>
                      <div className="motion-player">
                        <button
                          className="button"
                          onClick={() => setPlaying(!playing)}
                          aria-label={
                            playing
                              ? "Остановить движение"
                              : "Проиграть движение"
                          }
                        >
                          {playing ? <Square size={14} /> : <Play size={14} />}
                        </button>
                        <input
                          aria-label="Положение механизма"
                          type="range"
                          min={0}
                          max={frames.length - 1}
                          value={frame}
                          onChange={(e) => {
                            setPlaying(false);
                            setFrame(Number(e.target.value));
                          }}
                        />
                      </div>
                    </>
                  )}
                  <p className="engineering-caption">
                    {motionResult.sample_count} положений ·{" "}
                    {motionResult.tested_pairs} проверок пар
                  </p>
                  <p className="engineering-caption">{motionResult.solver}</p>
                  {!!motionResult.closure_checks?.length && (
                    <p className="engineering-caption">
                      Максимальная невязка замыкания:{" "}
                      {numeric(
                        Math.max(
                          ...motionResult.closure_checks.map(
                            (c) => c.constraint_residual_mm,
                          ),
                        ),
                      )}{" "}
                      мм.{" "}
                      {motionResult.closure_checks.every(
                        (c) => c.fully_constrained,
                      )
                        ? "Ранг системы полный."
                        : "Есть сингулярные или неопределённые положения."}
                    </p>
                  )}
                  {motionResult.steps?.map((s) => (
                    <p className="engineering-caption" key={s.joint_name}>
                      {s.joint_name}: шаг {numeric(s.step)} {s.unit}
                    </p>
                  ))}
                  {motionResult.collisions?.slice(0, 20).map((c, i) => (
                    <button
                      className="collision-row"
                      key={i}
                      onClick={() => {
                        setFrame(c.frame);
                        setPlaying(false);
                      }}
                    >
                      <TriangleAlert size={13} />
                      <span>
                        Положение {c.frame + 1}: {c.components.join(" / ")}
                      </span>
                      <small>
                        {c.penetration_mm3 > 0
                          ? numeric(c.penetration_mm3) + " мм³ пересечения"
                          : numeric(c.clearance_mm) + " мм зазора"}
                      </small>
                    </button>
                  ))}
                  <Notes values={motionResult.warnings} />
                </div>
              )}
            </>
          )}
          {section === "drawings" && (
            <>
              <div className="engineering-form-grid">
                <N
                  label="Общий линейный допуск ±, мм"
                  value={engineering.manufacturing.general_tolerance_mm || 0}
                  min={0}
                  step={0.01}
                  onChange={(n) =>
                    update({
                      ...engineering,
                      manufacturing: {
                        ...engineering.manufacturing,
                        general_tolerance_mm: n > 0 ? n : null,
                      },
                    })
                  }
                />
                <N
                  label="Шероховатость Ra, мкм · 0 = не задана"
                  value={engineering.manufacturing.surface_roughness_ra_um || 0}
                  min={0}
                  step={0.1}
                  onChange={(n) =>
                    update({
                      ...engineering,
                      manufacturing: {
                        ...engineering.manufacturing,
                        surface_roughness_ra_um: n > 0 ? n : null,
                      },
                    })
                  }
                />
              </div>
              <p className="engineering-caption">
                Общий допуск применяется к размерам без индивидуального допуска.
                Геометрия должна попадать в заданный диапазон. Достижимость
                допуска принтером или станком проверяется отдельно.
              </p>
              <div className="engineering-actions">
                <button
                  className="button"
                  onClick={() =>
                    update({
                      ...engineering,
                      manufacturing: {
                        ...engineering.manufacturing,
                        dimensions: [
                          ...engineering.manufacturing.dimensions,
                          {
                            component_id: components[0].id,
                            feature: "bbox_x",
                            operation_id: null,
                            nominal_mm: 0,
                            lower_deviation_mm: -0.1,
                            upper_deviation_mm: 0.1,
                          },
                        ],
                      },
                    })
                  }
                >
                  <Plus size={14} />
                  Индивидуальный допуск
                </button>
              </div>
              {engineering.manufacturing.dimensions.map((d, i) => {
                const change = (patch: Partial<typeof d>) =>
                  update({
                    ...engineering,
                    manufacturing: {
                      ...engineering.manufacturing,
                      dimensions: engineering.manufacturing.dimensions.map(
                        (v, j) => (i === j ? { ...v, ...patch } : v),
                      ),
                    },
                  });
                return (
                  <div className="tolerance-editor" key={i}>
                    <div className="engineering-form-grid">
                      <label className="engineering-field">
                        Деталь
                        <select
                          value={d.component_id}
                          onChange={(e) =>
                            change({ component_id: e.target.value })
                          }
                        >
                          {components.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="engineering-field">
                        Размер
                        <select
                          value={d.feature}
                          onChange={(e) =>
                            change({
                              feature: e.target.value as typeof d.feature,
                              operation_id: e.target.value.startsWith("bbox")
                                ? null
                                : d.operation_id,
                            })
                          }
                        >
                          {[
                            ["bbox_x", "Габарит X"],
                            ["bbox_y", "Габарит Y"],
                            ["bbox_z", "Габарит Z"],
                            ["diameter", "Диаметр"],
                            ["location_x", "Координата оси X"],
                            ["location_y", "Координата оси Y"],
                            ["location_z", "Координата оси Z"],
                          ].map(([v, t]) => (
                            <option value={v} key={v}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </label>
                      {!d.feature.startsWith("bbox") && (
                        <label className="engineering-field">
                          Цилиндрическая операция
                          <select
                            value={d.operation_id || ""}
                            onChange={(e) =>
                              change({ operation_id: e.target.value })
                            }
                          >
                            <option value="">Выбери операцию</option>
                            {(
                              spec.components.find(
                                (c) => c.id === d.component_id,
                              )?.operations || spec.operations
                            )
                              .filter((o) => o.type === "cylinder")
                              .map((o) => (
                                <option key={o.id}>{o.id}</option>
                              ))}
                          </select>
                        </label>
                      )}
                      <N
                        label="Номинал, мм"
                        value={d.nominal_mm}
                        step={0.01}
                        onChange={(n) => change({ nominal_mm: n })}
                      />
                      <N
                        label="Нижнее отклонение, мм"
                        value={d.lower_deviation_mm}
                        step={0.01}
                        onChange={(n) => change({ lower_deviation_mm: n })}
                      />
                      <N
                        label="Верхнее отклонение, мм"
                        value={d.upper_deviation_mm}
                        step={0.01}
                        onChange={(n) => change({ upper_deviation_mm: n })}
                      />
                    </div>
                    <button
                      className="text-button"
                      onClick={() =>
                        update({
                          ...engineering,
                          manufacturing: {
                            ...engineering.manufacturing,
                            dimensions:
                              engineering.manufacturing.dimensions.filter(
                                (_, j) => i !== j,
                              ),
                          },
                        })
                      }
                    >
                      Удалить допуск
                    </button>
                  </div>
                );
              })}
              <label className="engineering-field wide">
                Технические указания · по строке на указание
                <textarea
                  value={engineering.manufacturing.notes.join("\n")}
                  onChange={(e) =>
                    update({
                      ...engineering,
                      manufacturing: {
                        ...engineering.manufacturing,
                        notes: e.target.value.split("\n").slice(0, 15),
                      },
                    })
                  }
                />
              </label>
              {drawings && (
                <div className="engineering-result">
                  <div
                    className={
                      "analysis-state " +
                      (drawings.status === "dimensioned_draft"
                        ? "good"
                        : "review")
                    }
                  >
                    {stateNames[drawings.status] || "Чертежи требуют проверки"}
                  </div>
                  {drawings.parts?.map((p) => (
                    <div className="drawing-part" key={p.id}>
                      <strong>{p.name}</strong>
                      <span>
                        {p.status === "dimensioned_draft"
                          ? "Допуски заданы"
                          : p.status === "dimension_mismatch"
                            ? "Несоответствие размера"
                            : "Не заданы все допуски"}
                      </span>
                    </div>
                  ))}
                  <div className="engineering-actions">
                    <a
                      className={
                        "button primary " + (!revision ? "disabled" : "")
                      }
                      href={link("drawings.pdf")}
                    >
                      <FileText size={14} />
                      Все листы PDF
                    </a>
                    <a
                      className={"button " + (!revision ? "disabled" : "")}
                      href={link("drawings.zip")}
                    >
                      <Download size={14} />
                      PDF / DXF по деталям
                    </a>
                  </div>
                  <Notes values={drawings.warnings} />
                </div>
              )}
            </>
          )}
          <div className="engineering-run">
            <button
              className="button primary"
              onClick={run}
              disabled={busy || !configured}
            >
              <RotateCcw size={14} />
              {busy
                ? "Задача выполняется…"
                : section === "strength"
                  ? "Рассчитать и сохранить версию"
                  : section === "motion"
                    ? "Проверить движение и сохранить"
                    : "Сформировать чертежи"}
            </button>
            <small>
              Все заданные проверки выполняются на CAD-узле. Исходные версии
              сохраняются.
            </small>
          </div>
        </fieldset>
      </div>
    </div>
  );
}
