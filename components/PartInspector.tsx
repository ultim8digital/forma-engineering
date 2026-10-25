import { useEffect, useRef, useState } from "react";
import { ChevronDown, Copy, Plus, Trash2, ArrowUpRight, RotateCcw } from "lucide-react";
import type { Operation, Part, XYZ } from "@/lib/editor";

export function NumberField({ label, value, onCommit, min = -2000, max = 2000, step = 0.1, unit = "" }: {
  label: string; value: number; onCommit: (value: number) => void; min?: number; max?: number; step?: number; unit?: string;
}) {
  const [text, setText] = useState(String(Number(value.toFixed(4))));
  const ignoreBlur = useRef(false);
  const drag = useRef<{ x: number; value: number; next: number; moved: boolean } | null>(null);
  useEffect(() => setText(String(Number(value.toFixed(4)))), [value]);
  const normalize = (n: number) => Math.min(max, Math.max(min, Math.round(n * 10000) / 10000));
  const commit = () => {
    const n = Number(text.replace(",", "."));
    if (text.trim() && Number.isFinite(n)) { const v = normalize(n); setText(String(v)); if (v !== value) onCommit(v); }
    else setText(String(value));
  };
  return <label className="number-field">
    <span title="Потяни влево или вправо, чтобы изменить значение" onPointerDown={e => {
      if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, value, next: value, moved: false };
    }} onPointerMove={e => {
      if (!drag.current) return; const d = drag.current;
      d.next = normalize(d.value + (e.clientX - d.x) * step * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1));
      d.moved = Math.abs(e.clientX - d.x) > 2; setText(String(d.next));
    }} onPointerUp={() => { if (drag.current?.moved) onCommit(drag.current.next); drag.current = null; }}
    onPointerCancel={() => { drag.current = null; setText(String(value)); }}>{label.split(" ").at(-1)}</span>
    <input aria-label={label} type="text" inputMode="decimal" value={text} onChange={e => setText(e.target.value)} onBlur={() => { if (ignoreBlur.current) { ignoreBlur.current = false; return; } commit(); }}
      onKeyDown={e => {
        if (e.key === "Enter") { commit(); e.currentTarget.blur(); }
        if (e.key === "Escape") { ignoreBlur.current = true; setText(String(value)); e.currentTarget.blur(); }
        if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); const n = normalize(value + step * (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1)); setText(String(n)); onCommit(n); }
      }} />{unit && <small>{unit}</small>}
  </label>;
}
function VectorField({ label, value, onChange, unit = "mm" }: { label: string; value: XYZ; onChange: (v: XYZ) => void; unit?: string }) {
  return <div className="vector-field"><div className="property-label">{label}<small>{unit}</small></div><div className="vector-inputs">
    {value.map((n, i) => <NumberField key={i} label={`${label} ${["X", "Y", "Z"][i]}`} value={n} onCommit={v => onChange(value.map((x, j) => i === j ? v : x) as XYZ)} />)}
  </div></div>;
}
const selectors = ["all", "|X", "|Y", "|Z", ">Z", "<Z"];
export default function PartInspector({ part, onChange, onDuplicate, onDelete, locked, onJson, color, onColor }: {
  part: Part | undefined; onChange: (part: Part) => void; onDuplicate: () => void; onDelete: () => void;
  locked: boolean; onJson: () => void; color: string; onColor: (color: string) => void;
}) {
  const [tab, setTab] = useState("part"), [openOp, setOpenOp] = useState(0);
  useEffect(() => setOpenOp(0), [part?.id]);
  if (!part) return <div className="inspector-empty">Добавь деталь или выбери её в сцене.</div>;
  const patch = (value: Partial<Part>) => onChange({ ...part, ...value });
  const editOp = (i: number, value: Record<string, unknown>) => patch({ operations: part.operations.map((op, k) => i === k ? { ...op, ...value } as Operation : op) });
  const addOp = (type: string) => {
    const id = (type === "hole" ? "Отверстие" : type === "fillet" ? "Скругление" : "Фаска") + "_" + crypto.randomUUID().slice(0, 4);
    const op: Operation = type === "hole" ? { id, type: "cylinder", mode: "cut", radius: 3, height: 50, at: [0, 0, -1], axis: "z" }
      : type === "fillet" ? { id, type: "fillet", radius: 1, selector: "all" } : { id, type: "chamfer", length: 1, selector: "all" };
    patch({ operations: [...part.operations, op] }); setOpenOp(part.operations.length); setTab("operations");
  };
  return <>
    <div className="inspector-heading"><div><span className="eyebrow">ВЫБРАННАЯ ДЕТАЛЬ</span><h2>{part.name.replace(/^\d+\s*·\s*/, "")}</h2></div>
      <button className="icon-button" title="Дублировать деталь" onClick={onDuplicate} disabled={locked}><Copy size={16} /></button></div>
    <div className="segmented"><button className={tab === "part" ? "selected" : ""} onClick={() => setTab("part")}>Свойства</button><button className={tab === "operations" ? "selected" : ""} onClick={() => setTab("operations")}>Операции <small>{part.operations.length}</small></button></div>
    <fieldset disabled={locked} className="inspector-fields">
    {tab === "part" ? <>
      <label className="text-property">Название<input aria-label="Название детали" key={part.id + part.name} defaultValue={part.name} maxLength={120} onBlur={e => { const name = e.target.value.trim(); if (name && name !== part.name) patch({ name }); }} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} /></label>
      {part.operations[0]?.type === "box" && (() => { const op = part.operations[0]; return <div className="property-section quick-dimensions"><div className="property-label">Размеры основания<small>{op.id}</small></div><div className="vector-inputs">{op.size.map((n, j) => <NumberField key={j} label={`${op.id} ${["X", "Y", "Z"][j]}`} min={0.01} value={n} onCommit={value => editOp(0, { size: op.size.map((x, k) => j === k ? value : x) })} />)}</div></div>; })()}
      {part.operations[0]?.type === "cylinder" && (() => { const op = part.operations[0]; return <div className="property-section"><div className="property-label">Размеры цилиндра<small>mm</small></div><div className="two-fields"><NumberField label={`${op.id} диаметр`} value={op.radius * 2} min={0.02} max={4000} unit="mm" onCommit={value => editOp(0, { radius: value / 2 })} /><NumberField label={`${op.id} высота`} value={op.height} min={0.01} unit="mm" onCommit={height => editOp(0, { height })} /></div></div>; })()}
      <div className="property-section"><VectorField label="Положение" value={part.at} onChange={at => patch({ at })} /><VectorField label="Поворот" value={part.rotation} unit="°" onChange={rotation => patch({ rotation })} />
        <button className="text-button reset-transform" onClick={() => patch({ at: [0, 0, 0], rotation: [0, 0, 0] })}><RotateCcw size={12} />Сбросить преобразование</button></div>
      <div className="property-section"><label className="text-property">Материал<input aria-label="Материал детали" key={part.id + part.material} defaultValue={part.material} maxLength={160} onBlur={e => { if (e.target.value !== part.material) patch({ material: e.target.value }); }} /></label>
        <label className="text-property">Изготовление<input aria-label="Способ изготовления" list="process-options" key={part.id + part.process} defaultValue={part.process} maxLength={160} onBlur={e => { if (e.target.value !== part.process) patch({ process: e.target.value }); }} /><datalist id="process-options">{["FDM-печать", "SLA-печать", "ЧПУ-фрезеровка", "Токарная обработка", "Лазерная резка"].map(v => <option value={v} key={v} />)}</datalist></label></div>
      <div className="property-section"><div className="property-label">Цвет в студии<small>только вид</small></div><div className="color-swatches">{["#b3bcc2", "#60727e", "#bca881", "#e2dfd3", "#637768", "#393e42"].map(c => <button key={c} title={`Цвет ${c}`} aria-label={`Цвет ${c}`} className={color === c ? "selected" : ""} style={{ background: c }} onClick={() => onColor(c)} />)}<label className="custom-color" title="Другой цвет"><Plus size={13} /><input type="color" aria-label="Другой цвет детали" value={color} onChange={e => onColor(e.target.value)} /></label></div></div>
      <p className="micro-copy">Тяни подписи X/Y/Z или вводи значения. Геометрию и файлы обновит кнопка «Построить CAD».</p>
    </> : <>
      <div className="operation-stack">{part.operations.map((op, i) => <section className={"operation-card " + (openOp === i ? "open" : "")} key={op.id}>
        <button className="operation-title" onClick={() => setOpenOp(openOp === i ? -1 : i)}><span className={"operation-symbol " + ("mode" in op && op.mode === "cut" ? "cut" : "")}>{op.type === "cylinder" ? "◉" : op.type === "fillet" ? "⌒" : op.type === "chamfer" ? "◿" : "▱"}</span><span>{op.id}<small>{op.type === "box" ? "Параллелепипед" : op.type === "cylinder" ? "Цилиндр" : op.type === "fillet" ? "Скругление" : op.type === "chamfer" ? "Фаска" : "Выдавливание"}{"mode" in op && op.mode === "cut" ? " · вычитание" : ""}</small></span><ChevronDown size={13} /></button>
        {openOp === i && <div className="operation-properties">
          {"mode" in op && <label className="text-property">Операция<select aria-label={`${op.id} операция`} value={op.mode} onChange={e => editOp(i, { mode: e.target.value })}><option value="add">Добавить материал</option><option value="cut">Вычесть материал</option></select></label>}
          {op.type === "box" && <div className="vector-field"><div className="property-label">Размеры<small>mm</small></div><div className="vector-inputs">{op.size.map((n, j) => <NumberField key={j} label={`${op.id} ${["X", "Y", "Z"][j]}`} min={0.01} value={n} onCommit={value => editOp(i, { size: op.size.map((x, k) => k === j ? value : x) })} />)}</div></div>}
          {op.type === "cylinder" && <><div className="two-fields"><NumberField label={`${op.id} диаметр`} value={op.radius * 2} min={0.02} max={4000} unit="mm" onCommit={d => editOp(i, { radius: d / 2 })} /><NumberField label={`${op.id} высота`} value={op.height} min={0.01} unit="mm" onCommit={height => editOp(i, { height })} /></div><label className="text-property">Ось<select aria-label={`${op.id} ось`} value={op.axis} onChange={e => editOp(i, { axis: e.target.value })}>{["x", "y", "z"].map(v => <option key={v}>{v}</option>)}</select></label></>}
          {op.type === "fillet" && <NumberField label={`${op.id} радиус`} value={op.radius} min={0.01} unit="mm" onCommit={radius => editOp(i, { radius })} />}
          {op.type === "chamfer" && <NumberField label={`${op.id} длина`} value={op.length} min={0.01} unit="mm" onCommit={length => editOp(i, { length })} />}
          {"selector" in op && <label className="text-property">Рёбра<select aria-label={`${op.id} рёбра`} value={op.selector} onChange={e => editOp(i, { selector: e.target.value })}>{selectors.map(v => <option key={v} value={v}>{v === "all" ? "Все рёбра" : v}</option>)}</select></label>}
          {op.type === "extrude" && <><NumberField label={`${op.id} глубина`} value={op.distance} min={0.01} unit="mm" onCommit={distance => editOp(i, { distance })} /><label className="text-property">Плоскость<select aria-label={`${op.id} плоскость`} value={op.plane} onChange={e => editOp(i, { plane: e.target.value })}>{["XY", "XZ", "YZ"].map(v => <option key={v}>{v}</option>)}</select></label>
            <details className="polygon-points"><summary>Контур · {op.points.length} точек</summary>{op.points.map((point, k) => <div className="point-row" key={k}>{point.map((v, axis) => <NumberField key={axis} label={`Точка ${k + 1} ${axis === 0 ? "U" : "V"}`} value={v} onCommit={value => editOp(i, { points: op.points.map((p, n) => n === k ? p.map((x, a) => a === axis ? value : x) : p) })} />)}<button className="icon-button" title={`Удалить точку ${k + 1}`} disabled={op.points.length <= 3} onClick={() => editOp(i, { points: op.points.filter((_, n) => n !== k) })}><Trash2 size={11} /></button></div>)}<button className="text-button" disabled={op.points.length >= 100} onClick={() => editOp(i, { points: [...op.points, [op.points.at(-1)![0] + 5, op.points.at(-1)![1] + 5]] })}>+ Точка</button></details></>}
          {"at" in op && <VectorField label={`${op.id} · начало`} value={op.at} onChange={at => editOp(i, { at })} />}
          <button className="text-button danger" disabled={part.operations.length <= 1} onClick={() => patch({ operations: part.operations.filter((_, k) => k !== i) })}><Trash2 size={12} />Удалить операцию</button>
        </div>}
      </section>)}</div>
      <div className="add-operation"><span>Добавить операцию</span><div><button onClick={() => addOp("hole")} disabled={part.operations.length >= 60}>+ Отверстие</button><button onClick={() => addOp("fillet")} disabled={part.operations.length >= 60}>+ Скругление</button><button onClick={() => addOp("chamfer")} disabled={part.operations.length >= 60}>+ Фаска</button></div></div>
    </>}
    <div className="inspector-secondary"><button className="text-button" onClick={onJson}>Спецификация JSON<ArrowUpRight size={12} /></button><button className="icon-button danger" title="Удалить деталь" onClick={onDelete}><Trash2 size={14} /></button></div>
    </fieldset>
  </>;
}
