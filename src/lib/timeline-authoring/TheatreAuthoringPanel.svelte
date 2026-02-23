<script lang="ts">
  import { onMount } from 'svelte';
  import { activeSection, markers } from '$lib/stores/runtime';
  import { activateTimelineSection, importTheatreBundle, listTimelineMarkers, validateTheatreBundle } from '$lib/tauri/commands';
  import { buildStarterBundle, ensureTheatreAuthoringContext } from './theatre';

  let status = 'Idle';
  let theatreProjectId = '';

  onMount(() => {
    const context = ensureTheatreAuthoringContext();
    theatreProjectId = context.projectId;
    status = `Theatre authoring context ready (${context.projectId})`;
  });

  const loadBundle = async () => {
    const bundle = buildStarterBundle();
    const isValid = await validateTheatreBundle(bundle);
    if (!isValid) {
      status = 'Bundle rejected by Rust validator';
      return;
    }

    const loaded = await importTheatreBundle(bundle);
    status = `Imported ${loaded} cue markers`;
    markers.set(await listTimelineMarkers());
  };

  const setSection = async (section: string) => {
    const count = await activateTimelineSection(section);
    activeSection.set(section);
    markers.set(await listTimelineMarkers(section));
    status = `Section ${section} active (${count} markers)`;
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
    border: 1px solid #3b3f4a;
    border-radius: 0.75rem;
    padding: 1rem;
    background: rgba(10, 14, 24, 0.6);
    backdrop-filter: blur(8px);
  }

  .row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  button {
    border: none;
    border-radius: 0.5rem;
    background: #1f6feb;
    color: white;
    padding: 0.6rem 0.8rem;
    font: inherit;
    cursor: pointer;
  }

  .status {
    color: #9fb7ff;
    margin-top: 0.75rem;
  }

  .project {
    color: #67d4ad;
    margin-top: 0;
    margin-bottom: 0.4rem;
  }
</style>
