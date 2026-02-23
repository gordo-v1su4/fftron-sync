<script lang="ts">
  import TransportControlPanel from '$lib/engine/TransportControlPanel.svelte';
  import ReactiveStage from '$lib/rendering/ReactiveStage.svelte';
  import TheatreAuthoringPanel from '$lib/timeline-authoring/TheatreAuthoringPanel.svelte';
  import VideoDeckPanel from '$lib/video/VideoDeckPanel.svelte';
</script>

<main>
  <h1>Reactive Auto-Editor Console</h1>
  <p>Desktop-first live engine: Rust clock authority, Theatre authoring, quantized execution.</p>

  <div class="workspace">
    <aside class="sidebar">
      <TransportControlPanel />
      <TheatreAuthoringPanel />
    </aside>

    <section class="main-pane">
      <VideoDeckPanel />
      <ReactiveStage />
    </section>
  </div>
</main>

<style>
  main {
    max-width: 1200px;
    margin: 0 auto;
    padding: 1.25rem;
  }

  h1 {
    margin: 0 0 0.25rem;
  }

  p {
    margin: 0 0 1rem;
    color: #93a6bf;
  }

  .workspace {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
  }

  .sidebar,
  .main-pane {
    display: grid;
    gap: 1rem;
  }

  @media (min-width: 1024px) {
    .workspace {
      grid-template-columns: minmax(300px, 380px) minmax(0, 1fr);
      align-items: start;
    }

    .sidebar {
      position: sticky;
      top: 1rem;
    }
  }
</style>
