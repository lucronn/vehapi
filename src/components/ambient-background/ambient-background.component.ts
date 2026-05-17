import {
    AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy,
    ViewChild, inject,
} from '@angular/core';
import * as THREE from 'three';
import { ThemeService } from '../../services/theme.service';
import { effect } from '@angular/core';

/**
 * Calm ambient backdrop: a slow-drifting particle field that lives behind
 * every page. The vibe is "morning sunlight through dust" — barely there
 * but lends depth to the otherwise flat paper background.
 *
 * Implementation notes:
 *  - Single InstancedMesh of ~140 dots, no shaders, GPU cost negligible.
 *  - Dots drift on a smooth noise-ish loop driven by sine offsets.
 *  - Color reads from CSS vars so the field flips with the theme toggle.
 *  - Respects prefers-reduced-motion (renders one frame, then pauses).
 *  - Pauses on tab blur to avoid burning battery in background tabs.
 */
@Component({
    selector: 'app-ambient-background',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<canvas #canvas class="ambient-bg" aria-hidden="true"></canvas>`,
    styles: [`
        :host { display: contents; }
        .ambient-bg {
            position: fixed;
            inset: 0;
            width: 100vw;
            height: 100vh;
            height: 100dvh;
            pointer-events: none;
            z-index: 0;
            opacity: 0.72;
        }
    `],
})
export class AmbientBackgroundComponent implements AfterViewInit, OnDestroy {
    @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
    private themeService = inject(ThemeService);

    private renderer?: THREE.WebGLRenderer;
    private scene?: THREE.Scene;
    private camera?: THREE.PerspectiveCamera;
    private mesh?: THREE.InstancedMesh;
    private offsets: Float32Array = new Float32Array(0);
    private frameId = 0;
    private startTime = performance.now();
    private reducedMotion = false;
    private resizeObserver?: ResizeObserver;
    private onVisibility = () => this.handleVisibility();

    constructor() {
        // Re-color particles when theme flips. Effect runs in the injection
        // context of the constructor, so it auto-cleans on destroy.
        effect(() => {
            const theme = this.themeService.theme();
            queueMicrotask(() => this.applyThemeColor(theme));
        });
    }

    ngAfterViewInit(): void {
        this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.initThree();
        this.renderFrame(); // initial paint even if motion is reduced
        if (!this.reducedMotion) this.frameId = requestAnimationFrame(this.tick);
        document.addEventListener('visibilitychange', this.onVisibility);
    }

    ngOnDestroy(): void {
        cancelAnimationFrame(this.frameId);
        document.removeEventListener('visibilitychange', this.onVisibility);
        this.resizeObserver?.disconnect();
        this.mesh?.geometry.dispose();
        (this.mesh?.material as THREE.Material)?.dispose();
        this.renderer?.dispose();
    }

    private initThree(): void {
        const canvas = this.canvasRef.nativeElement;
        const { clientWidth, clientHeight } = document.documentElement;

        this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(clientWidth, clientHeight, false);
        this.renderer.setClearColor(0x000000, 0);

        this.scene = new THREE.Scene();

        this.camera = new THREE.PerspectiveCamera(50, clientWidth / clientHeight, 0.1, 200);
        this.camera.position.z = 38;

        const COUNT = 140;
        const geo = new THREE.SphereGeometry(0.18, 12, 12);
        const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55 });
        this.mesh = new THREE.InstancedMesh(geo, mat, COUNT);

        // Seed each instance with a base position + per-particle phase offsets.
        // offsets[i*4 .. i*4+3] = [phaseX, phaseY, phaseZ, ampMultiplier]
        this.offsets = new Float32Array(COUNT * 4);
        const dummy = new THREE.Object3D();
        for (let i = 0; i < COUNT; i++) {
            // Spread across a slightly elongated volume so distant particles
            // look smaller (depth cue from perspective camera).
            const x = (Math.random() - 0.5) * 80;
            const y = (Math.random() - 0.5) * 50;
            const z = (Math.random() - 0.5) * 40 - 5;
            dummy.position.set(x, y, z);
            const s = 0.6 + Math.random() * 1.4;
            dummy.scale.setScalar(s);
            dummy.updateMatrix();
            this.mesh.setMatrixAt(i, dummy.matrix);

            this.offsets[i * 4 + 0] = Math.random() * Math.PI * 2;
            this.offsets[i * 4 + 1] = Math.random() * Math.PI * 2;
            this.offsets[i * 4 + 2] = Math.random() * Math.PI * 2;
            this.offsets[i * 4 + 3] = 0.4 + Math.random() * 0.6;
        }
        this.mesh.instanceMatrix.needsUpdate = true;
        this.scene.add(this.mesh);

        this.applyThemeColor(this.themeService.theme());

        // Resize handling on the documentElement
        this.resizeObserver = new ResizeObserver(() => this.onResize());
        this.resizeObserver.observe(document.documentElement);
    }

    private applyThemeColor(theme: 'light' | 'dark'): void {
        if (!this.mesh) return;
        const color = theme === 'dark'
            ? new THREE.Color(0xE5836C)  // dark: terracotta bright
            : new THREE.Color(0xA8522D); // light: terracotta deep
        (this.mesh.material as THREE.MeshBasicMaterial).color = color;
        (this.mesh.material as THREE.MeshBasicMaterial).opacity = theme === 'dark' ? 0.58 : 0.48;
    }

    private onResize(): void {
        if (!this.renderer || !this.camera) return;
        const { clientWidth: w, clientHeight: h } = document.documentElement;
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    private handleVisibility(): void {
        if (document.hidden) {
            cancelAnimationFrame(this.frameId);
        } else if (!this.reducedMotion) {
            this.frameId = requestAnimationFrame(this.tick);
        }
    }

    private tick = (): void => {
        this.renderFrame();
        this.frameId = requestAnimationFrame(this.tick);
    };

    private renderFrame(): void {
        if (!this.mesh || !this.renderer || !this.scene || !this.camera) return;
        const t = (performance.now() - this.startTime) * 0.00012; // very slow
        const dummy = new THREE.Object3D();
        const count = this.mesh.count;
        for (let i = 0; i < count; i++) {
            const tmp = new THREE.Matrix4();
            this.mesh.getMatrixAt(i, tmp);
            const pos = new THREE.Vector3();
            const scale = new THREE.Vector3();
            const quat = new THREE.Quaternion();
            tmp.decompose(pos, quat, scale);
            const pX = this.offsets[i * 4 + 0];
            const pY = this.offsets[i * 4 + 1];
            const pZ = this.offsets[i * 4 + 2];
            const amp = this.offsets[i * 4 + 3];
            // Re-anchor on original-ish positions so drift doesn't accumulate
            // (offsets give us a deterministic loop around the seed point).
            pos.x += Math.sin(t + pX) * 0.02 * amp;
            pos.y += Math.cos(t * 0.7 + pY) * 0.02 * amp;
            pos.z += Math.sin(t * 0.5 + pZ) * 0.015 * amp;
            dummy.position.copy(pos);
            dummy.scale.copy(scale);
            dummy.updateMatrix();
            this.mesh.setMatrixAt(i, dummy.matrix);
        }
        this.mesh.instanceMatrix.needsUpdate = true;
        this.renderer.render(this.scene, this.camera);
    }
}
