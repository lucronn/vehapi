import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  effect,
  inject,
} from '@angular/core';
import * as THREE from 'three';
import { FocusDepthService } from '../../services/focus-depth.service';
import { ThemeService } from '../../services/theme.service';

/**
 * Deep-space backdrop with reactive particle “electrons” when any focused overlay is open.
 * Visual only (pointer-events: none). Lives inside app <main> at z-90 so route
 * modals (z-100+) paint above; command palette (z-200) is also inside main.
 */
@Component({
  selector: 'app-focus-depth-backdrop',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="focus-depth-root" [class.is-active]="depth.active()" aria-hidden="true">
      <div class="focus-depth-veil"></div>
      <canvas #canvas class="focus-depth-canvas"></canvas>
    </div>
  `,
  styles: [`
    :host { display: contents; }

    .focus-depth-root {
      position: fixed;
      inset: 0;
      z-index: 90;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.4s cubic-bezier(0.22, 1, 0.36, 1);
    }

    .focus-depth-root.is-active {
      opacity: 1;
    }

    .focus-depth-veil {
      position: absolute;
      inset: 0;
      background:
        radial-gradient(ellipse 70% 55% at 50% 38%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 60%),
        radial-gradient(ellipse 140% 100% at 50% 110%, color-mix(in srgb, var(--ink) 98%, #020205), transparent 70%),
        radial-gradient(circle at 50% 50%, transparent 30%, color-mix(in srgb, var(--ink) 55%, transparent) 80%),
        color-mix(in srgb, var(--ink) 80%, transparent);
      backdrop-filter: blur(20px) saturate(0.78);
      -webkit-backdrop-filter: blur(20px) saturate(0.78);
    }

  [data-theme="light"] .focus-depth-veil {
      background:
        radial-gradient(ellipse 70% 55% at 50% 38%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 60%),
        radial-gradient(ellipse 140% 100% at 50% 110%, color-mix(in srgb, var(--ink) 35%, var(--paper)), transparent 72%),
        radial-gradient(circle at 50% 50%, transparent 28%, color-mix(in srgb, var(--ink) 22%, transparent) 78%),
        color-mix(in srgb, var(--ink) 42%, transparent);
    }

    .focus-depth-canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }
  `],
})
export class FocusDepthBackdropComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  readonly depth = inject(FocusDepthService);
  private readonly themeService = inject(ThemeService);

  private renderer?: THREE.WebGLRenderer;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private fieldMesh?: THREE.InstancedMesh;
  private electronMesh?: THREE.InstancedMesh;
  private fieldOffsets = new Float32Array(0);
  private fieldSeeds: THREE.Vector3[] = [];
  private electronOffsets = new Float32Array(0);
  private electronSeeds: THREE.Vector3[] = [];
  private frameId = 0;
  private startTime = performance.now();
  private reducedMotion = false;
  private resizeObserver?: ResizeObserver;
  private pointerMove?: (e: MouseEvent) => void;

  constructor() {
    effect(() => {
      this.themeService.theme();
      queueMicrotask(() => this.applyTheme());
    });

    effect(() => {
      const on = this.depth.active();
      if (on && !this.reducedMotion) {
        cancelAnimationFrame(this.frameId);
        this.frameId = requestAnimationFrame(this.tick);
      } else if (!on) {
        cancelAnimationFrame(this.frameId);
      }
    });

    effect(() => {
      if (!this.depth.active()) return;
      const onPointer = (e: MouseEvent | TouchEvent) => {
        const pt = 'touches' in e ? e.touches[0] : e;
        if (!pt) return;
        this.depth.setPointer(pt.clientX / window.innerWidth, pt.clientY / window.innerHeight);
      };
      this.pointerMove = onPointer as (e: MouseEvent) => void;
      window.addEventListener('mousemove', onPointer, { passive: true });
      window.addEventListener('touchmove', onPointer, { passive: true });
      return () => {
        window.removeEventListener('mousemove', onPointer);
        window.removeEventListener('touchmove', onPointer);
      };
    });
  }

  ngAfterViewInit(): void {
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.initThree();
    this.applyTheme();
    if (this.depth.active() && !this.reducedMotion) {
      this.frameId = requestAnimationFrame(this.tick);
    }
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.frameId);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.resizeObserver?.disconnect();
    this.disposeMesh(this.fieldMesh);
    this.disposeMesh(this.electronMesh);
    this.renderer?.dispose();
  }

  private disposeMesh(mesh?: THREE.InstancedMesh): void {
    if (!mesh) return;
    mesh.geometry.dispose();
    (mesh.material as THREE.Material)?.dispose();
  }

  private onVisibility = (): void => {
    if (document.hidden || !this.depth.active()) {
      cancelAnimationFrame(this.frameId);
    } else if (!this.reducedMotion) {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private initThree(): void {
    const canvas = this.canvasRef.nativeElement;
    const w = document.documentElement.clientWidth;
    const h = document.documentElement.clientHeight;

    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, w / h, 0.1, 400);
    this.camera.position.z = 60;

    // Atmospheric fog gives true depth recession — far instances dissolve.
    // Color is set in applyTheme() so it matches paper/ink.
    this.scene.fog = new THREE.FogExp2(0x16110a, 0.012);

    this.fieldMesh = this.createFieldMesh(220, 0.18, 0.55);
    this.electronMesh = this.createFieldMesh(60, 0.09, 0.98, true);
    this.scene.add(this.fieldMesh);
    this.scene.add(this.electronMesh);

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(document.documentElement);
  }

  private createFieldMesh(count: number, radius: number, opacity: number, electrons = false): THREE.InstancedMesh {
    const geo = new THREE.SphereGeometry(radius, 10, 10);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const offsets = new Float32Array(count * 4);
    const dummy = new THREE.Object3D();
    const seeds: THREE.Vector3[] = [];

    for (let i = 0; i < count; i++) {
      // Wider lateral spread + deep z volume creates true atmospheric recession.
      // Electrons stay forward; field particles bias backward into the fog.
      const x = (Math.random() - 0.5) * 160;
      const y = (Math.random() - 0.5) * 100;
      const z = electrons
        ? (Math.random() - 0.5) * 50 + 5
        : Math.pow(Math.random(), 0.7) * -180 + 10;
      seeds.push(new THREE.Vector3(x, y, z));
      dummy.position.set(x, y, z);
      const depthScale = electrons ? 1 : 1 + Math.max(0, -z) * 0.012;
      const s = electrons
        ? 0.35 + Math.random() * 0.55
        : (0.55 + Math.random() * 1.4) * depthScale;
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      offsets[i * 4] = Math.random() * Math.PI * 2;
      offsets[i * 4 + 1] = Math.random() * Math.PI * 2;
      offsets[i * 4 + 2] = Math.random() * Math.PI * 2;
      offsets[i * 4 + 3] = 0.35 + Math.random() * 0.65;
    }
    mesh.instanceMatrix.needsUpdate = true;

    if (electrons) {
      this.electronOffsets = offsets;
      this.electronSeeds = seeds;
    } else {
      this.fieldOffsets = offsets;
      this.fieldSeeds = seeds;
    }
    return mesh;
  }

  private applyTheme(): void {
    const dark = this.themeService.theme() === 'dark';
    const fieldColor = dark ? new THREE.Color(0xe5836c) : new THREE.Color(0xa8522d);
    const electronColor = dark ? new THREE.Color(0xffb89e) : new THREE.Color(0xc4683f);
    const fogColor = dark ? 0x0c0805 : 0x1a140b;

    if (this.scene?.fog && this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.setHex(fogColor);
      this.scene.fog.density = dark ? 0.013 : 0.015;
    }

    if (this.fieldMesh) {
      const m = this.fieldMesh.material as THREE.MeshBasicMaterial;
      m.color = fieldColor;
      m.opacity = dark ? 0.42 : 0.32;
      m.fog = true;
    }
    if (this.electronMesh) {
      const m = this.electronMesh.material as THREE.MeshBasicMaterial;
      m.color = electronColor;
      m.opacity = dark ? 0.9 : 0.78;
      m.fog = true;
    }
  }

  private onResize(): void {
    if (!this.renderer || !this.camera) return;
    const w = document.documentElement.clientWidth;
    const h = document.documentElement.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private tick = (): void => {
    if (!this.depth.active()) return;
    this.renderFrame();
    this.frameId = requestAnimationFrame(this.tick);
  };

  private renderFrame(): void {
    if (!this.renderer || !this.scene || !this.camera) return;
    const t = (performance.now() - this.startTime) * 0.00015;
    const ptr = this.depth.pointer();
    const mx = (ptr.x - 0.5) * 90;
    const my = (0.5 - ptr.y) * 55;

    this.updateMesh(this.fieldMesh, this.fieldOffsets, this.fieldSeeds, t, mx, my, 0.028, 0.0018);
    this.updateMesh(this.electronMesh, this.electronOffsets, this.electronSeeds, t, mx, my, 0.06, 0.022);

    // Stronger camera parallax — pointer moves the viewer through the volume,
    // not just panning a flat plane.
    this.camera.position.x += (mx * 0.18 - this.camera.position.x) * 0.05;
    this.camera.position.y += (my * 0.18 - this.camera.position.y) * 0.05;
    this.camera.lookAt(0, 0, -40);

    this.renderer.render(this.scene, this.camera);
  }

  private updateMesh(
    mesh: THREE.InstancedMesh | undefined,
    offsets: Float32Array,
    seeds: THREE.Vector3[],
    t: number,
    mx: number,
    my: number,
    drift: number,
    mousePull: number,
  ): void {
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const count = mesh.count;
    for (let i = 0; i < count; i++) {
      const tmp = new THREE.Matrix4();
      mesh.getMatrixAt(i, tmp);
      const pos = new THREE.Vector3();
      const scale = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      tmp.decompose(pos, quat, scale);

      pos.copy(seeds[i] ?? pos);

      const pX = offsets[i * 4];
      const pY = offsets[i * 4 + 1];
      const pZ = offsets[i * 4 + 2];
      const amp = offsets[i * 4 + 3];

      pos.x += Math.sin(t * 1.1 + pX) * drift * amp;
      pos.y += Math.cos(t * 0.85 + pY) * drift * amp;
      pos.z += Math.sin(t * 0.6 + pZ) * drift * 0.7 * amp;

      pos.x += (mx - pos.x) * mousePull;
      pos.y += (my - pos.y) * mousePull;

      dummy.position.copy(pos);
      dummy.scale.copy(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
}
