<script lang="ts">
  import { Canvas } from '@threlte/core';
  import { T } from '@threlte/core';
  import { activeSection, canUseWebGpu, markers } from '$lib/stores/runtime';

  $: markerCount = $markers.length;
</script>

<section class="stage-shell">
  <header>
    <h2>Reactive Stage</h2>
    <p>Backend: {$canUseWebGpu ? 'WebGPU (feature-flag)' : 'WebGL2 (default)'}</p>
    <p>Section: {$activeSection} • Markers: {markerCount}</p>
  </header>

  <div class="canvas-wrap">
    <Canvas>
      <T.PerspectiveCamera makeDefault position={[0, 0, 5]} />
      <T.AmbientLight intensity={0.8} />
      <T.Mesh rotation={[0.4, 0.6, 0]}>
        <T.BoxGeometry args={[1.5, 1.5, 1.5]} />
        <T.MeshStandardMaterial color="#5dd6a2" metalness={0.2} roughness={0.35} />
      </T.Mesh>
    </Canvas>
  </div>
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
