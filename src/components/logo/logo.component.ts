import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, ViewChild, effect, inject, afterNextRender } from '@angular/core';
import * as THREE from 'three';

@Component({
  selector: 'app-logo',
  template: `<canvas #canvas class="w-full h-full block"></canvas>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LogoComponent implements OnDestroy {
  @ViewChild('canvas', { static: true }) private canvasRef!: ElementRef<HTMLCanvasElement>;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private mesh!: THREE.Mesh;
  private frameId: number | null = null;
  private elRef = inject(ElementRef);

  constructor() {
    afterNextRender(() => {
        this.initThree();
        this.animate();

        const resizeObserver = new ResizeObserver(() => this.onResize());
        resizeObserver.observe(this.elRef.nativeElement);
    });
  }

  private initThree(): void {
    this.scene = new THREE.Scene();
    
    const container = this.elRef.nativeElement;
    const width = container.clientWidth;
    const height = container.clientHeight;

    this.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    this.camera.position.z = 2.5;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvasRef.nativeElement,
      antialias: true,
      alpha: true,
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);

    const geometry = new THREE.TorusKnotGeometry(0.8, 0.25, 100, 16);
    const material = new THREE.MeshStandardMaterial({
      color: 0x00ffff,
      metalness: 0.8,
      roughness: 0.2,
      emissive: 0x080808,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.scene.add(this.mesh);

    const pointLight1 = new THREE.PointLight(0x00ffff, 30, 100);
    pointLight1.position.set(5, 5, 5);
    this.scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(0xff00ff, 30, 100);
    pointLight2.position.set(-5, -5, -5);
    this.scene.add(pointLight2);
    
    const ambientLight = new THREE.AmbientLight(0x404040, 2);
    this.scene.add(ambientLight);
  }

  private animate = (): void => {
    this.frameId = requestAnimationFrame(this.animate);

    if (this.mesh) {
      this.mesh.rotation.x += 0.002;
      this.mesh.rotation.y += 0.005;
    }

    this.renderer.render(this.scene, this.camera);
  };

  private onResize(): void {
    const container = this.elRef.nativeElement;
    if (container && this.renderer) {
        const width = container.clientWidth;
        const height = container.clientHeight;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }
  }

  ngOnDestroy(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
    }
    if (this.renderer) {
      this.renderer.dispose();
    }
  }
}
