"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
export type MeshData = {
  vertices: number[][];
  triangles: number[][];
  groups: {
    id: string;
    name: string;
    start: number;
    count: number;
    center: number[];
  }[];
  bounds: number[];
};
export default function Viewport({
  data,
  selected,
  onSelect,
  exploded,
  wireframe,
  view,
}: {
  data: MeshData | null;
  selected: string;
  onSelect: (id: string) => void;
  exploded: boolean;
  wireframe: boolean;
  view: string;
}) {
  const root = useRef<HTMLDivElement>(null),
    items = useRef<THREE.Mesh[]>([]),
    select = useRef(onSelect),
    controlsRef = useRef<OrbitControls | null>(null),
    cameraRef = useRef<THREE.PerspectiveCamera | null>(null),
    flags = useRef({ exploded, wireframe, selected });
  select.current = onSelect;
  flags.current = { exploded, wireframe, selected };
  useEffect(() => {
    if (!root.current || !data) return;
    const el = root.current,
      scene = new THREE.Scene();
    scene.background = new THREE.Color("#f1f3f5");
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 20000);
    camera.up.set(0, 0, 1);
    cameraRef.current = camera;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      el.textContent = "WebGL недоступен. Модели можно скачать в STEP/STL.";
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controlsRef.current = controls;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x7d8696, 2.8));
    const sun = new THREE.DirectionalLight(0xffffff, 3.4);
    sun.position.set(80, -80, 160);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xb0caff, 1);
    fill.position.set(-80, 100, 50);
    scene.add(fill);
    const meshes: THREE.Mesh[] = [];
    const colors = [0x6983a0, 0x4e8f91, 0xa9b1be, 0xc39664, 0x877aa0];
    for (const [i, g] of data.groups.entries()) {
      const pos: number[] = [];
      for (const triangle of data.triangles.slice(g.start, g.start + g.count))
        for (const idx of triangle) pos.push(...data.vertices[idx]);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({
        color: colors[i % colors.length],
        roughness: 0.38,
        metalness: 0.32,
        flatShading: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, material);
      mesh.userData = {
        id: g.id,
        baseColor: colors[i % colors.length],
        index: i,
      };
      meshes.push(mesh);
      scene.add(mesh);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo, 28),
        new THREE.LineBasicMaterial({
          color: 0x31465e,
          transparent: true,
          opacity: 0.28,
        }),
      );
      mesh.add(edges);
    }
    items.current = meshes;
    const box = new THREE.Box3();
    meshes.forEach((m) => box.expandByObject(m));
    const center = box.getCenter(new THREE.Vector3()),
      size = box.getSize(new THREE.Vector3()),
      extent = Math.max(size.x, size.y, size.z, 25);
    controls.target.copy(center);
    camera.position
      .copy(center)
      .add(new THREE.Vector3(1.65, -2.1, 1.55).multiplyScalar(extent));
    camera.lookAt(center);
    const grid = new THREE.GridHelper(
      Math.ceil((extent * 5) / 10) * 10,
      50,
      0xd1d7df,
      0xe1e5ea,
    );
    grid.rotation.x = Math.PI / 2;
    grid.position.z = box.min.z - 0.2;
    scene.add(grid);
    const resize = new ResizeObserver(() => {
      const w = el.clientWidth,
        h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    });
    resize.observe(el);
    const ray = new THREE.Raycaster();
    let start = [0, 0];
    const down = (e: PointerEvent) => {
      start = [e.clientX, e.clientY];
    };
    const up = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 5) return;
      const rect = el.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const hit = ray.intersectObjects(meshes, false)[0];
      if (hit) select.current(hit.object.userData.id);
    };
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointerup", up);
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      for (const m of meshes) {
        const f = flags.current,
          mat = m.material as THREE.MeshStandardMaterial;
        mat.wireframe = f.wireframe;
        mat.emissive.set(f.selected === m.userData.id ? 0x153c8c : 0x000000);
        mat.emissiveIntensity = f.selected === m.userData.id ? 0.12 : 0;
        const i = m.userData.index;
        const target = new THREE.Vector3();
        if (f.exploded && i > 0) {
          target.fromArray(data.groups[i].center).sub(center);
          if (target.length() < extent * 0.2)
            target.set(Math.cos(i * 2.39996), Math.sin(i * 2.39996), 0.6);
          target.normalize().multiplyScalar(extent * (0.65 + 0.12 * (i % 3)));
        }
        m.position.lerp(target, 0.12);
      }
      controls.update();
      renderer.render(scene, camera);
    };
    draw();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      for (const m of meshes) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
        m.children.forEach((o) => {
          if (o instanceof THREE.LineSegments) {
            o.geometry.dispose();
            (o.material as THREE.Material).dispose();
          }
        });
      }
      grid.geometry.dispose();
      grid.material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      items.current = [];
      controlsRef.current = null;
      cameraRef.current = null;
    };
  }, [data]);
  useEffect(() => {
    const camera = cameraRef.current,
      controls = controlsRef.current;
    if (!camera || !controls || !data) return;
    const extent = Math.max(...data.bounds, 25),
      dir =
        view === "top"
          ? new THREE.Vector3(0, 0, 3)
          : view === "front"
            ? new THREE.Vector3(0, -3, 0.01)
            : new THREE.Vector3(1.65, -2.1, 1.55);
    camera.position.copy(controls.target).add(dir.multiplyScalar(extent));
    camera.lookAt(controls.target);
    controls.update();
  }, [view, data]);
  return (
    <div
      className="webgl"
      ref={root}
      aria-label="Интерактивная 3D-модель: вращение мышью, масштабирование колёсиком"
    />
  );
}
