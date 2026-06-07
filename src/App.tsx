import {
  Activity,
  Bot,
  Braces,
  ChevronLeft,
  ChevronRight,
  Download,
  Eraser,
  Eye,
  FileJson,
  ImagePlus,
  Layers,
  Moon,
  Palette,
  Pencil,
  Pin,
  Play,
  RotateCcw,
  Save,
  Send,
  Settings,
  Sun,
  Upload,
  X,
} from "lucide-react";
import { ChangeEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

type Theme = "dark" | "light";
type PaintMode = "orbit" | "draw" | "fill" | "erase" | "note";
type ViewMode = "arch" | "scaffold";

type ModelConfig = {
  endpoint: string;
  key: string;
  model: string;
};

type OpgProfile = {
  similarity: number;
  discrimination: number;
  linkage: number;
  indices: Record<string, number>;
  scaffold: {
    archX: number;
    archZ: number;
    vertical: number;
    toothScale: number;
    rootScale: number;
    asym: number;
  };
};

type OpgImage = {
  dataUrl: string;
  name: string;
  size: number | null;
  type: string;
  width: number;
  height: number;
  profile: OpgProfile;
};

type VisibleMessage = {
  id: string;
  role: "user" | "ai" | "sys";
  text: string;
  preview?: {
    dataUrl: string;
    caption: string;
    meta: string;
  };
};

type ApiMessage = {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
};

type AnnotationRecord = {
  id: string;
  mode: "draw" | "note";
  color: string;
  size: number;
  text?: string;
  position: [number, number, number];
};

type FillRecord = {
  id: string;
  partId: string;
  color: string;
};

const CFG_KEY = "dental-cfg-v2";
const THEME_KEY = "dental-theme-v2";
const LAYOUT_KEY = "dental-layout-v2";
const COLORS = ["#f43f5e", "#fbbf24", "#34d399", "#22d3ee", "#a78bfa", "#ffffff"];

const initialCfg = (): ModelConfig => {
  try {
    const saved = JSON.parse(localStorage.getItem(CFG_KEY) || "{}") as Partial<ModelConfig>;
    return {
      endpoint: saved.endpoint || "http://127.0.0.1:8888/v1/chat/completions",
      key: saved.key || "",
      model: saved.model || "local-model",
    };
  } catch {
    return { endpoint: "http://127.0.0.1:8888/v1/chat/completions", key: "", model: "local-model" };
  }
};

const uid = () => Math.random().toString(36).slice(2, 10);

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMarkdown(raw: string) {
  let text = escapeHtml(raw.trim() || "");
  text = text.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  text = text.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  text = text.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  text = text.replace(/((?:^[-*] .+(?:\n|$))+)/gm, block => {
    const items = block
      .trim()
      .split("\n")
      .map(line => `<li>${line.replace(/^[-*] /, "")}</li>`)
      .join("");
    return `<ul>${items}</ul>`;
  });
  text = text.replace(/((?:^\d+\. .+(?:\n|$))+)/gm, block => {
    const items = block
      .trim()
      .split("\n")
      .map(line => `<li>${line.replace(/^\d+\. /, "")}</li>`)
      .join("");
    return `<ol>${items}</ol>`;
  });
  return `<div class="md-wrap">${text
    .split(/\n{2,}/)
    .map(chunk => (/^<(h|ul|ol)/.test(chunk.trim()) ? chunk : `<p>${chunk.replace(/\n/g, "<br />")}</p>`))
    .join("")}</div>`;
}

async function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function decodeImage(dataUrl: string) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return img;
}

function imageEntropy(hist: number[], total: number) {
  let entropy = 0;
  for (const n of hist) {
    if (!n) continue;
    const p = n / total;
    entropy -= p * Math.log2(p);
  }
  return clamp(entropy / 8, 0, 1);
}

function computeOpgProfile(img: HTMLImageElement): OpgProfile {
  const width = 192;
  const height = 96;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is unavailable.");
  ctx.drawImage(img, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  const gray = new Float32Array(width * height);
  const hist = Array(256).fill(0);
  let sum = 0;
  let sumSq = 0;
  let left = 0;
  let right = 0;
  let lrN = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      const g = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
      gray[y * width + x] = g;
      hist[Math.round(g)] += 1;
      sum += g;
      sumSq += g * g;
      if (x < width / 2) left += g;
      else right += g;
      lrN += x < width / 2 ? 1 : 0;
    }
  }

  const n = width * height;
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  let edgeSum = 0;
  let edgeN = 0;
  let mirrorDiff = 0;
  const x0 = Math.round(width * 0.07);
  const x1 = Math.round(width * 0.93);
  const y0 = Math.round(height * 0.18);
  const y1 = Math.round(height * 0.82);

  for (let y = y0 + 1; y < y1 - 1; y += 1) {
    for (let x = x0 + 1; x < x1 - 1; x += 1) {
      const i = y * width + x;
      const dx = gray[i + 1] - gray[i - 1];
      const dy = gray[i + width] - gray[i - width];
      edgeSum += Math.sqrt(dx * dx + dy * dy) / 255;
      edgeN += 1;
      mirrorDiff += Math.abs(gray[i] - gray[y * width + (width - 1 - x)]) / 255;
    }
  }

  const aspect = img.naturalWidth / Math.max(img.naturalHeight, 1);
  const edgeIndex = clamp((edgeSum / Math.max(edgeN, 1)) * 4.2, 0, 1);
  const contrastIndex = clamp(std / 72, 0, 1);
  const entropyIndex = imageEntropy(hist, n);
  const symmetryIndex = clamp(1 - (mirrorDiff / Math.max(edgeN, 1)) * 2.2, 0, 1);
  const aspectIndex = clamp(1 - Math.abs(aspect - 2.55) / 1.35, 0, 1);
  const sideBalance = clamp(left / Math.max(lrN, 1) - right / Math.max(n - lrN, 1), -16, 16) / 100;

  const similarity = Math.round(100 * (aspectIndex * 0.42 + symmetryIndex * 0.26 + contrastIndex * 0.16 + entropyIndex * 0.16));
  const discrimination = Math.round(100 * (edgeIndex * 0.4 + contrastIndex * 0.3 + entropyIndex * 0.2 + symmetryIndex * 0.1));
  const linkage = Math.round(100 * (similarity / 100 * 0.36 + discrimination / 100 * 0.34 + aspectIndex * 0.16 + symmetryIndex * 0.14));

  return {
    similarity,
    discrimination,
    linkage,
    indices: {
      "Panoramic fit": aspectIndex * 100,
      Symmetry: symmetryIndex * 100,
      Contrast: contrastIndex * 100,
      "Edge detail": edgeIndex * 100,
    },
    scaffold: {
      archX: 1 + sideBalance,
      archZ: 0.92 + aspectIndex * 0.15,
      vertical: 0.92 + contrastIndex * 0.16,
      toothScale: 0.9 + edgeIndex * 0.22,
      rootScale: 0.92 + entropyIndex * 0.18,
      asym: sideBalance,
    },
  };
}

function safeStem(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "dental-workflow";
}

function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function MetricRow({ label, value }: { label: string; value: number }) {
  const pct = clamp(Math.round(value), 0, 100);
  return (
    <div className="metric-row">
      <span>{label}</span>
      <div className="meter">
        <div className="h-full bg-gradient-to-r from-cyanx to-mintx" style={{ width: `${pct}%` }} />
      </div>
      <strong className="text-ink">{pct}</strong>
    </div>
  );
}

function DentalViewer({
  opg,
  generation,
  viewMode,
  spin,
  wire,
  slices,
  floor,
  frame,
  paintMode,
  color,
  brushSize,
  noteText,
  annotations,
  fills,
  onAnnotationsChange,
  onFillsChange,
  onCanvasReady,
}: {
  opg: OpgImage | null;
  generation: number;
  viewMode: ViewMode;
  spin: boolean;
  wire: boolean;
  slices: boolean;
  floor: boolean;
  frame: boolean;
  paintMode: PaintMode;
  color: string;
  brushSize: number;
  noteText: string;
  annotations: AnnotationRecord[];
  fills: FillRecord[];
  onAnnotationsChange: (records: AnnotationRecord[]) => void;
  onFillsChange: (records: FillRecord[]) => void;
  onCanvasReady: (canvas: HTMLCanvasElement | null) => void;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const pointerRef = useRef(new THREE.Vector2());
  const dragRef = useRef<{ x: number; y: number; pan: boolean } | null>(null);
  const orbitRef = useRef({ theta: 0.25, phi: 1.3, radius: 5.2, x: 0, y: 0 });
  const paintModeRef = useRef(paintMode);
  const annotationsRef = useRef(annotations);
  const fillsRef = useRef(fills);

  useEffect(() => {
    paintModeRef.current = paintMode;
  }, [paintMode]);

  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

  useEffect(() => {
    fillsRef.current = fills;
  }, [fills]);

  const applyToggles = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.traverse(obj => {
      const data = obj.userData || {};
      if (data.wire) obj.visible = wire;
      if (data.slice) obj.visible = slices;
      if (data.floor) obj.visible = floor;
      if (data.frame) obj.visible = frame;
    });
  }, [floor, frame, slices, wire]);

  const addAnnotationMesh = useCallback((record: AnnotationRecord) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const root = scene.getObjectByName("annotation-root") as THREE.Group | undefined;
    if (!root) return;
    if (record.mode === "note") {
      const group = new THREE.Group();
      group.name = record.id;
      const pin = new THREE.Mesh(
        new THREE.SphereGeometry(0.035, 14, 14),
        new THREE.MeshBasicMaterial({ color: record.color })
      );
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.007, 0.007, 0.22, 8),
        new THREE.MeshBasicMaterial({ color: record.color })
      );
      stem.position.y = 0.12;
      group.position.fromArray(record.position);
      group.add(pin, stem);
      root.add(group);
      return;
    }

    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(record.size / 130, 18, 18),
      new THREE.MeshBasicMaterial({ color: record.color, transparent: true, opacity: 0.9 })
    );
    mesh.name = record.id;
    mesh.position.fromArray(record.position);
    root.add(mesh);
  }, []);

  const rebuildAnnotations = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const root = scene.getObjectByName("annotation-root") as THREE.Group | undefined;
    if (!root) return;
    while (root.children.length) {
      const child = root.children.pop();
      child?.traverse(obj => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach(m => m.dispose());
        else material?.dispose();
      });
    }
    annotationsRef.current.forEach(addAnnotationMesh);
  }, [addAnnotationMesh]);

  useEffect(() => {
    rebuildAnnotations();
  }, [annotations, rebuildAnnotations]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.userData.partId || !mesh.material) return;
      const fill = fills.find(item => item.partId === mesh.userData.partId);
      if (fill) {
        const material = mesh.material as THREE.MeshStandardMaterial;
        if (material.color) material.color.set(fill.color);
      }
    });
  }, [fills]);

  useEffect(() => {
    const mount = mountRef.current;
    const canvas = canvasRef.current;
    if (!mount || !canvas) return;
    onCanvasReady(canvas);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rendererRef.current = renderer;
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    cameraRef.current = camera;

    let animationId = 0;
    const render = () => {
      animationId = requestAnimationFrame(render);
      const scene = sceneRef.current;
      if (!scene) return;
      const orbit = orbitRef.current;
      if (spin && !dragRef.current) orbit.theta += 0.003;
      camera.position.set(
        orbit.radius * Math.sin(orbit.phi) * Math.sin(orbit.theta) + orbit.x,
        orbit.radius * Math.cos(orbit.phi) + orbit.y,
        orbit.radius * Math.sin(orbit.phi) * Math.cos(orbit.theta)
      );
      camera.lookAt(orbit.x, orbit.y, 0);
      renderer.render(scene, camera);
    };

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / Math.max(rect.height, 1);
      camera.updateProjectionMatrix();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();
    render();

    return () => {
      cancelAnimationFrame(animationId);
      observer.disconnect();
      onCanvasReady(null);
      sceneRef.current?.traverse(obj => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach(m => m.dispose());
        else material?.dispose();
      });
      renderer.dispose();
    };
  }, [onCanvasReady, spin]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || generation === 0) return;
    let alive = true;

    async function build() {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue("--shell").trim() ? "#05070b" : "#05070b");
      scene.add(new THREE.AmbientLight(0xffffff, 0.58));
      const key = new THREE.DirectionalLight(0x67e8f9, 1.8);
      key.position.set(3, 4, 4);
      scene.add(key);
      const fillLight = new THREE.DirectionalLight(0x34d399, 0.8);
      fillLight.position.set(-4, -2, 3);
      scene.add(fillLight);

      const root = new THREE.Group();
      scene.add(root);
      const annotationRoot = new THREE.Group();
      annotationRoot.name = "annotation-root";
      root.add(annotationRoot);

      if (viewMode === "scaffold") buildScaffold(root, opg?.profile || null);
      else await buildArch(root, opg);

      root.add(makeGrid());
      if (!alive) return;

      sceneRef.current?.traverse(obj => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach(m => m.dispose());
        else material?.dispose();
      });
      sceneRef.current = scene;
      applyToggles();
      rebuildAnnotations();
    }

    build().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [applyToggles, generation, opg, rebuildAnnotations, viewMode]);

  useEffect(() => {
    applyToggles();
  }, [applyToggles]);

  const hitTest = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const camera = cameraRef.current;
    const scene = sceneRef.current;
    if (!canvas || !camera || !scene) return null;
    const rect = canvas.getBoundingClientRect();
    pointerRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycasterRef.current.setFromCamera(pointerRef.current, camera);
    const targets: THREE.Object3D[] = [];
    scene.traverse(obj => {
      if (obj.userData.paintTarget) targets.push(obj);
    });
    return raycasterRef.current.intersectObjects(targets, true)[0] || null;
  }, []);

  const paintAt = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const hit = hitTest(event);
      if (!hit) return;
      const mode = paintModeRef.current;
      if (mode === "draw" || mode === "note") {
        const next: AnnotationRecord = {
          id: uid(),
          mode,
          color,
          size: brushSize,
          text: mode === "note" ? noteText.trim() || "Note" : undefined,
          position: hit.point.toArray() as [number, number, number],
        };
        onAnnotationsChange([...annotationsRef.current, next]);
      }
      if (mode === "fill") {
        const partId = hit.object.userData.partId as string | undefined;
        if (!partId) return;
        onFillsChange([...fillsRef.current.filter(item => item.partId !== partId), { id: uid(), partId, color }]);
      }
      if (mode === "erase") {
        const nearest = annotationsRef.current
          .map(record => ({ record, distance: new THREE.Vector3(...record.position).distanceTo(hit.point) }))
          .sort((a, b) => a.distance - b.distance)[0];
        if (nearest && nearest.distance < 0.22) {
          onAnnotationsChange(annotationsRef.current.filter(record => record.id !== nearest.record.id));
        }
      }
    },
    [brushSize, color, hitTest, noteText, onAnnotationsChange, onFillsChange]
  );

  return (
    <div ref={mountRef} className="relative h-full min-h-0 w-full">
      <canvas
        ref={canvasRef}
        className={`block h-full w-full ${paintMode === "orbit" ? "cursor-grab" : "cursor-crosshair"}`}
        onPointerDown={event => {
          if (paintMode !== "orbit") {
            paintAt(event);
            return;
          }
          dragRef.current = { x: event.clientX, y: event.clientY, pan: event.shiftKey };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          const drag = dragRef.current;
          if (!drag) return;
          const dx = event.clientX - drag.x;
          const dy = event.clientY - drag.y;
          drag.x = event.clientX;
          drag.y = event.clientY;
          const orbit = orbitRef.current;
          if (drag.pan) {
            orbit.x -= dx * 0.006;
            orbit.y += dy * 0.006;
          } else {
            orbit.theta -= dx * 0.008;
            orbit.phi = clamp(orbit.phi - dy * 0.006, 0.25, Math.PI - 0.25);
          }
        }}
        onPointerUp={event => {
          dragRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onWheel={event => {
          orbitRef.current.radius = clamp(orbitRef.current.radius + event.deltaY * 0.004, 2.4, 9);
        }}
      />
      {generation === 0 && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted">
          <Eye className="h-16 w-16 opacity-10" />
          <p className="text-sm">Upload an OPG, then generate CBCT</p>
        </div>
      )}
      {generation > 0 && (
        <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1">
          <div className="viewer-tag">{opg ? `${opg.profile.linkage}% OPG scaffold linkage` : "Scaffold preview"}</div>
          <div className="viewer-tag viewer-tag-active">{viewMode === "scaffold" ? "Scaffold - 3D" : "Dental arch - 3D"}</div>
          <div className="viewer-tag">{viewMode === "scaffold" ? "Mandible - Maxilla - 32 teeth" : "Arch - Teeth - Slices"}</div>
        </div>
      )}
    </div>
  );
}

async function buildArch(root: THREE.Group, opg: OpgImage | null) {
  const texture = opg ? await new THREE.TextureLoader().loadAsync(opg.dataUrl) : null;
  if (texture) texture.colorSpace = THREE.SRGBColorSpace;

  const segmentsA = 96;
  const segmentsH = 48;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= segmentsH; j += 1) {
    const v = j / segmentsH;
    const y = (1 - v * 2) * 1.7;
    for (let i = 0; i <= segmentsA; i += 1) {
      const u = i / segmentsA;
      const angle = Math.PI * u;
      const radius = 1.9 + Math.sin(angle) * 0.28;
      positions.push(Math.cos(angle) * radius, y, Math.sin(angle) * 1.15);
      uvs.push(u, 1 - v);
    }
  }
  for (let j = 0; j < segmentsH; j += 1) {
    for (let i = 0; i < segmentsA; i += 1) {
      const a = j * (segmentsA + 1) + i;
      const b = a + 1;
      const c = a + segmentsA + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const arch = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      map: texture || null,
      displacementMap: texture || null,
      displacementScale: texture ? 0.24 : 0,
      color: texture ? 0xffffff : 0x94a3b8,
      roughness: 0.72,
      side: THREE.DoubleSide,
    })
  );
  arch.userData.paintTarget = true;
  arch.userData.partId = "scan-arch";
  root.add(arch);

  const wire = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: 0x22d3ee, wireframe: true, transparent: true, opacity: 0.08 })
  );
  wire.userData.wire = true;
  root.add(wire);

  buildTeeth(root, false);
  [-0.55, 0, 0.55].forEach((y, index) => {
    const slice = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 2.6),
      new THREE.MeshBasicMaterial({ map: texture || null, transparent: true, opacity: 0.11 - index * 0.02, side: THREE.DoubleSide })
    );
    slice.rotation.x = -Math.PI / 2;
    slice.position.y = y;
    slice.userData.slice = true;
    root.add(slice);
  });
}

function buildTeeth(root: THREE.Group, scaffold: boolean, profile?: OpgProfile | null) {
  const widths = [0.07, 0.09, 0.1, 0.11, 0.12, 0.13, 0.13, 0.12, 0.12, 0.13, 0.13, 0.12, 0.11, 0.1, 0.09, 0.07];
  const heights = [0.34, 0.38, 0.42, 0.38, 0.34, 0.38, 0.44, 0.46, 0.46, 0.44, 0.38, 0.34, 0.38, 0.42, 0.38, 0.34];
  const p = profile?.scaffold || { archX: 1, archZ: 1, vertical: 1, toothScale: 1, rootScale: 1, asym: 0 };
  const mat = new THREE.MeshStandardMaterial({ color: scaffold ? 0xe2e8f0 : 0xd6ceb8, roughness: 0.55 });
  widths.forEach((width, index) => {
    const t = index / (widths.length - 1);
    const angle = Math.PI * t;
    const radius = 1.92 + Math.sin(angle) * 0.28;
    const sideScale = 1 + p.asym * (t - 0.5);
    const x = Math.cos(angle) * radius * p.archX * sideScale;
    const z = Math.sin(angle) * 1.15 * p.archZ;
    const rotationY = -angle + Math.PI * 0.5;
    const w = width * p.toothScale;
    const h = heights[index] * p.toothScale;

    [
      { upper: true, y: 0.96 * p.vertical - h * 0.5, scale: 1 },
      { upper: false, y: -0.96 * p.vertical + h * 0.44, scale: 0.88 },
    ].forEach(({ upper, y, scale }) => {
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(w, h * scale, w * 0.82, 1, 3, 1), mat.clone());
      tooth.position.set(x, y, z);
      tooth.rotation.y = rotationY;
      tooth.userData.paintTarget = true;
      tooth.userData.partId = `${upper ? "upper" : "lower"}-tooth-${index + 1}`;
      tooth.userData.frame = true;
      root.add(tooth);
    });
  });
}

function buildScaffold(root: THREE.Group, profile: OpgProfile | null) {
  const p = profile?.scaffold || { archX: 1, archZ: 1, vertical: 1, toothScale: 1, rootScale: 1, asym: 0 };
  const makeCurve = (y: number, radius: number, zScale: number, warp: number) =>
    new THREE.CatmullRomCurve3(
      Array.from({ length: 26 }, (_, index) => {
        const t = index / 25;
        const angle = Math.PI * t;
        const r = radius + Math.sin(angle) * warp;
        const sideScale = 1 + p.asym * (t - 0.5);
        return new THREE.Vector3(Math.cos(angle) * r * p.archX * sideScale, y * p.vertical, Math.sin(angle) * zScale * p.archZ);
      })
    );

  [
    { id: "mandible", y: -0.84, color: 0x22d3ee, radius: 1.88 },
    { id: "maxilla", y: 0.9, color: 0x67e8f9, radius: 2.02 },
  ].forEach(item => {
    const geometry = new THREE.TubeGeometry(makeCurve(item.y, item.radius, 1.22, 0.3), 80, 0.055, 8, false);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: item.color, transparent: true, opacity: 0.08 }));
    mesh.userData.paintTarget = true;
    mesh.userData.partId = `scaffold-${item.id}`;
    root.add(mesh);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: item.color, transparent: true, opacity: 0.9 }));
    edges.userData.frame = true;
    root.add(edges);
  });

  [-1, 1].forEach(side => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 1.88 * p.archX, -0.84 * p.vertical, 0.08 * p.archZ),
      new THREE.Vector3(side * 2.08 * p.archX, -0.18 * p.vertical, -0.34 * p.archZ),
      new THREE.Vector3(side * 2.14 * p.archX, 0.52 * p.vertical, -0.52 * p.archZ),
      new THREE.Vector3(side * 2.1 * p.archX, 1.08 * p.vertical, -0.48 * p.archZ),
    ]);
    const geometry = new THREE.TubeGeometry(curve, 32, 0.045, 7, false);
    const ramus = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.06 }));
    ramus.userData.paintTarget = true;
    ramus.userData.partId = `scaffold-ramus-${side < 0 ? "L" : "R"}`;
    root.add(ramus);
    const condyle = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.18 }));
    condyle.position.set(side * 2.12 * p.archX, 1.18 * p.vertical, -0.52 * p.archZ);
    condyle.userData.paintTarget = true;
    condyle.userData.partId = `scaffold-condyle-${side < 0 ? "L" : "R"}`;
    root.add(condyle);
  });

  buildTeeth(root, true, profile);

  const nerve = new THREE.TubeGeometry(makeCurve(-1.1, 1.62, 0.92, 0.22), 48, 0.016, 5, false);
  const nerveLine = new THREE.LineSegments(new THREE.EdgesGeometry(nerve), new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.65 }));
  nerveLine.userData.frame = true;
  root.add(nerveLine);
}

function makeGrid() {
  const group = new THREE.Group();
  group.userData.floor = true;
  const grid = new THREE.GridHelper(5.2, 18, 0x243348, 0x1a2535);
  grid.position.y = -1.95;
  group.add(grid);
  return group;
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(THEME_KEY) as Theme) || "dark");
  const [cfg, setCfg] = useState<ModelConfig>(initialCfg);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [opg, setOpg] = useState<OpgImage | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [generation, setGeneration] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("arch");
  const [spin, setSpin] = useState(true);
  const [wire, setWire] = useState(false);
  const [slices, setSlices] = useState(true);
  const [floor, setFloor] = useState(true);
  const [frame, setFrame] = useState(true);
  const [paintMode, setPaintMode] = useState<PaintMode>("orbit");
  const [color, setColor] = useState(COLORS[0]);
  const [brushSize, setBrushSize] = useState(6);
  const [noteText, setNoteText] = useState("");
  const [annotations, setAnnotations] = useState<AnnotationRecord[]>([]);
  const [fills, setFills] = useState<FillRecord[]>([]);
  const [messages, setMessages] = useState<VisibleMessage[]>([
    { id: uid(), role: "sys", text: "Upload an OPG and configure a model endpoint in Settings to begin AI-assisted dental analysis." },
  ]);
  const [apiMessages, setApiMessages] = useState<ApiMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [chatText, setChatText] = useState("");
  const [opgCollapsed, setOpgCollapsed] = useState(false);
  const [aiCollapsed, setAiCollapsed] = useState(false);
  const [opgWidth, setOpgWidth] = useState(320);
  const [aiWidth, setAiWidth] = useState(380);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [captureActive, setCaptureActive] = useState(false);
  const [captureDrag, setCaptureDrag] = useState<{ x: number; y: number } | null>(null);
  const [captureRect, setCaptureRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const opgDragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  }, [cfg]);

  useEffect(() => {
    const saved = localStorage.getItem(LAYOUT_KEY);
    if (!saved) return;
    try {
      const layout = JSON.parse(saved) as Partial<{ opgWidth: number; aiWidth: number; opgCollapsed: boolean; aiCollapsed: boolean }>;
      setOpgWidth(layout.opgWidth || 320);
      setAiWidth(layout.aiWidth || 380);
      setOpgCollapsed(Boolean(layout.opgCollapsed));
      setAiCollapsed(Boolean(layout.aiCollapsed));
    } catch {
      undefined;
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ opgWidth, aiWidth, opgCollapsed, aiCollapsed }));
  }, [aiCollapsed, aiWidth, opgCollapsed, opgWidth]);

  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight });
  }, [messages]);

  const modelConfigured = Boolean(cfg.model || cfg.endpoint);

  const gridTemplateColumns = useMemo(() => {
    const left = opgCollapsed ? "44px" : `${opgWidth}px`;
    const leftHandle = opgCollapsed ? "0px" : "6px";
    const rightHandle = aiCollapsed ? "0px" : "6px";
    const right = aiCollapsed ? "44px" : `${aiWidth}px`;
    return `${left} ${leftHandle} minmax(360px, 1fr) ${rightHandle} ${right}`;
  }, [aiCollapsed, aiWidth, opgCollapsed, opgWidth]);

  const addMessage = useCallback((role: VisibleMessage["role"], text: string, preview?: VisibleMessage["preview"]) => {
    setMessages(current => [...current, { id: uid(), role, text, preview }]);
  }, []);

  const loadFile = useCallback(async (file: File) => {
    const dataUrl = await fileToDataUrl(file);
    const img = await decodeImage(dataUrl);
    const profile = computeOpgProfile(img);
    setOpg({ dataUrl, name: file.name, size: file.size, type: file.type || "image/*", width: img.naturalWidth, height: img.naturalHeight, profile });
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setGeneration(0);
    setAnnotations([]);
    setFills([]);
  }, []);

  const onImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) await loadFile(file);
    event.target.value = "";
  };

  const analyzeMessages = useCallback(
    async (nextApiMessages: ApiMessage[], placeholderId: string) => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (cfg.key) headers.Authorization = `Bearer ${cfg.key}`;

      const response = await fetch(cfg.endpoint || "http://127.0.0.1:8888/v1/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: cfg.model || "local-model",
          messages: nextApiMessages,
          max_tokens: 2048,
          temperature: 0.25,
          stream: true,
        }),
      });

      if (!response.ok) {
        let reason = `HTTP ${response.status}`;
        try {
          const body = await response.json();
          reason = body.error?.message || reason;
        } catch {
          undefined;
        }
        throw new Error(reason);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Streaming response body is unavailable.");
      const decoder = new TextDecoder();
      let buffer = "";
      let full = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content || "";
            if (delta) {
              full += delta;
              setMessages(current => current.map(message => (message.id === placeholderId ? { ...message, text: full } : message)));
            }
          } catch {
            undefined;
          }
        }
      }

      const reply = full || "(empty response)";
      setApiMessages([...nextApiMessages, { role: "assistant", content: reply }]);
      setMessages(current => current.map(message => (message.id === placeholderId ? { ...message, text: reply } : message)));
    },
    [cfg]
  );

  const analyzeOpg = async () => {
    if (!opg || busy) return;
    setBusy(true);
    const prompt = "Please analyze this OPG and provide a full radiographic dental report.";
    const system = `You are an expert dental radiologist and oral health AI assistant. Analyze the provided OPG and generate a structured report covering image quality, dental findings by quadrant using FDI notation, periodontal bone levels, periapical and endodontic observations, caries, restorations, TMJ and condyles, sinuses, impression, and clinical recommendations. Be concise and avoid overdiagnosis.`;
    const nextApi: ApiMessage[] = [
      { role: "system", content: system },
      { role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: opg.dataUrl } }] },
    ];
    setApiMessages(nextApi);
    setMessages(current => [...current, { id: uid(), role: "user", text: prompt }]);
    const placeholderId = uid();
    setMessages(current => [...current, { id: placeholderId, role: "ai", text: "" }]);
    try {
      await analyzeMessages(nextApi, placeholderId);
    } catch (error) {
      addMessage("sys", `Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const sendChat = async () => {
    const text = chatText.trim();
    if (!text || busy) return;
    setChatText("");
    setBusy(true);
    const base = apiMessages.length ? apiMessages : [{ role: "system", content: "You are an expert dental radiologist AI assistant." } as ApiMessage];
    const userMessage: ApiMessage = opg && base.length === 1
      ? { role: "user", content: [{ type: "text", text }, { type: "image_url", image_url: { url: opg.dataUrl } }] }
      : { role: "user", content: text };
    const nextApi = [...base, userMessage];
    setApiMessages(nextApi);
    addMessage("user", text);
    const placeholderId = uid();
    setMessages(current => [...current, { id: placeholderId, role: "ai", text: "" }]);
    try {
      await analyzeMessages(nextApi, placeholderId);
    } catch (error) {
      addMessage("sys", `Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const analyzeCapture = async () => {
    if (!canvas || !captureRect || busy) return;
    const scaleX = canvas.width / canvas.getBoundingClientRect().width;
    const scaleY = canvas.height / canvas.getBoundingClientRect().height;
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(captureRect.w * scaleX));
    out.height = Math.max(1, Math.round(captureRect.h * scaleY));
    const ctx = out.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(canvas, captureRect.x * scaleX, captureRect.y * scaleY, out.width, out.height, 0, 0, out.width, out.height);
    const dataUrl = out.toDataURL("image/png");
    setCaptureActive(false);
    setCaptureRect(null);
    setBusy(true);
    const prompt = "Please analyze this selected 3D CBCT viewer crop. It is a rendered/simulated CBCT region, not a raw DICOM volume. Describe visible structures, annotations, limitations, notable observations, and suggested clinical follow-up.";
    addMessage("user", prompt, { dataUrl, caption: "Captured CBCT viewer crop", meta: `${out.width} x ${out.height}` });
    const nextApi: ApiMessage[] = [
      ...apiMessages,
      { role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: dataUrl } }] },
    ];
    const placeholderId = uid();
    setMessages(current => [...current, { id: placeholderId, role: "ai", text: "" }]);
    try {
      await analyzeMessages(nextApi, placeholderId);
    } catch (error) {
      addMessage("sys", `Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const workflow = () => ({
    schema: "dental-workflow-v2",
    savedAt: new Date().toISOString(),
    sourceImage: opg,
    model: { endpoint: cfg.endpoint, model: cfg.model },
    viewer: { generation, viewMode, annotations, fills },
    chat: { apiMessages, visible: messages },
  });

  const importWorkflow = async (file: File) => {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data?.sourceImage?.dataUrl) throw new Error("Workflow JSON does not contain an embedded OPG image.");
    const img = await decodeImage(data.sourceImage.dataUrl);
    const profile = data.sourceImage.profile || computeOpgProfile(img);
    setOpg({ ...data.sourceImage, width: img.naturalWidth, height: img.naturalHeight, profile });
    setMessages(data.chat?.visible || [{ id: uid(), role: "sys", text: "Workflow imported." }]);
    setApiMessages(data.chat?.apiMessages || []);
    setAnnotations(data.viewer?.annotations || []);
    setFills(data.viewer?.fills || []);
    setViewMode(data.viewer?.viewMode || "arch");
    setGeneration(value => value + 1);
  };

  const startResize = (side: "opg" | "ai", event: ReactPointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const startWidth = side === "opg" ? opgWidth : aiWidth;
    const move = (pointerEvent: PointerEvent) => {
      const delta = pointerEvent.clientX - startX;
      if (side === "opg") setOpgWidth(clamp(startWidth + delta, 220, 520));
      else setAiWidth(clamp(startWidth - delta, 260, 560));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="flex h-full flex-col bg-shell text-ink">
      <header className="topbar">
        <div className="flex items-center gap-3">
          <div className="brand-mark">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold">Dental Workflow</h1>
            <p className="text-[11px] text-muted">OPG - Simulated CBCT - AI Analysis</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className={`pill ${modelConfigured ? "pill-on" : ""}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {modelConfigured ? cfg.model || "Model configured" : "No model configured"}
          </div>
          <button className="btn" disabled={!opg} onClick={() => opg && downloadJson(`${safeStem(opg.name)}-workflow.json`, workflow())}>
            <Download className="h-4 w-4" /> JSON
          </button>
          <button className="btn" onClick={() => importRef.current?.click()}>
            <Upload className="h-4 w-4" /> JSON
          </button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async event => {
              const file = event.target.files?.[0];
              if (!file) return;
              try {
                await importWorkflow(file);
                addMessage("sys", "Workflow JSON imported.");
              } catch (error) {
                addMessage("sys", `Import error: ${error instanceof Error ? error.message : String(error)}`);
              } finally {
                event.target.value = "";
              }
            }}
          />
          <button className="btn-icon" title="Toggle theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button className="btn-icon" title="Settings" onClick={() => setSettingsOpen(true)}>
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 overflow-hidden" style={{ gridTemplateColumns }}>
        <aside className="panel">
          <div className={`panel-head ${opgCollapsed ? "h-full flex-col justify-start py-2" : ""}`}>
            <h2 className={`panel-title ${opgCollapsed ? "[writing-mode:vertical-rl] rotate-180" : ""}`}>OPG Image</h2>
            <div className={`flex gap-1 ${opgCollapsed ? "order-first flex-col" : ""}`}>
              {!opgCollapsed && (
                <button className="btn" onClick={() => setOpg(null)} disabled={!opg}>
                  <X className="h-4 w-4" /> Clear
                </button>
              )}
              <button className="btn h-8 w-8 px-0" onClick={() => setOpgCollapsed(!opgCollapsed)}>
                {opgCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {!opgCollapsed && (
            <>
              <div className="panel-body">
                {!opg ? (
                  <label
                    className="drop-zone"
                    onDragOver={event => event.preventDefault()}
                    onDrop={async event => {
                      event.preventDefault();
                      const file = event.dataTransfer.files?.[0];
                      if (file) await loadFile(file);
                    }}
                  >
                    <ImagePlus className="h-10 w-10 text-muted/45" />
                    <span className="text-sm font-semibold text-slate-300">Drop OPG / panoramic X-ray</span>
                    <span className="text-[11px] text-muted">or click to browse files</span>
                    <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={onImageChange} />
                  </label>
                ) : (
                  <div className="py-3">
                    <div
                      className="relative mx-3 overflow-hidden rounded-lg border border-line bg-black"
                      onPointerDown={event => {
                        opgDragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
                        event.currentTarget.setPointerCapture(event.pointerId);
                      }}
                      onPointerMove={event => {
                        const drag = opgDragRef.current;
                        if (!drag) return;
                        setPan({ x: drag.panX + event.clientX - drag.x, y: drag.panY + event.clientY - drag.y });
                      }}
                      onPointerUp={event => {
                        opgDragRef.current = null;
                        event.currentTarget.releasePointerCapture(event.pointerId);
                      }}
                    >
                      <img
                        src={opg.dataUrl}
                        alt="OPG"
                        className="block w-full select-none"
                        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "center" }}
                        draggable={false}
                      />
                      <div className="absolute right-2 top-2 flex gap-1">
                        <span className="rounded bg-black/70 px-2 py-1 text-[10px] font-bold text-slate-300">{opg.width} x {opg.height}</span>
                        <span className="rounded bg-black/70 px-2 py-1 text-[10px] font-bold text-slate-300">OPG</span>
                      </div>
                    </div>
                    <div className="mx-3 flex items-center gap-2 py-2">
                      <button className="btn" onClick={() => setZoom(value => clamp(value + 0.12, 0.5, 2.5))}>+</button>
                      <button className="btn" onClick={() => setZoom(value => clamp(value - 0.12, 0.5, 2.5))}>-</button>
                      <button className="btn" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>
                        <RotateCcw className="h-4 w-4" />
                      </button>
                      <span className="ml-auto text-[11px] text-muted">{Math.round(zoom * 100)}%</span>
                    </div>
                    <div className="meta-card">
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-muted">File Info</div>
                      <div>Name: {opg.name}</div>
                      <div>Size: {opg.size ? `${(opg.size / 1024).toFixed(1)} KB` : "embedded JSON"}</div>
                      <div>Type: {opg.type}</div>
                    </div>
                    <div className="meta-card">
                      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-muted">OPG Scaffold Linkage</div>
                      <div className="grid gap-2">
                        <MetricRow label="Similarity" value={opg.profile.similarity} />
                        <MetricRow label="Detail" value={opg.profile.discrimination} />
                        <MetricRow label="Linkage" value={opg.profile.linkage} />
                        {Object.entries(opg.profile.indices).map(([label, value]) => <MetricRow key={label} label={label} value={value} />)}
                      </div>
                      <p className="mt-2 leading-5">The simulated scaffold is parameterized from image aspect, symmetry, contrast, entropy, and edge detail.</p>
                    </div>
                  </div>
                )}
              </div>
              <div className="panel-foot">
                <button
                  className="btn btn-primary w-full"
                  disabled={!opg}
                  onClick={() => {
                    setViewMode("arch");
                    setGeneration(value => value + 1);
                    setSpin(true);
                  }}
                >
                  <Layers className="h-4 w-4" /> {generation ? "Regenerate CBCT" : "Generate Simulated CBCT"}
                </button>
              </div>
            </>
          )}
        </aside>
        <div className="resize-handle" onPointerDown={event => startResize("opg", event)} />

        <section className="panel bg-shell">
          <div className="panel-head">
            <h2 className="panel-title">3D CBCT Viewer</h2>
            <div className="flex flex-wrap gap-1">
              <button className={`btn ${spin ? "btn-primary" : ""}`} onClick={() => setSpin(!spin)}><Play className="h-4 w-4" /> {spin ? "Pause" : "Spin"}</button>
              <button className={`btn ${wire ? "btn-primary" : ""}`} onClick={() => setWire(!wire)}><Braces className="h-4 w-4" /> Wire</button>
              <button className={`btn ${slices ? "btn-primary" : ""}`} onClick={() => setSlices(!slices)}><Layers className="h-4 w-4" /> Slices</button>
              <button className={`btn ${floor ? "btn-primary" : ""}`} onClick={() => setFloor(!floor)}>Floor</button>
              <button className={`btn ${frame ? "btn-primary" : ""}`} onClick={() => setFrame(!frame)}>Frame</button>
              <button className="btn" onClick={() => setGeneration(value => (value ? value + 1 : value))}><RotateCcw className="h-4 w-4" /> Reset</button>
              <button
                className={`btn ${viewMode === "scaffold" ? "btn-primary" : ""}`}
                disabled={!generation}
                onClick={() => {
                  setViewMode(value => (value === "scaffold" ? "arch" : "scaffold"));
                  setGeneration(value => value + 1);
                }}
              >
                Scaffold
              </button>
            </div>
          </div>
          <div className="viewer-toolbar">
            <span className="mr-auto text-[11px] text-muted">Drag to orbit | Scroll to zoom | Shift+drag to pan</span>
            {[
              ["draw", Pencil],
              ["fill", Palette],
              ["erase", Eraser],
              ["note", Pin],
            ].map(([mode, Icon]) => (
              <button key={mode as string} className={`btn ${paintMode === mode ? "btn-primary" : ""}`} onClick={() => setPaintMode(paintMode === mode ? "orbit" : (mode as PaintMode))}>
                <Icon className="h-4 w-4" /> {String(mode)[0].toUpperCase() + String(mode).slice(1)}
              </button>
            ))}
            <div className="flex gap-1">
              {COLORS.map(item => (
                <button
                  key={item}
                  className={`swatch ${color === item ? "swatch-active" : ""}`}
                  style={{ backgroundColor: item }}
                  title={item}
                  onClick={() => setColor(item)}
                />
              ))}
            </div>
            <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Size</span>
            <input className="w-20 accent-cyanx" type="range" min={2} max={14} value={brushSize} onChange={event => setBrushSize(Number(event.target.value))} />
            <input className="h-8 w-40 rounded-md border border-line bg-panel2 px-2 text-xs outline-none focus:border-cyanx/50" value={noteText} onChange={event => setNoteText(event.target.value)} placeholder="Note text" />
            <button className="btn" onClick={() => { setAnnotations([]); setFills([]); }}><X className="h-4 w-4" /> Clear</button>
          </div>
          <div className="relative min-h-0 flex-1">
            <DentalViewer
              opg={opg}
              generation={generation}
              viewMode={viewMode}
              spin={spin}
              wire={wire}
              slices={slices}
              floor={floor}
              frame={frame}
              paintMode={paintMode}
              color={color}
              brushSize={brushSize}
              noteText={noteText}
              annotations={annotations}
              fills={fills}
              onAnnotationsChange={setAnnotations}
              onFillsChange={setFills}
              onCanvasReady={setCanvas}
            />
            {captureActive && (
              <div
                className="absolute inset-0 z-20 cursor-crosshair"
                onPointerDown={event => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setCaptureDrag({ x: event.clientX - rect.left, y: event.clientY - rect.top });
                  setCaptureRect({ x: event.clientX - rect.left, y: event.clientY - rect.top, w: 0, h: 0 });
                }}
                onPointerMove={event => {
                  if (!captureDrag) return;
                  const base = event.currentTarget.getBoundingClientRect();
                  const x = event.clientX - base.left;
                  const y = event.clientY - base.top;
                  setCaptureRect({ x: Math.min(captureDrag.x, x), y: Math.min(captureDrag.y, y), w: Math.abs(x - captureDrag.x), h: Math.abs(y - captureDrag.y) });
                }}
                onPointerUp={() => setCaptureDrag(null)}
              >
                {captureRect && <div className="absolute rounded border-2 border-cyanx bg-cyanx/15 shadow-[0_0_0_9999px_rgba(0,0,0,0.18)]" style={{ left: captureRect.x, top: captureRect.y, width: captureRect.w, height: captureRect.h }} />}
              </div>
            )}
          </div>
        </section>

        <div className="resize-handle" onPointerDown={event => startResize("ai", event)} />
        <aside className="panel">
          <div className={`panel-head ${aiCollapsed ? "h-full flex-col justify-start py-2" : ""}`}>
            <h2 className={`panel-title ${aiCollapsed ? "[writing-mode:vertical-rl] rotate-180" : ""}`}>AI Analysis</h2>
            <div className={`flex gap-1 ${aiCollapsed ? "order-first flex-col" : ""}`}>
              {!aiCollapsed && (
                <>
                  <button className="btn" disabled={!generation || busy} onClick={() => setCaptureActive(!captureActive)}>Capture CBCT</button>
                  <button className="btn btn-primary" disabled={!opg || busy} onClick={analyzeOpg}>
                    <Bot className="h-4 w-4" /> Analyze OPG
                  </button>
                </>
              )}
              <button className="btn h-8 w-8 px-0" onClick={() => setAiCollapsed(!aiCollapsed)}>
                {aiCollapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {!aiCollapsed && (
            <>
              <div ref={chatScrollRef} className="panel-body">
                <div className="flex flex-col gap-3 p-3">
                  {messages.map(message => (
                    <div key={message.id} className="msg">
                      <div className={`msg-label ${message.role === "user" ? "text-cyanx" : message.role === "ai" ? "text-mintx" : "text-muted"}`}>
                        {message.role === "user" ? "You" : message.role === "ai" ? "Dental AI" : "System"}
                      </div>
                      <div className={`msg-body ${message.role === "user" ? "border-cyanx/25 bg-cyanx/10 text-ink" : ""}`}>
                        <div dangerouslySetInnerHTML={{ __html: renderMarkdown(message.text || (message.role === "ai" && busy ? "..." : "")) }} />
                        {message.preview && (
                          <div className="mt-2 overflow-hidden rounded-md border border-cyanx/25 bg-shell">
                            <img src={message.preview.dataUrl} alt={message.preview.caption} className="max-h-60 w-full object-contain" />
                            <div className="flex justify-between border-t border-line px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
                              <span>{message.preview.caption}</span>
                              <span>{message.preview.meta}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="panel-foot">
                {captureActive && (
                  <div className="mb-2 flex gap-2">
                    <button className="btn btn-primary flex-1" disabled={!captureRect?.w || !captureRect?.h || busy} onClick={analyzeCapture}>Analyze Capture</button>
                    <button className="btn" onClick={() => { setCaptureActive(false); setCaptureRect(null); }}>Cancel</button>
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <textarea
                    className="chat-input"
                    rows={2}
                    disabled={busy}
                    value={chatText}
                    placeholder="Ask a follow-up question..."
                    onChange={event => setChatText(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === "Enter" && event.ctrlKey) void sendChat();
                    }}
                  />
                  <button className="btn btn-primary h-10 px-3" disabled={busy || !chatText.trim()} onClick={sendChat}>
                    {busy ? "..." : <Send className="h-4 w-4" />}
                  </button>
                </div>
                <div className="mt-1 text-[11px] text-muted">Ctrl+Enter to send</div>
              </div>
            </>
          )}
        </aside>
      </main>

      {settingsOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-lg border border-cyanx/25 bg-panel2">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h3 className="flex items-center gap-2 font-bold"><Settings className="h-4 w-4" /> Settings</h3>
              <button className="btn-icon" onClick={() => setSettingsOpen(false)}><X className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-4 p-5">
              <label>
                <span className="field-label">Model Endpoint</span>
                <input className="field-input" value={cfg.endpoint} onChange={event => setCfg({ ...cfg, endpoint: event.target.value })} placeholder="http://127.0.0.1:8888/v1/chat/completions" />
                <span className="mt-1 block text-[11px] text-muted">OpenAI-compatible chat completions URL</span>
              </label>
              <label>
                <span className="field-label">API Key optional</span>
                <input className="field-input" type="password" value={cfg.key} onChange={event => setCfg({ ...cfg, key: event.target.value })} placeholder="sk-..." />
              </label>
              <label>
                <span className="field-label">Model Identifier</span>
                <input className="field-input" value={cfg.model} onChange={event => setCfg({ ...cfg, model: event.target.value })} placeholder="gpt-4o / local-model / llava" />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
              <button className="btn" onClick={() => setSettingsOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => setSettingsOpen(false)}><Save className="h-4 w-4" /> Save Settings</button>
            </div>
          </div>
        </div>
      )}
      <FileJson className="hidden" />
    </div>
  );
}
