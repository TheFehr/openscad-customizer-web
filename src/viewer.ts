// Reusable Three.js viewer: scene/camera/lights/grid/OrbitControls/resize
// loop, plus loading OFF-derived parts (the worker's render output) and
// framing/centering them. Requires 'three' and 'three/addons/...' to be
// resolvable in the host page (typically via an <script type="importmap">
// pointing at a CDN, same as any other Three.js page).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { offToTrianglePositions } from './off-utils.js';
import type { RenderedPart } from './protocol.js';

const DEFAULT_COLOR = new THREE.Color(0.75, 0.75, 0.75);

export interface ViewerOptions {
  canvas: HTMLCanvasElement;
  backgroundColor?: number;
  /** Square build-plate outline/grid size in mm; omit for no bed. */
  bedSize?: number;
}

function disposeGroup(group: THREE.Object3D): void {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
    else mesh.material?.dispose();
  });
}

function offToMesh(offText: string, cssColor?: string | null): THREE.Mesh | null {
  const positions = offToTrianglePositions(offText);
  if (!positions) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2)); // Z-up -> Y-up (display only)

  const col = cssColor ? new THREE.Color().setStyle(cssColor) : DEFAULT_COLOR.clone();
  const mat = new THREE.MeshPhongMaterial({ color: col, flatShading: true, side: THREE.DoubleSide });
  return new THREE.Mesh(geo, mat);
}

export class Viewer {
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;

  private currentGroup: THREE.Object3D | null = null;
  private lastW = 0;
  private lastH = 0;

  constructor(opts: ViewerOptions) {
    this.canvas = opts.canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(opts.backgroundColor ?? 0x0d1117);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 20000);
    this.camera.position.set(30, 25, 35);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(30, 40, 20);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x8eb8ff, 0.3);
    fill.position.set(-20, -10, -25);
    this.scene.add(fill);

    if (opts.bedSize) {
      const bedSize = opts.bedSize;
      this.scene.add(new THREE.GridHelper(bedSize, Math.max(4, Math.round(bedSize / 16)), 0x21262d, 0x21262d));
      const half = bedSize / 2;
      const outline = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-half, 0, -half),
          new THREE.Vector3(half, 0, -half),
          new THREE.Vector3(half, 0, half),
          new THREE.Vector3(-half, 0, half),
        ]),
        new THREE.LineBasicMaterial({ color: 0x58a6ff, transparent: true, opacity: 0.6 }),
      );
      this.scene.add(outline);
    }

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 5000;

    this.animate();
  }

  private resize(): void {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w !== this.lastW || h !== this.lastH) {
      this.lastW = w; this.lastH = h;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / (h || 1);
      this.camera.updateProjectionMatrix();
    }
  }

  private animate(): void {
    requestAnimationFrame(() => this.animate());
    this.resize();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // Frames and displays any THREE.Object3D (a fresh Group from loadParts, or
  // an externally-loaded STL/3MF), replacing whatever was shown before.
  presentObject(object3d: THREE.Object3D): void {
    if (this.currentGroup) {
      this.scene.remove(this.currentGroup);
      disposeGroup(this.currentGroup);
    }

    const box = new THREE.Box3().setFromObject(object3d);
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    object3d.position.set(-centre.x, -box.min.y, -centre.z);

    this.scene.add(object3d);
    this.currentGroup = object3d;

    const d = Math.max(size.x, size.y, size.z, 1) * 2.2;
    this.camera.position.set(d * 0.8, d * 0.6, d);
    this.controls.target.set(0, size.y / 2, 0);
    this.controls.update();
  }

  loadParts(parts: RenderedPart[]): number {
    const group = new THREE.Group();
    for (const { off, color } of parts) {
      const mesh = offToMesh(off, color);
      if (mesh) group.add(mesh);
    }
    this.presentObject(group);
    return group.children.length;
  }
}
