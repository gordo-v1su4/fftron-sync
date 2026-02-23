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
  <p class="meta">Design-time only: exported cues compile into Rust quantized runtime.</p>
  <div class="row">
    <button class="emph" on:click={loadBundle}>Import Starter Bundle</button>
    <button on:click={() => setSection('verse-a')}>Activate Verse A</button>
    <button on:click={() => setSection('chorus-a')}>Activate Chorus A</button>
  </div>
  <p class="status">{status}</p>
</section>

<style>
  .panel {
    border: 1px solid var(--border);
    border-radius: 0.6rem;
    padding: 0.65rem;
    background: rgba(15, 15, 16, 0.94);
  }

  h2 {
    margin: 0 0 0.35rem;
    font-size: 0.98rem;
  }

  .meta {
    margin: 0 0 0.45rem;
    font-size: 0.74rem;
    color: var(--muted);
  }

  .row {
    display: flex;
    gap: 0.32rem;
    flex-wrap: wrap;
  }

  button {
    height: 1.9rem;
    border: 1px solid var(--border);
    border-radius: 0.42rem;
    background: var(--surface-2);
    color: var(--text);
    padding: 0 0.52rem;
    font: inherit;
    font-size: 0.76rem;
    font-weight: 600;
    cursor: pointer;
  }

  button.emph {
    border-color: var(--accent);
    background: var(--accent);
    color: #1a1408;
  }

  .status {
    color: var(--accent-ok);
    margin-top: 0.45rem;
    margin-bottom: 0;
    font-size: 0.74rem;
  }

  .project {
    color: var(--accent-strong);
    margin-top: 0;
    margin-bottom: 0.3rem;
    font-size: 0.76rem;
  }
</style>
