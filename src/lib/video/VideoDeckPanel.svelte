<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    activeSection,
    automationBounds,
    automationRuntime,
    audioBands,
    reactiveEnvelope,
    tempoState,
  } from "$lib/stores/runtime";

  export let duration = 0;
  export let currentTime = 0;
  export let autoSwitchEnabled = true;
  export let quantizeMode: "beat" | "bar" = "beat";
  export let seekTo: (time: number) => void = () => {};
  const seekPlayer = (t: number) => {
    if (!player || !Number.isFinite(t)) return;
    player.currentTime = Math.max(0, Math.min(t, duration || t));
  };

  interface VideoClip {
    id: string;
    name: string;
    url: string;
    sizeMb: string;
    lane: number;
    slot: number;
  }

  let clips: VideoClip[] = [];
  let selectedClipId = "";
  let player: HTMLVideoElement | null = null;
  let status = "Drop or upload clips to begin playback.";
  let envelopeGateEnabled = true;
  let speedRampEnabled = true;
  let switchSkipChancePercent = 0;
  let currentPlaybackRate = 1;
  let currentAutomationRate = 1;
  let currentAutomationStutter = 0;
  let lastStutterPulseMs = 0;
  let lastQuantizeSlot = -1;
  let playbackRafId = 0;
  let pendingSeekRatio: number | null = null;
  let resumeAfterSwitch = false;
  const matrixColumns = 14;
  let uploadLane = 0;
  let laneMuted = [false, false, false];
  let soloLane: number | null = null;
  const speedDomainMin = 0.25;
  const speedDomainMax = 4;
  const mapNormalizedToRange = (
    normalized: number,
    min: number,
    max: number,
  ): number => min + Math.max(0, Math.min(1, normalized)) * (max - min);
  const clamp = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, value));

  const makeId = (): string =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  let currentClip: VideoClip | undefined = undefined;
  let currentClipIndex = -1;

  $: currentClip = clips.find((clip) => clip.id === selectedClipId);
  $: currentClipIndex = clips.findIndex((clip) => clip.id === selectedClipId);
  const laneIsActive = (lane: number): boolean =>
    soloLane === null ? !laneMuted[lane] : soloLane === lane;
  const playableClips = (): VideoClip[] =>
    clips
      .filter((clip) => laneIsActive(clip.lane))
      .sort((a, b) => (a.lane === b.lane ? a.slot - b.slot : a.lane - b.lane));

  const ensurePlayableSelection = () => {
    const playable = playableClips();
    if (playable.length === 0) {
      selectedClipId = "";
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
    status = `Selected ${clips.find((clip) => clip.id === id)?.name ?? "clip"}`;
  };

  const uploadClips = (event: Event) => {
    const lane = Number(uploadLane);
    const files = Array.from(
      (event.currentTarget as HTMLInputElement).files ?? [],
    ).filter((file) => file.type.startsWith("video/"));

    if (!files.length) {
      status = "No video files detected in selection.";
      return;
    }

    const availableSlots = Array.from(
      { length: matrixColumns },
      (_, slot) => slot,
    ).filter(
      (slot) =>
        !clips.some((clip) => clip.lane === lane && clip.slot === slot),
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
      lane,
      slot: availableSlots[index],
    }));

    clips = [...clips, ...added].sort((a, b) =>
      a.lane === b.lane ? a.slot - b.slot : a.lane - b.lane,
    );
    ensurePlayableSelection();
    if (!selectedClipId) selectedClipId = added[0].id;
    status = droppedCount
      ? `Loaded ${added.length} clip(s) to layer ${lane + 1}. ${droppedCount} clip(s) skipped.`
      : `Loaded ${added.length} clip${added.length > 1 ? "s" : ""} to layer ${lane + 1}`;
  };

  const removeClip = (id: string) => {
    const clip = clips.find((entry) => entry.id === id);
    if (clip) URL.revokeObjectURL(clip.url);
    clips = clips.filter((entry) => entry.id !== id);
    ensurePlayableSelection();
    if (selectedClipId === id)
      status = "Selected clip removed. Switched to next active clip.";
  };

  const getSlotDuration = (): number => {
    const bpm = Math.max(20, Math.min(300, $tempoState.bpm || 120));
    const beatDuration = 60 / bpm;
    return quantizeMode === "bar" ? beatDuration * 4 : beatDuration;
  };

  const getTransportSlotIndex = (): number => {
    const slotDuration = getSlotDuration();
    if (!Number.isFinite(slotDuration) || slotDuration <= 0) return -1;
    const elapsedSeconds = Math.max(
      0,
      (Date.now() - $tempoState.downbeatEpochMs) / 1000,
    );
    return Math.floor(elapsedSeconds / slotDuration);
  };

  const queueQuantizedSwitch = (slotIndex: number) => {
    const playable = playableClips();
    if (playable.length < 2 || !selectedClipId) return;
    const currentIndex = playable.findIndex(
      (clip) => clip.id === selectedClipId,
    );
    if (currentIndex < 0) {
      selectedClipId = playable[0].id;
      return;
    }

    const nextIndex = (currentIndex + 1) % playable.length;
    pendingSeekRatio = duration > 0 ? currentTime / duration : 0;
    resumeAfterSwitch = Boolean(player && !player.paused);
    selectedClipId = playable[nextIndex].id;
    status = `Quantized ${quantizeMode} switch: ${playable[nextIndex].name} (slot ${slotIndex})`;
  };

  const maybeQuantizedSwitch = () => {
    if (
      !autoSwitchEnabled ||
      !player ||
      player.paused ||
      playableClips().length < 2
    )
      return;
    const slotIndex = getTransportSlotIndex();
    if (slotIndex > lastQuantizeSlot) {
      const gateOpen =
        !envelopeGateEnabled ||
        $audioBands.envelopeA > $reactiveEnvelope.threshold;
      if (lastQuantizeSlot >= 0 && gateOpen) {
        const skipChance = clamp(switchSkipChancePercent, 0, 100) / 100;
        if (skipChance > 0 && Math.random() < skipChance) {
          status = `Quantized ${quantizeMode} switch bypassed (${Math.round(skipChance * 100)}%)`;
        } else {
          queueQuantizedSwitch(slotIndex);
        }
      } else if (lastQuantizeSlot >= 0 && !gateOpen) {
        status = `Gate closed: EnvA <= Thr`;
      }
      lastQuantizeSlot = slotIndex;
    }
  };

  const applySwitchSkipChance = () => {
    switchSkipChancePercent = Number(
      clamp(Number(switchSkipChancePercent) || 0, 0, 100).toFixed(0),
    );
  };

  const toggleEnvelopeGate = () => {
    envelopeGateEnabled = !envelopeGateEnabled;
  };

  const applySpeedRamp = () => {
    if (!player || player.paused) return;
    const envelope = Math.max(0, Math.min(1, $audioBands.envelopeB));
    const automationSpeedNorm = Math.max(
      0,
      Math.min(1, $automationRuntime.speed),
    );
    const automationStutterNorm = Math.max(
      0,
      Math.min(1, $automationRuntime.stutter),
    );
    const speedMinBound = Math.max(
      speedDomainMin,
      Math.min($automationBounds.speedMin, $automationBounds.speedMax - 0.01),
    );
    const speedMaxBound = Math.min(
      speedDomainMax,
      Math.max($automationBounds.speedMax, speedMinBound + 0.01),
    );
    const stutterMinBound = Math.max(
      0,
      Math.min($automationBounds.stutterMin, $automationBounds.stutterMax - 0.001),
    );
    const stutterMaxBound = Math.min(
      1,
      Math.max($automationBounds.stutterMax, stutterMinBound + 0.001),
    );
    const rampDepth = quantizeMode === "bar" ? 0.45 : 0.28;
    const automationRate = mapNormalizedToRange(
      automationSpeedNorm,
      speedMinBound,
      speedMaxBound,
    );
    const automationStutterAmount = mapNormalizedToRange(
      automationStutterNorm,
      stutterMinBound,
      stutterMaxBound,
    );
    currentAutomationRate = automationRate;
    currentAutomationStutter = automationStutterAmount;
    const envelopeRate =
      1 + (envelope - 0.5) * 2 * rampDepth;
    const targetRate = speedRampEnabled
      ? Math.max(speedDomainMin, Math.min(speedDomainMax, automationRate * envelopeRate))
      : 1;
    currentPlaybackRate = targetRate;
    player.playbackRate = targetRate;

    if (speedRampEnabled && automationStutterAmount > 0.72) {
      const now = Date.now();
      const pulseEveryMs = Math.max(55, 185 - automationStutterAmount * 120);
      if (now - lastStutterPulseMs >= pulseEveryMs && player.currentTime > 0.06) {
        const jumpBack = 0.012 + automationStutterAmount * 0.065;
        player.currentTime = Math.max(0, player.currentTime - jumpBack);
        lastStutterPulseMs = now;
      }
    }
  };

  const stopPlaybackLoop = () => {
    if (playbackRafId) {
      cancelAnimationFrame(playbackRafId);
      playbackRafId = 0;
    }
  };

  const startPlaybackLoop = () => {
    if (playbackRafId) return;

    const tick = () => {
      playbackRafId = requestAnimationFrame(tick);
      if (!player) return;

      currentTime = player.currentTime || 0;
      if ((!duration || duration <= 0) && Number.isFinite(player.duration)) {
        duration = player.duration;
      }

      if (!player.paused) {
        applySpeedRamp();
        maybeQuantizedSwitch();
      }
    };

    playbackRafId = requestAnimationFrame(tick);
  };

  const play = async () => {
    if (!player) return;
    ensurePlayableSelection();
    if (!selectedClipId) {
      status = "No active clip available.";
      return;
    }
    applySpeedRamp();
    lastQuantizeSlot = getTransportSlotIndex();
    lastStutterPulseMs = Date.now();
    startPlaybackLoop();
    await player.play();
    status = `Playing ${currentClip?.name ?? "clip"}`;
  };

  const pause = () => {
    player?.pause();
    stopPlaybackLoop();
    if (player) player.playbackRate = 1;
    currentPlaybackRate = 1;
    lastStutterPulseMs = 0;
    status = "Paused";
  };

  const stop = () => {
    if (!player) return;
    player.pause();
    stopPlaybackLoop();
    player.currentTime = 0;
    player.playbackRate = 1;
    currentPlaybackRate = 1;
    lastStutterPulseMs = 0;
    currentTime = 0;
    lastQuantizeSlot = -1;
    status = "Stopped";
  };

  const toggleMuteLane = (lane: number) => {
    laneMuted = laneMuted.map((entry, index) =>
      index === lane ? !entry : entry,
    );
    if (laneMuted[lane] && soloLane === lane) soloLane = null;
    ensurePlayableSelection();
  };

  const toggleSoloLane = (lane: number) => {
    soloLane = soloLane === lane ? null : lane;
    ensurePlayableSelection();
  };

  const setUploadLane = (event: Event) => {
    uploadLane = Number((event.currentTarget as HTMLSelectElement).value);
  };

  $: seekTo = seekPlayer;

  onDestroy(() => {
    stopPlaybackLoop();
    for (const clip of clips) URL.revokeObjectURL(clip.url);
  });
</script>

<div
  class="h-full flex flex-col gap-1 bg-surface-900 border border-surface-800 rounded-md p-1"
>
  <div
    class="flex-none flex items-center justify-between border-b border-surface-800 pb-1 mb-1"
  >
    <h2
      class="text-[0.65rem] font-bold uppercase tracking-widest text-surface-400 m-0"
    >
      Video Matrix
    </h2>
    <p class="text-[0.6rem] m-0 truncate text-primary-500" aria-live="polite">
      {status}
    </p>
  </div>

  <div
    class="flex-none flex flex-col gap-[1px] bg-surface-800 border border-surface-800 rounded-sm overflow-hidden text-[0.6rem]"
  >
    {#each [2, 1, 0] as layer}
      <div class="flex items-stretch bg-surface-950">
        <div
          class="w-16 flex flex-col items-center justify-center gap-1 bg-surface-900 p-1 border-r border-surface-800"
        >
          <span class="text-[0.55rem] text-surface-400 font-bold uppercase"
            >L{layer + 1}</span
          >
          <div class="flex gap-1 w-10">
            <button
              class="w-5 h-5 rounded-sm flex items-center justify-center font-bold text-[0.55rem] bg-surface-800 {laneMuted[
                layer
              ]
                ? 'text-error-500 border border-error-500'
                : 'text-surface-400 border border-surface-700'}"
              aria-label={`Mute layer ${layer + 1}`}
              on:click={() => toggleMuteLane(layer)}>M</button
            >
            <button
              class="w-5 h-5 rounded-sm flex items-center justify-center font-bold text-[0.55rem] bg-surface-800 {soloLane ===
              layer
                ? 'text-primary-500 border border-primary-500'
                : 'text-surface-400 border border-surface-700'}"
              aria-label={`Solo layer ${layer + 1}`}
              on:click={() => toggleSoloLane(layer)}>S</button
            >
          </div>
        </div>
        <div class="flex-1 grid grid-cols-14 gap-[1px] bg-surface-800 p-[1px]">
          {#each Array.from({ length: matrixColumns }) as _, col}
            {@const clip = clipAtMatrix(layer, col)}
            <button
              class="relative h-14 flex flex-col overflow-hidden bg-surface-950 text-surface-500 hover:bg-surface-800 border transition-colors {clip &&
              clip.id === selectedClipId
                ? 'border-primary-500 shadow-[inset_0_0_12px_rgba(245,158,11,0.25)]'
                : 'border-transparent'}"
              aria-label={clip
                ? `Select ${clip.name} on layer ${layer + 1}, slot ${col + 1}`
                : `Empty slot ${col + 1} on layer ${layer + 1}`}
              on:click={() => clip && selectClip(clip.id)}
            >
              {#if clip}
                <video
                  src={clip.url}
                  class="absolute inset-0 w-full h-full object-cover opacity-60 mix-blend-screen"
                  muted
                  disablePictureInPicture
                  preload="metadata"
                ></video>
                <div
                  class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-surface-950 to-transparent p-0.5 z-10 text-left"
                >
                  <span
                    class="text-[0.55rem] tracking-tighter font-mono uppercase text-surface-200 block truncate drop-shadow-md"
                    >{clip.name.replace(/\.[^/.]+$/, "")}</span
                  >
                </div>
              {:else}
                <span class="m-auto text-[0.5rem] text-surface-700">·</span>
              {/if}
            </button>
          {/each}
        </div>
      </div>
    {/each}
  </div>

  <div class="flex flex-row gap-1 flex-1 min-h-0">
    <div
      class="w-40 flex-none flex flex-col gap-1 border border-surface-800 bg-surface-950 rounded-sm p-1 overflow-hidden"
    >
      <div
        class="flex gap-1 items-center bg-surface-900 p-1 rounded-sm border border-surface-800"
      >
        <label for="upload-lane" class="sr-only">Upload lane</label>
        <select
          id="upload-lane"
          class="flex-1 text-[0.6rem] bg-surface-950 border border-surface-800 rounded-sm py-0.5 px-1"
          value={String(uploadLane)}
          on:change={setUploadLane}
        >
          <option value={0}>L1</option>
          <option value={1}>L2</option>
          <option value={2}>L3</option>
        </select>
        <label
          class="btn btn-sm preset-filled-primary-500 text-[0.6rem] py-0.5 px-2 cursor-pointer font-bold m-0"
          for="video-upload">Add</label
        >
        <input
          id="video-upload"
          type="file"
          accept="video/*"
          multiple
          on:change={uploadClips}
          class="hidden"
        />
      </div>

      <div class="flex-1 overflow-y-auto flex flex-col gap-1 pr-1">
        {#if clips.length === 0}
          <div class="text-[0.6rem] text-surface-500 text-center mt-2">
            No clips
          </div>
        {/if}
        {#each clips as clip}
          <div
            class="group flex flex-col p-1 rounded-sm border {clip.id ===
            selectedClipId
              ? 'border-primary-500 bg-surface-900'
              : 'border-surface-800 bg-surface-950'} hover:bg-surface-900"
          >
            <div class="flex justify-between items-start gap-1">
              <button
                class="text-left truncate flex-1 text-[0.6rem] font-bold text-surface-200"
                aria-label={`Select clip ${clip.name}`}
                on:click={() => selectClip(clip.id)}>{clip.name}</button
              >
              <button
                class="text-[0.55rem] text-surface-500 hover:text-error-500"
                aria-label={`Remove clip ${clip.name}`}
                on:click={() => removeClip(clip.id)}>✕</button
              >
            </div>
            <div class="text-[0.55rem] text-surface-500 flex justify-between">
              <span>L{clip.lane + 1} S{clip.slot + 1}</span>
              <span>{clip.sizeMb}M</span>
            </div>
          </div>
        {/each}
      </div>
    </div>

    <div
      class="flex-1 flex flex-col items-center justify-center min-w-0 bg-surface-950 border border-surface-800 rounded-sm overflow-hidden relative p-1"
    >
      <div
        class="w-full max-h-full aspect-video bg-black rounded-sm border border-surface-900 relative flex overflow-hidden shadow-xl shadow-black/50 mx-auto"
      >
        <div class="absolute top-1 right-1 z-10 flex gap-1 pointer-events-none">
          <span
            class="text-[0.6rem] px-1 py-0.5 bg-surface-950/80 border border-surface-800 rounded-sm font-mono backdrop-blur-sm"
            >C: {Math.max(1, currentClipIndex + 1)}</span
          >
          <span
            class="text-[0.6rem] px-1 py-0.5 bg-surface-950/80 border border-surface-800 rounded-sm font-mono backdrop-blur-sm"
            >{$activeSection} · {currentPlaybackRate.toFixed(2)}x · S{
              currentAutomationRate.toFixed(2)
            }x · T{(currentAutomationStutter * 100).toFixed(0)}%</span
          >
        </div>

        {#if currentClip}
          <video
            bind:this={player}
            src={currentClip.url}
            class="w-full h-full object-contain"
            playsinline
            loop
            on:play={startPlaybackLoop}
            on:pause={stopPlaybackLoop}
            on:ended={stopPlaybackLoop}
            on:loadedmetadata={() => {
              duration = player?.duration ?? 0;
              if (player && pendingSeekRatio !== null && duration > 0) {
                player.currentTime = Math.min(
                  duration * pendingSeekRatio,
                  Math.max(0, duration - 0.05),
                );
                pendingSeekRatio = null;
              }
              if (player && resumeAfterSwitch) {
                startPlaybackLoop();
                void player.play();
                resumeAfterSwitch = false;
              }
            }}
            on:timeupdate={() => {
              currentTime = player?.currentTime ?? 0;
              applySpeedRamp();
              maybeQuantizedSwitch();
            }}
          >
            <track
              kind="captions"
              srclang="en"
              label="Captions"
              src="data:text/vtt,WEBVTT"
            />
          </video>
        {:else}
          <div
            class="w-full h-full flex items-center justify-center text-[0.65rem] text-surface-600 font-mono tracking-widest bg-surface-900"
          >
            NO SIGNAL
          </div>
        {/if}

        <div class="absolute bottom-1 w-full px-1 z-10">
          <div
            class="flex justify-between items-center bg-surface-950/90 border border-surface-800 rounded-sm p-1 backdrop-blur-sm"
          >
            <div class="flex gap-1">
              <button
                class="btn btn-sm bg-surface-800 border border-surface-700 hover:bg-surface-700 text-[0.6rem] px-2 py-0.5"
                aria-label="Play selected clip"
                on:click={play}>▶</button
              >
              <button
                class="btn btn-sm bg-surface-800 border border-surface-700 hover:bg-surface-700 text-[0.6rem] px-2 py-0.5"
                aria-label="Pause selected clip"
                on:click={pause}>⏸</button
              >
              <button
                class="btn btn-sm bg-surface-800 border border-surface-700 hover:bg-surface-700 text-[0.6rem] px-2 py-0.5"
                aria-label="Stop selected clip"
                on:click={stop}>⏹</button
              >
            </div>
            <button
              class="btn btn-sm text-[0.6rem] px-2 py-0.5 border font-bold {envelopeGateEnabled
                ? 'border-primary-500 bg-primary-500/20 text-primary-400'
                : 'border-surface-700 bg-surface-800 text-surface-400'}"
              on:click={toggleEnvelopeGate}
            >
              GATE {envelopeGateEnabled ? "ON" : "OFF"}
            </button>
            <button
              class="btn btn-sm text-[0.6rem] px-2 py-0.5 border font-bold {speedRampEnabled
                ? 'border-primary-500 bg-primary-500/20 text-primary-400'
                : 'border-surface-700 bg-surface-800 text-surface-400'}"
              on:click={() => {
                speedRampEnabled = !speedRampEnabled;
                if (!speedRampEnabled && player) {
                  player.playbackRate = 1;
                  currentPlaybackRate = 1;
                }
              }}
            >
              RAMP {speedRampEnabled ? "ON" : "OFF"}
            </button>
            <div
              class="flex items-center gap-1 px-1 py-0.5 rounded-sm border border-surface-700 bg-surface-900"
            >
              <span class="text-[0.52rem] font-bold text-surface-400 uppercase"
                >Skip</span
              >
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                bind:value={switchSkipChancePercent}
                on:input={applySwitchSkipChance}
                class="w-16 h-1 accent-primary-500"
                aria-label="Random quantized switch bypass probability"
                title="Random quantized switch bypass probability"
              />
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                bind:value={switchSkipChancePercent}
                on:input={applySwitchSkipChance}
                class="w-10 bg-surface-950 border border-surface-700 rounded-sm px-1 py-0 text-[0.52rem] font-mono text-surface-300 text-right"
                aria-label="Skip chance percent"
              />
              <span class="text-[0.5rem] text-surface-500 font-mono">
                {(switchSkipChancePercent / 100).toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
