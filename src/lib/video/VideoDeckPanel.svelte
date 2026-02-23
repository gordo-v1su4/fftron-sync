<script lang="ts">
  import { onDestroy } from 'svelte';
  import TimelinePanel from '$lib/timeline/TimelinePanel.svelte';
  import { activeSection, tempoState } from '$lib/stores/runtime';

  interface VideoClip {
    id: string;
    name: string;
    url: string;
    sizeMb: string;
  }

  let clips: VideoClip[] = [];
  let selectedClipId = '';
  let player: HTMLVideoElement | null = null;
  let status = 'Drop or upload clips to begin playback.';
  let duration = 0;
  let currentTime = 0;
  let autoSwitchEnabled = true;
  let quantizeMode: 'beat' | 'bar' = 'beat';
  let lastQuantizeSlot = -1;
  let pendingSeekRatio: number | null = null;
  let resumeAfterSwitch = false;

  const makeId = (): string =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const selectedClip = (): VideoClip | undefined => clips.find((clip) => clip.id === selectedClipId);

  const selectClip = (id: string) => {
    selectedClipId = id;
    duration = 0;
    currentTime = 0;
    status = `Selected ${clips.find((clip) => clip.id === id)?.name ?? 'clip'}`;
  };

  const uploadClips = (event: Event) => {
    const files = Array.from((event.currentTarget as HTMLInputElement).files ?? []).filter((file) =>
      file.type.startsWith('video/')
    );

    if (!files.length) {
      status = 'No video files detected in selection.';
      return;
    }

    const added = files.map((file) => ({
      id: makeId(),
      name: file.name,
      url: URL.createObjectURL(file),
      sizeMb: (file.size / (1024 * 1024)).toFixed(1)
    }));

    clips = [...clips, ...added];
    if (!selectedClipId) selectedClipId = added[0].id;
    status = `Loaded ${added.length} clip${added.length > 1 ? 's' : ''}`;
  };

  const removeClip = (id: string) => {
    const clip = clips.find((entry) => entry.id === id);
    if (clip) URL.revokeObjectURL(clip.url);
    clips = clips.filter((entry) => entry.id !== id);
    if (selectedClipId === id) {
      selectedClipId = clips[0]?.id ?? '';
      duration = 0;
      currentTime = 0;
    }
  };

  const seekTo = (time: number) => {
    if (!player || !Number.isFinite(time)) return;
    player.currentTime = Math.max(0, Math.min(time, duration || time));
  };

  const getSlotDuration = (): number => {
    const bpm = Math.max(20, Math.min(300, $tempoState.bpm || 120));
    const beatDuration = 60 / bpm;
    return quantizeMode === 'bar' ? beatDuration * 4 : beatDuration;
  };

  const getTransportSlotIndex = (): number => {
    const slotDuration = getSlotDuration();
    if (!Number.isFinite(slotDuration) || slotDuration <= 0) return -1;
    const elapsedSeconds = Math.max(0, (Date.now() - $tempoState.downbeatEpochMs) / 1000);
    return Math.floor(elapsedSeconds / slotDuration);
  };

  const queueQuantizedSwitch = (slotIndex: number) => {
    if (clips.length < 2 || !selectedClipId) return;
    const currentIndex = clips.findIndex((clip) => clip.id === selectedClipId);
    if (currentIndex < 0) return;

    const nextIndex = (currentIndex + 1) % clips.length;
    pendingSeekRatio = duration > 0 ? currentTime / duration : 0;
    resumeAfterSwitch = Boolean(player && !player.paused);
    selectedClipId = clips[nextIndex].id;
    status = `Quantized ${quantizeMode} switch: ${clips[nextIndex].name} (slot ${slotIndex})`;
  };

  const maybeQuantizedSwitch = () => {
    if (!autoSwitchEnabled || !player || player.paused || clips.length < 2) return;
    const slotIndex = getTransportSlotIndex();
    if (slotIndex > lastQuantizeSlot) {
      if (lastQuantizeSlot >= 0) {
        queueQuantizedSwitch(slotIndex);
      }
      lastQuantizeSlot = slotIndex;
    }
  };

  const setQuantizeMode = (mode: 'beat' | 'bar') => {
    quantizeMode = mode;
    lastQuantizeSlot = -1;
    status = `Quantized switching set to ${mode}`;
  };

  const toggleAutoSwitch = () => {
    autoSwitchEnabled = !autoSwitchEnabled;
    lastQuantizeSlot = -1;
    status = autoSwitchEnabled ? `Auto-switch enabled (${quantizeMode})` : 'Auto-switch disabled';
  };

  const play = async () => {
    if (!player) return;
    lastQuantizeSlot = getTransportSlotIndex();
    await player.play();
    status = `Playing ${selectedClip()?.name ?? 'clip'} in ${$activeSection}`;
  };

  const pause = () => {
    player?.pause();
    status = 'Paused';
  };

  const stop = () => {
    if (!player) return;
    player.pause();
    player.currentTime = 0;
    currentTime = 0;
    lastQuantizeSlot = -1;
    status = 'Stopped';
  };

  onDestroy(() => {
    for (const clip of clips) URL.revokeObjectURL(clip.url);
  });
</script>

<section class="deck-shell">
  <header class="deck-head">
    <h2>Video Deck</h2>
    <p>Upload clips, assign sections, and run quantized switching on beat or bar.</p>
  </header>

  <div class="deck-grid">
    <aside class="clip-bin">
      <label class="upload-btn" for="video-upload">Upload Clips</label>
      <input id="video-upload" type="file" accept="video/*" multiple on:change={uploadClips} />

      <div class="clip-list">
        {#if clips.length === 0}
          <p class="empty">No clips loaded</p>
        {:else}
          {#each clips as clip}
            <div class:active={clip.id === selectedClipId} class="clip-card">
              <button class="clip-pick" on:click={() => selectClip(clip.id)}>{clip.name}</button>
              <p>{clip.sizeMb} MB</p>
              <button class="clip-remove" on:click={() => removeClip(clip.id)}>Remove</button>
            </div>
          {/each}
        {/if}
      </div>
    </aside>

    <div class="player-shell">
      {#if selectedClip()}
        <video
          bind:this={player}
          src={selectedClip()?.url}
          controls
          playsinline
          on:loadedmetadata={() => {
            duration = player?.duration ?? 0;
            if (player && pendingSeekRatio !== null && duration > 0) {
              player.currentTime = Math.min(duration * pendingSeekRatio, Math.max(0, duration - 0.05));
              pendingSeekRatio = null;
            }
            if (player && resumeAfterSwitch) {
              void player.play();
              resumeAfterSwitch = false;
            }
          }}
          on:timeupdate={() => {
            currentTime = player?.currentTime ?? 0;
            maybeQuantizedSwitch();
          }}
        >
          <track kind="captions" srclang="en" label="Captions" src="data:text/vtt,WEBVTT" />
        </video>
      {:else}
        <div class="placeholder">Upload and select a video clip to start playback.</div>
      {/if}

      <div class="transport-row">
        <button on:click={play}>Play</button>
        <button on:click={pause}>Pause</button>
        <button on:click={stop}>Stop</button>
        <span>Section: {$activeSection}</span>
      </div>

      <TimelinePanel
        {duration}
        {currentTime}
        onSeek={seekTo}
        {autoSwitchEnabled}
        {quantizeMode}
        onToggleAutoSwitch={toggleAutoSwitch}
        onSetQuantizeMode={setQuantizeMode}
      />
      <p class="status">{status}</p>
    </div>
  </div>
</section>

<style>
  .deck-shell {
    border: 1px solid var(--border);
    border-radius: 0.6rem;
    padding: 0.65rem;
    background: rgba(15, 15, 16, 0.94);
  }

  .deck-head {
    margin-bottom: 0.55rem;
  }

  .deck-head h2 {
    margin: 0;
    font-size: 1.02rem;
  }

  .deck-head p {
    margin: 0.2rem 0 0;
    color: var(--muted);
    font-size: 0.76rem;
  }

  .deck-grid {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr);
    gap: 0.6rem;
  }

  .clip-bin {
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    padding: 0.45rem;
    background: var(--surface-0);
  }

  #video-upload {
    display: none;
  }

  .upload-btn {
    display: inline-block;
    width: 100%;
    text-align: center;
    height: 1.95rem;
    line-height: 1.85rem;
    padding: 0 0.65rem;
    border-radius: 0.42rem;
    background: var(--accent);
    border: 1px solid var(--accent);
    color: #1a1408;
    font-size: 0.78rem;
    font-weight: 700;
    cursor: pointer;
    margin-bottom: 0.45rem;
  }

  .clip-list {
    display: grid;
    gap: 0.3rem;
    max-height: 320px;
    overflow: auto;
  }

  .empty {
    color: var(--muted);
    margin: 0;
    font-size: 0.74rem;
  }

  .clip-card {
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    padding: 0.32rem;
    background: var(--surface-1);
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-areas:
      'pick remove'
      'meta remove';
    column-gap: 0.35rem;
    row-gap: 0.1rem;
  }

  .clip-card.active {
    border-color: var(--accent);
  }

  .clip-pick {
    grid-area: pick;
    border: none;
    background: transparent;
    color: var(--text);
    text-align: left;
    width: 100%;
    cursor: pointer;
    padding: 0;
    font-weight: 600;
    font-size: 0.76rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .clip-card p {
    grid-area: meta;
    margin: 0;
    color: var(--muted);
    font-size: 0.69rem;
  }

  .clip-remove {
    grid-area: remove;
    align-self: center;
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text);
    border-radius: 0.32rem;
    height: 1.42rem;
    padding: 0 0.4rem;
    cursor: pointer;
    font-size: 0.67rem;
  }

  .player-shell {
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    padding: 0.45rem;
    background: var(--surface-0);
    display: grid;
    gap: 0.45rem;
  }

  video,
  .placeholder {
    width: 100%;
    height: 260px;
    border-radius: 0.42rem;
    border: 1px solid var(--border);
    background: #09090a;
  }

  .placeholder {
    display: grid;
    place-items: center;
    color: var(--muted);
    text-align: center;
    padding: 1rem;
    font-size: 0.8rem;
  }

  .transport-row {
    display: flex;
    align-items: center;
    gap: 0.32rem;
    flex-wrap: wrap;
  }

  .transport-row button {
    height: 1.78rem;
    border-radius: 0.36rem;
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text);
    padding: 0 0.5rem;
    font-size: 0.73rem;
    font-weight: 600;
    cursor: pointer;
  }

  .transport-row span {
    color: var(--muted);
    font-size: 0.73rem;
  }

  .status {
    margin: 0;
    color: var(--accent-ok);
    font-size: 0.73rem;
  }

  @media (max-width: 1100px) {
    .deck-grid {
      grid-template-columns: 1fr;
    }

    video,
    .placeholder {
      height: 230px;
    }
  }
</style>
