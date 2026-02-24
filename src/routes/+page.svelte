<script lang="ts">
  import AudioReactivePanel from '$lib/audio/AudioReactivePanel.svelte';
  import TransportControlPanel from '$lib/engine/TransportControlPanel.svelte';
  import ReactiveStage from '$lib/rendering/ReactiveStage.svelte';
  import TheatreAuthoringPanel from '$lib/timeline-authoring/TheatreAuthoringPanel.svelte';
  import VideoDeckPanel from '$lib/video/VideoDeckPanel.svelte';
</script>

<main>
  <header class="app-head">
    <div>
      <h1>Reactive Auto-Editor Console</h1>
      <p>Desktop-first live engine: Rust clock authority, Theatre authoring, quantized execution.</p>
    </div>
  </header>

  <div class="workspace">
    <aside class="sidebar">
      <TransportControlPanel />
      <TheatreAuthoringPanel />
    </aside>

    <section class="main-pane">
      <AudioReactivePanel />
      <div class="content-grid">
        <VideoDeckPanel />
        <ReactiveStage />
      </div>
    </section>
  </div>
</main>

<style>
  main {
    max-width: 1400px;
    margin: 0 auto;
    padding: 0.55rem;
  }

  .app-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.45rem;
  }

  h1 {
    margin: 0 0 0.12rem;
    font-size: 1.8rem;
    letter-spacing: -0.01em;
  }

  p {
    margin: 0;
    color: var(--muted);
    font-size: 0.8rem;
  }

  .workspace {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.65rem;
  }

  .sidebar,
  .main-pane,
  .content-grid {
    display: grid;
    gap: 0.65rem;
  }

  .content-grid {
    grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.8fr);
  }

  @media (min-width: 1024px) {
    .workspace {
      grid-template-columns: minmax(230px, 275px) minmax(0, 1fr);
      align-items: start;
    }

    .sidebar {
      position: sticky;
      top: 0.55rem;
    }
  }

  @media (max-width: 1180px) {
    .content-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
