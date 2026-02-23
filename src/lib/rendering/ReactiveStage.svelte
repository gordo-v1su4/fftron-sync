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
    border: 1px solid #3b3f4a;
    border-radius: 0.75rem;
    padding: 1rem;
    background: rgba(10, 14, 24, 0.6);
  }

  .canvas-wrap {
    width: 100%;
    height: 360px;
    margin-top: 0.75rem;
    border-radius: 0.6rem;
    overflow: hidden;
    border: 1px solid #223;
  }
</style>
