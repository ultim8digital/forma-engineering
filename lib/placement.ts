import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { Placement, XYZ, Part } from "./editor";
export function placementMatrix(p: Placement): Matrix4 {
  return new Matrix4().compose(new Vector3(...p.at),
    new Quaternion().setFromEuler(new Euler(...p.rotation.map(v => v * Math.PI / 180) as XYZ, "ZYX")), new Vector3(1, 1, 1));
}
/** Mesh vertices already include the last built CAD placement. Apply a world-space delta. */
export function placementDelta(base: Placement, next: Placement): Matrix4 {
  return placementMatrix(next).multiply(placementMatrix(base).invert());
}

/** Exact visual preview for a single box. CSG and edge changes wait for CAD rebuilding. */
export function partPreviewMatrix(base: Part, next: Part): Matrix4 {
  const original = base.operations[0], edited = next.operations[0];
  if (base.operations.length === 1 && next.operations.length === 1 && original.type === "box" && edited.type === "box" && original.mode === "add" && edited.mode === "add") {
    return placementMatrix(next)
      .multiply(new Matrix4().makeTranslation(...edited.at))
      .multiply(new Matrix4().makeScale(...edited.size.map((v, i) => v / original.size[i]) as XYZ))
      .multiply(new Matrix4().makeTranslation(...original.at.map(v => -v) as XYZ))
      .multiply(placementMatrix(base).invert());
  }
  return placementDelta(base, next);
}
