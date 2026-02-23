<script lang="ts">
  import { onMount } from 'svelte';
  import { activeSection, markers } from '$lib/stores/runtime';
  import { activateTimelineSection, importTheatreBundle, listTimelineMarkers, validateTheatreBundle } from '$lib/tauri/commands';
  import { buildStarterBundle, ensureTheatreAuthoringContext } from './theatre';

  let status = 'Idle';
  let theatreProjectId = '';

  onMount(() => {
    void (async () => {
      try {
        const context = await ensureTheatreAuthoringContext();
        theatreProjectId = context.projectId;
        status = `Theatre authoring context ready (${context.projectId})`;
      } catch (error) {
        status = `Theatre init failed: ${error instanceof Error ? error.message : 'unknown error'}`;
      }
    })();
  });

  const loadBundle = async () => {
    try {
      const bundle = buildStarterBundle();
      const isValid = await validateTheatreBundle(bundle);
      if (!isValid) {
        status = 'Bundle rejected by Rust validator';
        return;
      }

      const loaded = await importTheatreBundle(bundle);
      status = `Imported ${loaded} cue markers`;
      markers.set(await listTimelineMarkers());
    } catch (error) {
      status = `Import unavailable in web preview: ${error instanceof Error ? error.message : 'unknown error'}`;
    }
  };

  const setSection = async (section: string) => {
    try {
      const count = await activateTimelineSection(section);
      activeSection.set(section);
      markers.set(await listTimelineMarkers(section));
      status = `Section ${section} active (${count} markers)`;
    } catch (error) {
      status = `Section activation unavailable in web preview: ${error instanceof Error ? error.message : 'unknown error'}`;
    }
  };
</script>

<section class="panel">
  <h2>Theatre.js Authoring Bridge</h2>
  <p class="project">Project: {theatreProjectId || 'loading...'}</p>
  <p>Design-time only: exports compile to Rust quantized scheduling runtime.</p>
  <div class="row">
    <button on:click={loadBundle}>Import Starter Theatre Bundle</button>
    <button on:click={() => setSection('verse-a')}>Activate Verse A</button>
    <button on:click={() => setSection('chorus-a')}>Activate Chorus A</button>
  </div>
  <p class="status">{status}</p>
</section>

<style>
  .panel {
    border: 1px solid #3f3f46;
    border-radius: 0.75rem;
    padding: 1rem;
    background: rgba(10, 10, 11, 0.9);
    backdrop-filter: blur(8px);
  }

  .row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  button {
    border: 1px solid #f59e0b;
    border-radius: 0.5rem;
    background: #f59e0b;
    color: #1c1917;
    padding: 0.6rem 0.8rem;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .status {
    color: #10b981;
    margin-top: 0.75rem;
  }

  .project {
    color: #fbbf24;
    margin-top: 0;
    margin-bottom: 0.4rem;
  }
</style>
