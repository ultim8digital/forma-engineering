import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Vector3 } from "three";
import { editableSpec, addPrimitive, commitEdit, undoEdit, redoEdit } from "../lib/editor.ts";
import { placementDelta, partPreviewMatrix } from "../lib/placement.ts";
const sample = JSON.parse(readFileSync(new URL("../public/example-spec.json", import.meta.url), "utf8"));
const close = (actual, expected) => actual.forEach((n, i) => assert.ok(Math.abs(n - expected[i]) < 1e-9, `${actual} != ${expected}`));

test("CAD world-space vertices use the same XYZ extrinsic placement as the kernel", () => {
  const base = { at: [10, 0, 0], rotation: [0, 0, 90] };
  const next = { at: [20, 3, 0], rotation: [0, 0, 180] };
  close(new Vector3(10, 2, 0).applyMatrix4(placementDelta(base, next)).toArray(), [18, 3, 0]);
});
test("single-box preview changes dimensions about its local origin before placement", () => {
  const base = { ...sample.components[0], at: [10, 0, 0], rotation: [0, 0, 90], operations: [{ type: "box", id: "base", mode: "add", at: [-20, -15, 0], size: [40, 30, 12] }] };
  const next = structuredClone(base); next.at = [25, 0, 10]; next.operations[0].size = [50, 35, 8];
  close(new Vector3(-5, 20, 12).applyMatrix4(partPreviewMatrix(base, next)).toArray(), [5, 30, 18]);
});
test("CSG changes are not represented by a false whole-part scale", () => {
  const base = sample.components[0], next = structuredClone(base); next.operations[0].size[0] += 20;
  close(new Vector3(4, 8, 12).applyMatrix4(partPreviewMatrix(base, next)).toArray(), [4, 8, 12]);
});
test("root solid editing keeps its geometry and identity", () => {
  const root = { ...structuredClone(sample), components: [], operations: sample.components[0].operations, joints: [] };
  const result = editableSpec(root);
  assert.equal(result.components[0].id, "body"); assert.deepEqual(result.components[0].operations, root.operations);
  assert.equal(result.operations.length, 0); assert.equal(root.operations.length, 6);
});
test("undo, redo and a replacement branch preserve independent document snapshots", () => {
  const a = editableSpec(sample), b = structuredClone(a), c = structuredClone(a);
  b.components[0].at[0] = 15; c.components[0].at[0] = -7;
  let h = { past: [], present: a, future: [] };
  h = commitEdit(h, b); assert.equal(h.present.components[0].at[0], 15);
  h = undoEdit(h); assert.equal(h.present.components[0].at[0], 0);
  h = redoEdit(h); assert.equal(h.present.components[0].at[0], 15);
  h = commitEdit(undoEdit(h), c); assert.equal(h.future.length, 0); assert.equal(h.present.components[0].at[0], -7);
  assert.equal(a.components[0].at[0], 0);
});
test("adding a primitive keeps the original dimensional requirements and input immutable", () => {
  const base = editableSpec(sample), next = addPrimitive(base, "box");
  assert.equal(next.components.length, base.components.length + 1);
  assert.equal(base.components.length, 3); assert.equal(next.requirements.expected_solids, 4);
  assert.deepEqual(next.requirements.bounds, base.requirements.bounds);
  assert.notEqual(next.components.at(-1).id, next.components[0].id);
});
