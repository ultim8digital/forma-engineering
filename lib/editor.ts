import type { PartSpec } from "./contracts";

export type XYZ = [number, number, number];
export type Placement = { at: XYZ; rotation: XYZ };
export type Part = PartSpec["components"][number];
export type Operation = Part["operations"][number];
export type EditHistory = { past: PartSpec[]; present: PartSpec; future: PartSpec[] };

export function editableSpec(value: PartSpec): PartSpec {
  const spec = structuredClone(value);
  if (spec.operations.length) {
    spec.components.unshift({ id: "body", name: spec.name, material: spec.material, process: spec.process,
      operations: spec.operations, at: [0, 0, 0], rotation: [0, 0, 0], quantity: 1 });
    spec.operations = [];
  }
  return spec;
}
export function placements(spec: PartSpec): Record<string, Placement> {
  return Object.fromEntries(spec.components.map(p => [p.id, { at: p.at, rotation: p.rotation }]));
}
export function commitEdit(history: EditHistory, value: PartSpec): EditHistory {
  if (JSON.stringify(history.present) === JSON.stringify(value)) return history;
  return { past: [...history.past, history.present].slice(-60), present: value, future: [] };
}
export function undoEdit(h: EditHistory): EditHistory {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}
export function redoEdit(h: EditHistory): EditHistory {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}
export function addPrimitive(spec: PartSpec, type: "box" | "cylinder"): PartSpec {
  const next = structuredClone(spec), id = "part_" + crypto.randomUUID().slice(0, 8);
  const operation: Operation = type === "box"
    ? { type: "box", id: "Основание", mode: "add", size: [40, 30, 12], at: [-20, -15, 0] }
    : { type: "cylinder", id: "Основание", mode: "add", radius: 15, height: 25, axis: "z", at: [0, 0, 0] };
  next.components.push({ id, name: type === "box" ? "Новая пластина" : "Новый цилиндр", material: "PETG", process: "FDM-печать",
    quantity: 1, at: [next.components.length * 60, 0, 0], rotation: [0, 0, 0], operations: [operation] });
  next.requirements.expected_solids = next.components.length;
  return next;
}
