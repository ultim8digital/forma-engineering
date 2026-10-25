import { useEffect, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { Placement, XYZ, Part } from "@/lib/editor";
import { placementDelta, partPreviewMatrix } from "@/lib/placement";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";

export type MeshData = {
  vertices: number[][]; triangles: number[][];
  groups: { id: string; name: string; start: number; count: number; center: number[] }[];
  bounds: number[]; scalars?: number[]; scalarMax?: number;
};
export type ViewportHandle = { fit: (selectedOnly?: boolean) => void; zoom: (direction: number) => void };
export type ViewTool = "select" | "translate" | "rotate" | "measure";
type Props = {
  data: MeshData | null; selected: string; onSelect: (id: string) => void;
  exploded: boolean; wireframe: boolean; view: string; pose?: Record<string, number[]>;
  tool?: ViewTool; basePlacements?: Record<string, Placement>; placements?: Record<string, Placement>;
  onTransform?: (id: string, placement: Placement) => void;
  hidden?: string[]; isolated?: string | null; ghost?: boolean; grid?: boolean;
  colors?: Record<string, string>; clipAxis?: "x" | "y" | "z" | null; clipPosition?: number;
  baseParts?: Part[]; parts?: Part[];
  snap?: boolean; apiRef?: RefObject<ViewportHandle | null>;
};
const IDENTITY: Placement = { at: [0, 0, 0], rotation: [0, 0, 0] };
const palette = [0xb3bcc2, 0x64737b, 0xbca881, 0x889990, 0xddd9cf];

export default function Viewport(props: Props) {
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef(props); latest.current = props;
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orbitRef = useRef<OrbitControls | null>(null);
  const frameView = useRef<((selectedOnly?: boolean, direction?: THREE.Vector3) => void) | null>(null);
  const [measurement, setMeasurement] = useState<number | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const clearMeasure = useRef<(() => void) | null>(null);

  useEffect(() => {
    const el = root.current, data = props.data;
    if (!el || !data) return;
    setMeasurement(null); setUnavailable(false);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 100000);
    camera.up.set(0, 0, 1); cameraRef.current = camera;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { setUnavailable(true); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0xffffff, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.92;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.localClippingEnabled = true;
    renderer.domElement.setAttribute("aria-label", "3D-холст: выбор детали, вращение и манипуляторы");
    el.appendChild(renderer.domElement);
    const pmrem = new THREE.PMREMGenerator(renderer), environment = new RoomEnvironment();
    const envMap = pmrem.fromScene(environment, 0.04);
    scene.environment = envMap.texture; scene.environmentIntensity = 0.95;
    environment.dispose(); pmrem.dispose();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9199a0, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0002;
    scene.add(sun); scene.add(sun.target);
    const fill = new THREE.DirectionalLight(0xd6dfe5, 0.8); scene.add(fill);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true; orbit.dampingFactor = 0.12; orbit.screenSpacePanning = true;
    orbitRef.current = orbit;
    const meshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = [];
    const plane = new THREE.Plane();
    for (const [i, group] of data.groups.entries()) {
      const positions: number[] = [], colors: number[] = [];
      for (const t of data.triangles.slice(group.start, group.start + group.count)) for (const idx of t) {
        positions.push(...data.vertices[idx]);
        if (data.scalars) {
          const c = new THREE.Color().setHSL(0.67 * (1 - Math.min(1, data.scalars[idx] / Math.max(data.scalarMax || 1, 1e-10))), 0.82, 0.5);
          colors.push(c.r, c.g, c.b);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)); toCreasedNormals(geo, Math.PI / 5);
      if (colors.length) geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      const mat = new THREE.MeshStandardMaterial({ color: data.scalars ? 0xffffff : palette[i % palette.length],
        vertexColors: !!data.scalars, roughness: 0.27, metalness: 0.45, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, clipShadows: true });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData = { id: group.id, index: i }; mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 28), new THREE.LineBasicMaterial({ color: 0x343b3f, transparent: true, opacity: 0.26 }));
      mesh.add(edges); scene.add(mesh); meshes.push(mesh);
    }
    const initialBox = new THREE.Box3(); meshes.forEach(m => initialBox.expandByObject(m));
    const center = initialBox.getCenter(new THREE.Vector3());
    const extent = Math.max(initialBox.getSize(new THREE.Vector3()).length(), 10);
    sun.position.copy(center).add(new THREE.Vector3(0.7, -0.8, 1.8).multiplyScalar(extent)); sun.target.position.copy(center);
    fill.position.copy(center).add(new THREE.Vector3(-1, 0.5, 0.6).multiplyScalar(extent));
    Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 0.1, far: extent * 6 });
    sun.shadow.camera.updateProjectionMatrix(); sun.shadow.normalBias = extent * 0.001;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(extent * 20, extent * 20), new THREE.ShadowMaterial({ opacity: 0.19, depthWrite: false }));
    ground.position.set(center.x, center.y, initialBox.min.z - 0.05); ground.receiveShadow = true; scene.add(ground);
    const step = extent < 80 ? 5 : extent < 400 ? 10 : 50;
    const grid = new THREE.GridHelper(step * 100, 100, 0xc5c9c7, 0xd6d9d7);
    grid.rotation.x = Math.PI / 2; grid.position.z = initialBox.min.z - 0.02;
    (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.42; scene.add(grid);
    const anchor = new THREE.Object3D(); anchor.rotation.order = "ZYX"; scene.add(anchor);
    const transform = new TransformControls(camera, renderer.domElement); transform.setSize(0.82); transform.setSpace("world");
    const transformHelper = transform.getHelper(); scene.add(transformHelper);
    let dragging = false, hovered = "", down = [0, 0], frame = 0;
    let anchorId = ""; let ignoreClick = false;
    transform.addEventListener("dragging-changed", event => {
      dragging = !!event.value; orbit.enabled = !dragging;
      if (dragging) { ignoreClick = true; clearPoints(); }
      else if (anchorId) {
        const placement: Placement = { at: anchor.position.toArray().map(v => Math.round(v * 1e6) / 1e6) as XYZ,
          rotation: [anchor.rotation.x, anchor.rotation.y, anchor.rotation.z].map(v => Math.round(v * 180 / Math.PI * 1e6) / 1e6) as XYZ };
        const prior = latest.current.placements?.[anchorId];
        if (!prior || [...placement.at, ...placement.rotation].some((v, i) => Math.abs(v - [...prior.at, ...prior.rotation][i]) > 1e-6)) latest.current.onTransform?.(anchorId, placement);
      }
    });
    const measureGroup = new THREE.Group(); scene.add(measureGroup);
    let points: THREE.Vector3[] = [];
    function clearPoints() {
      for (const object of [...measureGroup.children]) {
        measureGroup.remove(object);
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) { object.geometry.dispose(); object.material.dispose(); }
      }
      points = []; setMeasurement(null);
    }
    clearMeasure.current = clearPoints;
    function setPoint(point: THREE.Vector3) {
      if (points.length === 2) clearPoints();
      points.push(point.clone());
      const dot = new THREE.Mesh(new THREE.SphereGeometry(extent * 0.006, 12, 10), new THREE.MeshBasicMaterial({ color: 0xd5c747, depthTest: false }));
      dot.position.copy(point); dot.renderOrder = 10; measureGroup.add(dot);
      if (points.length === 2) {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0x414731, depthTest: false }));
        line.renderOrder = 10; measureGroup.add(line); setMeasurement(points[0].distanceTo(points[1]));
      }
    }
    function updateMeshes() {
      const p = latest.current;
      const axis = p.clipAxis;
      if (axis) {
        const index = axis === "x" ? 0 : axis === "y" ? 1 : 2;
        const lo = initialBox.min.getComponent(index), hi = initialBox.max.getComponent(index);
        plane.normal.set(0, 0, 0).setComponent(index, -1); plane.constant = lo + (hi - lo) * ((p.clipPosition ?? 50) / 100);
      }
      for (const m of meshes) {
        const id = m.userData.id, i = m.userData.index;
        m.visible = (!p.parts || p.parts.some(part => part.id === id)) && !(p.hidden || []).includes(id) && (!p.isolated || p.isolated === id);
        const next = p.placements?.[id] || IDENTITY;
        const base = p.basePlacements?.[id] || IDENTITY;
        const basePart = p.baseParts?.find(part => part.id === id), nextPart = p.parts?.find(part => part.id === id);
        m.matrix.copy(basePart && nextPart ? partPreviewMatrix(basePart, nextPart) : placementDelta(base, next));
        if (dragging && id === anchorId) {
          const dragged = { at: anchor.position.toArray() as XYZ, rotation: [anchor.rotation.x, anchor.rotation.y, anchor.rotation.z].map(v => v * 180 / Math.PI) as XYZ };
          m.matrix.premultiply(placementDelta(next, dragged));
        }
        if (p.pose?.[id]) m.matrix.copy(new THREE.Matrix4().fromArray(p.pose[id]).transpose());
        if (p.exploded && i > 0) {
          const dir = new THREE.Vector3().fromArray(data!.groups[i].center).sub(center);
          if (dir.length() < extent * 0.1) dir.set(Math.cos(i * 2.39996), Math.sin(i * 2.39996), 0.6);
          dir.normalize().multiplyScalar(extent * 0.45); m.matrix.premultiply(new THREE.Matrix4().makeTranslation(dir.x, dir.y, dir.z));
        }
        m.matrixWorldNeedsUpdate = true;
        m.material.wireframe = p.wireframe;
        const metallic = /сталь|алюм|титан|латун|бронз|steel|alum|titan|brass/i.test(nextPart?.material || "");
        m.material.metalness = data!.scalars ? 0 : metallic ? 0.72 : 0.12;
        m.material.roughness = data!.scalars ? 0.7 : metallic ? 0.27 : 0.38;
        m.material.transparent = !!p.ghost; m.material.opacity = p.ghost ? 0.22 : 1; m.material.depthWrite = !p.ghost;
        m.material.color.set(data!.scalars ? 0xffffff : p.colors?.[id] || palette[i % palette.length]);
        m.material.emissive.set(id === p.selected ? 0xcac887 : 0x000000); m.material.emissiveIntensity = id === p.selected ? 0.025 : 0;
        m.material.clippingPlanes = axis ? [plane] : [];
        const edge = m.children[0] as THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
        edge.material.color.set(id === p.selected ? 0x817c39 : id === hovered ? 0x68776c : 0x404a50);
        edge.material.opacity = id === p.selected ? 0.78 : 0.24; edge.material.clippingPlanes = axis ? [plane] : [];
      }
      const current = meshes.find(m => m.userData.id === p.selected && m.visible);
      const enabled = (p.tool === "translate" || p.tool === "rotate") && !!current && !p.exploded && !p.pose && !!p.onTransform;
      if (enabled) {
        if (!dragging) {
          const place = p.placements?.[p.selected] || IDENTITY;
          anchor.position.fromArray(place.at); anchor.rotation.set(...place.rotation.map(v => v * Math.PI / 180) as XYZ, "ZYX");
          anchorId = p.selected;
        }
        if (transform.object !== anchor) transform.attach(anchor);
        transform.setMode(p.tool === "rotate" ? "rotate" : "translate");
        transform.setTranslationSnap(p.snap ? 1 : null); transform.setRotationSnap(p.snap ? Math.PI / 36 : null);
      } else if (transform.object) transform.detach();
      grid.visible = p.grid !== false;
    }
    function fit(selectedOnly = false, direction?: THREE.Vector3, targetId?: string) {
      updateMeshes(); scene.updateMatrixWorld(true);
      const box = new THREE.Box3();
      for (const mesh of meshes) if (mesh.visible && (!selectedOnly || mesh.userData.id === (targetId || latest.current.selected))) box.expandByObject(mesh);
      if (box.isEmpty()) return;
      const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 2);
      const fov = Math.min(camera.fov * Math.PI / 180, 2 * Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect));
      const distance = radius / Math.sin(fov / 2) * (el!.clientWidth >= 1080 ? 1.3 : 1.04);
      const dir = direction || camera.position.clone().sub(orbit.target);
      if (!dir.lengthSq()) dir.set(1.5, -1.9, 1.3);
      orbit.target.copy(box.getCenter(new THREE.Vector3())); camera.position.copy(orbit.target).add(dir.normalize().multiplyScalar(distance));
      camera.near = Math.max(0.01, radius / 1000); camera.far = Math.max(radius * 500, 5000); camera.updateProjectionMatrix();
      orbit.minDistance = radius * 0.05; orbit.maxDistance = radius * 80; camera.lookAt(orbit.target); orbit.update();
    }
    frameView.current = fit;
    if (props.apiRef) props.apiRef.current = { fit: selectedOnly => fit(selectedOnly), zoom: direction => {
      camera.position.sub(orbit.target).multiplyScalar(direction > 0 ? 0.8 : 1.25).add(orbit.target); orbit.update();
    } };
    let didSize = false;
    const resize = new ResizeObserver(() => {
      const w = Math.max(el.clientWidth, 1), h = Math.max(el.clientHeight, 1);
      renderer.setSize(w, h); camera.aspect = w / h;
      if (w >= 1080) camera.setViewOffset(w, h, 0, Math.min(60, h * 0.08), w, h); else camera.clearViewOffset();
      camera.updateProjectionMatrix();
      if (!didSize) { fit(false, new THREE.Vector3(1.5, -1.9, 1.25)); didSize = true; }
      else fit();
    }); resize.observe(el);
    const ray = new THREE.Raycaster();
    function hits(e: PointerEvent | MouseEvent) {
      const rect = el!.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), camera);
      return ray.intersectObjects(meshes.filter(m => m.visible), false).filter(hit => !latest.current.clipAxis || plane.distanceToPoint(hit.point) >= 0);
    }
    const downEvent = (e: PointerEvent) => { down = [e.clientX, e.clientY]; ignoreClick = !!transform.axis; };
    const upEvent = (e: PointerEvent) => {
      if (e.button !== 0 || ignoreClick || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      const hit = hits(e)[0];
      if (hit) { if (latest.current.tool === "measure") setPoint(hit.point); else latest.current.onSelect(hit.object.userData.id); }
    };
    const moveEvent = (e: PointerEvent) => {
      if (dragging || e.buttons) return;
      const hit = hits(e)[0]; hovered = hit?.object.userData.id || "";
      renderer.domElement.style.cursor = latest.current.tool === "measure" ? "crosshair" : hovered ? "pointer" : "grab";
    };
    const doubleEvent = (e: MouseEvent) => { const hit = hits(e)[0]; if (hit) { latest.current.onSelect(hit.object.userData.id); fit(true, undefined, hit.object.userData.id); } };
    renderer.domElement.addEventListener("pointerdown", downEvent); renderer.domElement.addEventListener("pointerup", upEvent);
    renderer.domElement.addEventListener("pointermove", moveEvent); renderer.domElement.addEventListener("dblclick", doubleEvent);
    let lastMeasuredPlacements = latest.current.placements;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      if (document.hidden) return;
      if (lastMeasuredPlacements !== latest.current.placements) { clearPoints(); lastMeasuredPlacements = latest.current.placements; }
      updateMeshes(); orbit.update(); renderer.render(scene, camera);
    }; draw();
    return () => {
      cancelAnimationFrame(frame); resize.disconnect(); clearPoints(); orbit.dispose(); transform.dispose();
      renderer.domElement.removeEventListener("pointerdown", downEvent); renderer.domElement.removeEventListener("pointerup", upEvent);
      renderer.domElement.removeEventListener("pointermove", moveEvent); renderer.domElement.removeEventListener("dblclick", doubleEvent);
      for (const m of meshes) { m.geometry.dispose(); m.material.dispose(); const edge = m.children[0] as THREE.LineSegments; edge.geometry.dispose(); (edge.material as THREE.Material).dispose(); }
      ground.geometry.dispose(); ground.material.dispose(); grid.geometry.dispose(); (grid.material as THREE.Material).dispose(); envMap.dispose();
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
      if (props.apiRef) props.apiRef.current = null;
      orbitRef.current = null; cameraRef.current = null; frameView.current = null; clearMeasure.current = null;
    };
  }, [props.data]);

  useEffect(() => {
    const preset = props.view.split(":")[0];
    const dir = preset === "top" ? new THREE.Vector3(0, 0.0001, 1) : preset === "front" ? new THREE.Vector3(0, -1, 0.0001)
      : preset === "right" ? new THREE.Vector3(1, 0, 0.0001) : new THREE.Vector3(1.5, -1.9, 1.25);
    frameView.current?.(false, dir);
  }, [props.view, props.data]);

  return <div className="viewport-wrap">
    <div ref={root} className="webgl" role="img" aria-label="Интерактивная 3D-модель" />
    {unavailable && <div className="canvas-empty">WebGL недоступен. Файлы STEP и STL можно скачать из меню экспорта.</div>}
    {(props.tool === "measure" || measurement !== null) && <div className="measurement-pill"><span>{measurement === null ? "Выбери две точки на поверхности" : `${measurement.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} мм · по сетке`}</span><button onClick={() => clearMeasure.current?.()} aria-label="Сбросить измерение">×</button></div>}
  </div>;
}
