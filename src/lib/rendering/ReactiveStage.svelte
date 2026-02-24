<script lang="ts">
  import { onMount } from 'svelte';
  import * as THREE from 'three';
  import { activeSection, audioBands, markers } from '$lib/stores/runtime';

  let canvasWrap: HTMLDivElement | null = null;
  let markerCount = 0;
  $: markerCount = $markers.length;

  onMount(() => {
    if (!canvasWrap) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b0b0c');

    const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 100);
    camera.position.set(0, 0, 5.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    canvasWrap.appendChild(renderer.domElement);

    const geometry = new THREE.BoxGeometry(1.5, 1.5, 1.5);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uEnvA: { value: 0 },
        uEnvB: { value: 0 },
        uPeak: { value: 0 },
        uLow: { value: 0 },
        uHigh: { value: 0 }
      },
      vertexShader: `
        varying vec2 vUv;
        uniform float uTime;
        uniform float uEnvA;
        uniform float uEnvB;

        void main() {
          vUv = uv;
          vec3 p = position;
          p += normal * (0.07 * uEnvA + 0.04 * sin(uTime * 1.4 + position.y * 3.2) * uEnvB);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uTime;
        uniform float uEnvA;
        uniform float uEnvB;
        uniform float uPeak;
        uniform float uLow;
        uniform float uHigh;

        void main() {
          vec2 uv = vUv * 2.0 - 1.0;
          float radial = length(uv);
          float pulse = 0.5 + 0.5 * sin(uTime * 2.6 + radial * 10.0);
          float edge = smoothstep(0.96, 0.25, radial);

          vec3 base = mix(vec3(0.24, 0.30, 0.27), vec3(0.95, 0.62, 0.08), uEnvA * 0.75);
          vec3 reactive = vec3(uLow * 0.34, uEnvB * 0.45, uHigh * 0.52);
          vec3 color = base + reactive * pulse * edge;
          color += vec3(0.0, 0.24, 0.13) * uPeak;

          gl_FragColor = vec4(color, 1.0);
        }
      `
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    const resize = () => {
      if (!canvasWrap) return;
      const width = Math.max(1, canvasWrap.clientWidth);
      const height = Math.max(1, canvasWrap.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvasWrap);

    const clock = new THREE.Clock();
    let rafId = 0;

    const loop = () => {
      rafId = requestAnimationFrame(loop);

      const elapsed = clock.getElapsedTime();
      const envA = $audioBands.envelopeA;
      const envB = $audioBands.envelopeB;

      material.uniforms.uTime.value = elapsed;
      material.uniforms.uEnvA.value = envA;
      material.uniforms.uEnvB.value = envB;
      material.uniforms.uPeak.value = $audioBands.peak ? 1 : 0;
      material.uniforms.uLow.value = $audioBands.low;
      material.uniforms.uHigh.value = $audioBands.high;

      mesh.position.y = ($audioBands.low - 0.42) * 0.62;
      mesh.scale.setScalar(0.95 + envA * 1.08);
      mesh.rotation.x = 0.34 + $audioBands.mid * 0.92;
      mesh.rotation.y = 0.5 + $audioBands.high * 1.08;
      mesh.rotation.z = envB * 0.6;

      renderer.render(scene, camera);
    };

    loop();

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  });
</script>

<section class="stage-shell">
  <header>
    <h2>Reactive Stage</h2>
    <p>Backend: Three.js WebGL shader pipeline</p>
    <p>Section: {$activeSection} • Markers: {markerCount} • EnvA: {$audioBands.envelopeA.toFixed(2)}</p>
  </header>

  <div bind:this={canvasWrap} class="canvas-wrap"></div>
</section>

<style>
  .stage-shell {
    border: 1px solid var(--border);
    border-radius: 0.6rem;
    padding: 0.65rem;
    background: rgba(15, 15, 16, 0.94);
  }

  h2 {
    margin: 0 0 0.35rem;
    font-size: 1rem;
  }

  p {
    margin: 0 0 0.2rem;
    font-size: 0.74rem;
    color: var(--muted);
  }

  .canvas-wrap {
    width: 100%;
    height: 298px;
    margin-top: 0.45rem;
    border-radius: 0.45rem;
    overflow: hidden;
    border: 1px solid var(--border);
    background: var(--surface-0);
  }

  @media (max-width: 1180px) {
    .canvas-wrap {
      height: 220px;
    }
  }
</style>
