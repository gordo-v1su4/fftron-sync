<script lang="ts">
  import { onDestroy } from 'svelte';
  import TimelinePanel from '$lib/timeline/TimelinePanel.svelte';
  import { activeSection, audioBands, reactiveEnvelope, tempoState } from '$lib/stores/runtime';

  interface VideoClip {
    id: string;
    name: string;
    url: string;
    sizeMb: string;
    lane: number;
    slot: number;
  }

  let clips: VideoClip[] = [];
  let selectedClipId = '';
  let player: HTMLVideoElement | null = null;
  let status = 'Drop or upload clips to begin playback.';
  let duration = 0;
  let currentTime = 0;
  let autoSwitchEnabled = true;
  let envelopeGateEnabled = true;
  let quantizeMode: 'beat' | 'bar' = 'beat';
  let lastQuantizeSlot = -1;
  let pendingSeekRatio: number | null = null;
  let resumeAfterSwitch = false;
  const matrixColumns = 14;
  let uploadLane = 0;
  let laneMuted = [false, false, false];
  let soloLane: number | null = null;

  const makeId = (): string =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const selectedClip = (): VideoClip | undefined => clips.find((clip) => clip.id === selectedClipId);
  const selectedClipIndex = (): number => clips.findIndex((clip) => clip.id === selectedClipId);
  const laneIsActive = (lane: number): boolean => (soloLane === null ? !laneMuted[lane] : soloLane === lane);
  const playableClips = (): VideoClip[] =>
    clips
      .filter((clip) => laneIsActive(clip.lane))
      .sort((a, b) => (a.lane === b.lane ? a.slot - b.slot : a.lane - b.lane));

  const ensurePlayableSelection = () => {
    const playable = playableClips();
    if (playable.length === 0) {
      selectedClipId = '';
      duration = 0;
      currentTime = 0;
      return;
    }
    if (!playable.some((clip) => clip.id === selectedClipId)) {
      selectedClipId = playable[0].id;
      duration = 0;
      currentTime = 0;
    }
  };

  const clipAtMatrix = (row: number, col: number): VideoClip | undefined => {
    if (clips.length === 0) return undefined;
    return clips.find((clip) => clip.lane === row && clip.slot === col);
  };

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

    const availableSlots = Array.from({ length: matrixColumns }, (_, slot) => slot).filter(
      (slot) => !clips.some((clip) => clip.lane === uploadLane && clip.slot === slot)
    );

    if (availableSlots.length === 0) {
      status = `Layer ${uploadLane + 1} is full. Remove clips or upload to another layer.`;
      return;
    }

    const acceptedFiles = files.slice(0, availableSlots.length);
    const droppedCount = files.length - acceptedFiles.length;
    const added = acceptedFiles.map((file, index) => ({
      id: makeId(),
      name: file.name,
      url: URL.createObjectURL(file),
      sizeMb: (file.size / (1024 * 1024)).toFixed(1),
      lane: uploadLane,
      slot: availableSlots[index]
    }));

    clips = [...clips, ...added].sort((a, b) => (a.lane === b.lane ? a.slot - b.slot : a.lane - b.lane));
    ensurePlayableSelection();
    if (!selectedClipId) selectedClipId = added[0].id;
    status = droppedCount
      ? `Loaded ${added.length} clip(s) to layer ${uploadLane + 1}. ${droppedCount} clip(s) skipped (layer full).`
      : `Loaded ${added.length} clip${added.length > 1 ? 's' : ''} to layer ${uploadLane + 1}`;
  };

  const removeClip = (id: string) => {
    const clip = clips.find((entry) => entry.id === id);
    if (clip) URL.revokeObjectURL(clip.url);
    clips = clips.filter((entry) => entry.id !== id);
    ensurePlayableSelection();
    if (selectedClipId === id) status = 'Selected clip removed. Switched to next active clip.';
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
    const playable = playableClips();
    if (playable.length < 2 || !selectedClipId) return;
    const currentIndex = playable.findIndex((clip) => clip.id === selectedClipId);
    if (currentIndex < 0) {
      selectedClipId = playable[0].id;
      return;
    }

    const nextIndex = (currentIndex + 1) % clips.length;
    pendingSeekRatio = duration > 0 ? currentTime / duration : 0;
    resumeAfterSwitch = Boolean(player && !player.paused);
    selectedClipId = playable[nextIndex].id;
    status = `Quantized ${quantizeMode} switch: ${playable[nextIndex].name} (slot ${slotIndex})`;
  };

  const maybeQuantizedSwitch = () => {
    if (!autoSwitchEnabled || !player || player.paused || playableClips().length < 2) return;
    const slotIndex = getTransportSlotIndex();
    if (slotIndex > lastQuantizeSlot) {
      const gateOpen = !envelopeGateEnabled || $audioBands.envelopeA > $reactiveEnvelope.threshold;
      if (lastQuantizeSlot >= 0 && gateOpen) {
        queueQuantizedSwitch(slotIndex);
      } else if (lastQuantizeSlot >= 0 && !gateOpen) {
        status = `Gate closed at slot ${slotIndex}: EnvA ${$audioBands.envelopeA.toFixed(2)} <= Thr ${$reactiveEnvelope.threshold.toFixed(2)}`;
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

  const toggleEnvelopeGate = () => {
    envelopeGateEnabled = !envelopeGateEnabled;
    status = envelopeGateEnabled
      ? `Envelope gate enabled (EnvA > ${$reactiveEnvelope.threshold.toFixed(2)})`
      : 'Envelope gate disabled';
  };

  const play = async () => {
    if (!player) return;
    ensurePlayableSelection();
    if (!selectedClipId) {
      status = 'No active clip available (check lane mute/solo).';
      return;
    }
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

  const toggleMuteLane = (lane: number) => {
    laneMuted = laneMuted.map((entry, index) => (index === lane ? !entry : entry));
    if (laneMuted[lane] && soloLane === lane) soloLane = null;
    ensurePlayableSelection();
    status = laneMuted[lane] ? `Layer ${lane + 1} muted` : `Layer ${lane + 1} unmuted`;
  };

  const toggleSoloLane = (lane: number) => {
    soloLane = soloLane === lane ? null : lane;
    ensurePlayableSelection();
    status = soloLane === null ? 'Solo disabled' : `Solo layer ${lane + 1}`;
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

  <div class="matrix-shell">
    {#each [2, 1, 0] as layer}
      <div class="matrix-row">
        <div class="layer-rail">
          <span>Layer {layer + 1}</span>
          <button class="mini" class:active={laneMuted[layer]} on:click={() => toggleMuteLane(layer)}>M</button>
          <button class="mini" class:active={soloLane === layer} on:click={() => toggleSoloLane(layer)}>S</button>
        </div>
        <div class="cells">
          {#each Array.from({ length: matrixColumns }) as _, col}
            {@const clip = clipAtMatrix(layer, col)}
            <button
              class="cell"
              class:active={clip && clip.id === selectedClipId}
              on:click={() => clip && selectClip(clip.id)}
            >
              {#if clip}
                <span>{clip.name.replace(/\.[^/.]+$/, '')}</span>
              {:else}
                <span>empty</span>
              {/if}
            </button>
          {/each}
        </div>
      </div>
    {/each}
  </div>

  <div class="deck-grid">
    <aside class="clip-bin">
      <div class="upload-row">
        <label for="upload-lane">To Layer</label>
        <select id="upload-lane" bind:value={uploadLane}>
          <option value={0}>Layer 1</option>
          <option value={1}>Layer 2</option>
          <option value={2}>Layer 3</option>
        </select>
      </div>
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
          loop
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
        <button class:active={envelopeGateEnabled} on:click={toggleEnvelopeGate}>
          Gate {envelopeGateEnabled ? 'On' : 'Off'}
        </button>
        <span>Section: {$activeSection}</span>
        <span>Clip {Math.max(1, selectedClipIndex() + 1)}</span>
        <span>EnvA {$audioBands.envelopeA.toFixed(2)} / Thr {$reactiveEnvelope.threshold.toFixed(2)}</span>
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

  .matrix-shell {
    margin-bottom: 0.6rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface-0);
    overflow: hidden;
  }

  .matrix-row {
    display: grid;
    grid-template-columns: 94px minmax(0, 1fr);
    border-top: 1px solid var(--border);
  }

  .matrix-row:first-child {
    border-top: none;
  }

  .layer-rail {
    border-right: 1px solid var(--border);
    background: #121213;
    display: grid;
    grid-template-columns: 1fr auto auto;
    align-items: center;
    gap: 0.22rem;
    padding: 0.24rem 0.3rem;
  }

  .layer-rail span {
    font-size: 0.64rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .mini {
    width: 1.2rem;
    height: 1.2rem;
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text);
    border-radius: 0.24rem;
    font-size: 0.56rem;
    font-weight: 700;
    cursor: pointer;
    padding: 0;
  }

  .mini.active {
    border-color: var(--accent-ok);
    color: var(--accent-ok);
  }

  .cells {
    display: grid;
    grid-template-columns: repeat(14, minmax(0, 1fr));
    gap: 1px;
    background: var(--border);
    padding: 1px;
  }

  .cell {
    border: 1px solid #1e1e21;
    background: #09090a;
    color: #6f6f75;
    min-height: 2.2rem;
    padding: 0.2rem 0.22rem;
    cursor: pointer;
    text-align: left;
    font-size: 0.58rem;
    line-height: 1.05;
    font-weight: 600;
    text-transform: uppercase;
    overflow: hidden;
  }

  .cell span {
    display: -webkit-box;
    line-clamp: 3;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .cell.active {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent) inset;
    color: #f7e8d0;
    background: linear-gradient(180deg, #1d1610 0%, #0f0f11 100%);
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

  .upload-row {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.3rem;
    align-items: center;
    margin-bottom: 0.34rem;
  }

  .upload-row label {
    font-size: 0.67rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .upload-row select {
    height: 1.55rem;
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text);
    border-radius: 0.3rem;
    font-size: 0.7rem;
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

  .transport-row button.active {
    border-color: var(--accent-ok);
    color: var(--accent-ok);
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
    .matrix-row {
      grid-template-columns: 1fr;
    }

    .layer-rail {
      border-right: none;
      border-bottom: 1px solid var(--border);
    }

    .cells {
      grid-template-columns: repeat(7, minmax(0, 1fr));
    }

    .deck-grid {
      grid-template-columns: 1fr;
    }

    video,
    .placeholder {
      height: 230px;
    }
  }
</style>
