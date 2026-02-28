<script lang="ts">
  import { activeSection, markers } from "$lib/stores/runtime";

  export let duration = 0;
  export let currentTime = 0;
  export let onSeek: (time: number) => void = () => {};
  export let autoSwitchEnabled = false;
  export let quantizeMode: "beat" | "bar" = "beat";
  export let onToggleAutoSwitch: () => void = () => {};
  export let onSetQuantizeMode: (mode: "beat" | "bar") => void = () => {};

  const sections = ["intro", "verse-a", "chorus-a", "bridge", "outro"];

  // Generate a random, dense waveform path for placeholder
  const generateWaveform = () => {
    const pts = 800;
    let path = "M 0,50 ";
    const data: number[] = [];
    for (let i = 0; i < pts; i++) {
      const env = Math.sin(i * 0.05) * 0.4 + 0.6;
      const noise = Math.random() * 0.9 + 0.1;
      data.push(env * noise * 45); // max height 45 (leaving 5px padding)
    }
    for (let i = 0; i < pts; i++) {
      path += `L ${(i / (pts - 1)) * 1000},${50 - data[i]} `;
    }
    for (let i = pts - 1; i >= 0; i--) {
      path += `L ${(i / (pts - 1)) * 1000},${50 + data[i]} `;
    }
    path += "Z";
    return path;
  };
  const waveformPath = generateWaveform();

  const formatClock = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
    const mins = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const secs = Math.floor(seconds % 60)
      .toString()
      .padStart(2, "0");
    return `${mins}:${secs}`;
  };

  const scrub = (event: Event) => {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    onSeek(value);
  };

  $: safeDuration = duration > 0 ? duration : 1;
  $: progress = Math.min(Math.max(currentTime / safeDuration, 0), 1) * 100;
  $: markerPositions = $markers.map(
    (_, index) => ((index + 1) / ($markers.length + 1)) * 100,
  );
</script>

<div class="h-full flex flex-col font-sans p-1">
  <div class="flex-none flex justify-between items-center mb-1 overflow-hidden">
    <div class="flex items-center gap-2">
      <h3
        class="text-[0.65rem] font-bold uppercase tracking-widest text-surface-400 m-0"
      >
        Master Timeline
      </h3>
      <div
        class="font-mono text-[0.6rem] text-surface-300 bg-surface-950 px-1 border border-surface-800 rounded-sm"
      >
        {formatClock(currentTime)} / {formatClock(duration)}
      </div>
    </div>

    <!-- Controls section -->
    <div class="flex gap-1 items-center">
      <div
        class="flex bg-surface-950 rounded-sm border border-surface-800 overflow-hidden"
      >
        {#each sections as section}
          <button
            class="px-2 py-0.5 text-[0.55rem] font-bold uppercase uppercase tracking-tighter border-r border-surface-800 last:border-0 {$activeSection ===
            section
              ? 'bg-primary-500 text-surface-950'
              : 'text-surface-400 hover:bg-surface-800'}"
            on:click={() => activeSection.set(section)}
          >
            {section}
          </button>
        {/each}
      </div>

      <div
        class="flex gap-0.5 bg-surface-950 rounded-sm border border-surface-800 overflow-hidden ml-2"
      >
        <button
          class="px-2 py-0.5 text-[0.55rem] font-bold uppercase transition-colors {autoSwitchEnabled
            ? 'bg-primary-500/20 text-primary-400'
            : 'text-surface-500 hover:bg-surface-800'}"
          on:click={onToggleAutoSwitch}
        >
          {autoSwitchEnabled ? "Auto On" : "Auto Off"}
        </button>
        <button
          class="px-2 py-0.5 text-[0.55rem] uppercase border-l border-surface-800 font-bold transition-colors {quantizeMode ===
          'beat'
            ? 'bg-surface-700 text-primary-400'
            : 'text-surface-500 hover:bg-surface-800'}"
          on:click={() => onSetQuantizeMode("beat")}>Beat</button
        >
        <button
          class="px-2 py-0.5 text-[0.55rem] uppercase border-l border-surface-800 font-bold transition-colors {quantizeMode ===
          'bar'
            ? 'bg-surface-700 text-primary-400'
            : 'text-surface-500 hover:bg-surface-800'}"
          on:click={() => onSetQuantizeMode("bar")}>Bar</button
        >
      </div>
    </div>
  </div>

  <div
    class="flex-1 flex flex-col relative bg-surface-950 border border-surface-800 rounded-sm min-h-0 overflow-hidden text-[0.6rem] font-mono select-none"
  >
    <!-- Common ruler/scrubber overlay -->
    <div class="absolute inset-0 z-10 pointer-events-none">
      <div
        class="absolute top-0 bottom-0 border-l border-primary-500 shadow-[0_0_8px_rgba(245,158,11,0.5)] z-20 transition-all duration-75"
        style={`left:${progress}%`}
      >
        <div
          class="absolute -top-1 -ml-[3px] w-[7px] h-2 bg-primary-500 clip-path-[polygon(0_0,100%_0,50%_100%)]"
        ></div>
      </div>

      {#each markerPositions as position}
        <div
          class="absolute top-0 bottom-0 w-[1px] bg-primary-500/30 border-l border-primary-500/50 border-dashed"
          style={`left:${position}%`}
        ></div>
      {/each}
      {#each Array.from({ length: 17 }) as _, index}
        <div
          class="absolute top-0 bottom-0 w-[1px] bg-surface-700/30"
          style={`left:${(index / 16) * 100}%`}
        ></div>
      {/each}
    </div>

    <!-- Scrubber Input -->
    <input
      type="range"
      min="0"
      max={safeDuration}
      step="0.01"
      value={Math.min(currentTime, safeDuration)}
      on:input={scrub}
      class="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize z-30 m-0"
    />

    <!-- Lane 1: Video Clips Sequence -->
    <div
      class="flex-1 min-h-0 flex border-b border-surface-800 items-stretch bg-surface-900 group relative"
    >
      <div
        class="w-[88px] flex-none bg-surface-900 border-r border-surface-800 flex items-center px-1 z-20"
      >
        <span
          class="text-[0.6rem] text-surface-400 uppercase font-bold tracking-widest text-primary-500/70"
          >V1 Clp</span
        >
      </div>
      <div class="flex-1 relative overflow-hidden bg-surface-950">
        <!-- V1 Visuals placeholder logic -->
        <div class="absolute inset-y-1 mx-2 flex gap-1">
          <!-- Clip blocks representing cuts -->
          <div
            class="h-full w-24 bg-surface-800 border border-surface-700 rounded-sm overflow-hidden flex items-center justify-center opacity-70"
          >
            <span class="text-[0.5rem] text-surface-500">CLIP_A</span>
          </div>
          <div
            class="h-full w-12 bg-surface-800 border-l border-r border-surface-700 border-t-2 border-t-primary-500 overflow-hidden flex items-center justify-center bg-primary-500/10"
          >
            <span class="text-[0.5rem] text-primary-400">CUT</span>
          </div>
          <div
            class="h-full w-32 bg-surface-800 border border-surface-700 rounded-sm overflow-hidden flex items-center justify-center opacity-70"
          >
            <span class="text-[0.5rem] text-surface-500">CLIP_B</span>
          </div>
          <div
            class="h-full w-16 bg-surface-800 border border-surface-700 rounded-sm overflow-hidden flex items-center justify-center opacity-70"
          >
            <span class="text-[0.5rem] text-surface-500">CHORUS</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Lane 2: Audio Waveform -->
    <div
      class="flex-1 min-h-0 flex border-b border-surface-800 items-stretch bg-surface-900 group"
    >
      <div
        class="w-[88px] flex-none bg-surface-900 border-r border-surface-800 flex items-center px-1 z-20"
      >
        <span
          class="text-[0.6rem] text-surface-400 uppercase font-bold tracking-widest text-primary-500/70"
          >A1 Wvf</span
        >
      </div>
      <div class="flex-1 relative overflow-hidden bg-surface-950">
        <!-- Background Grid -->
        <div
          class="absolute inset-0 pointer-events-none opacity-20"
          style="background-image: linear-gradient(to right, var(--color-surface-700) 1px, transparent 1px), linear-gradient(to bottom, var(--color-surface-700) 1px, transparent 1px); background-size: 20px 20px;"
        ></div>
        <!-- Center line -->
        <div
          class="absolute inset-x-0 top-1/2 h-[1px] bg-surface-700 -translate-y-1/2 pointer-events-none z-0"
        ></div>
        <!-- A1 Waveform visual placeholder -->
        <div
          class="absolute inset-0 flex items-center justify-center px-2 z-10 opacity-80"
        >
          <svg
            preserveAspectRatio="none"
            viewBox="0 0 1000 100"
            class="w-full h-[90%]"
          >
            <path
              d={waveformPath}
              class="fill-surface-600 stroke-surface-400"
              stroke-width="0.5"
              stroke-linejoin="round"
            />
          </svg>
        </div>
      </div>
    </div>

    <!-- Lane 3: Stutter / Speed Envelopes -->
    <div class="flex-1 min-h-0 flex items-stretch bg-surface-900">
      <div
        class="w-[88px] flex-none bg-surface-900 border-r border-surface-800 flex flex-col justify-center px-1 z-20"
      >
        <span
          class="text-[0.6rem] text-surface-400 uppercase font-bold tracking-widest"
          >Envelopes</span
        >
        <span class="text-[0.5rem] text-surface-500">Stutter/Spd</span>
      </div>
      <div
        class="flex-1 relative overflow-hidden bg-surface-950 px-2 opacity-80"
      >
        <!-- Automation line drawing placeholder using svg -->
        <svg
          preserveAspectRatio="none"
          viewBox="0 0 1000 100"
          class="w-full h-full absolute inset-0"
        >
          <!-- Speed Ramp -->
          <path
            d="M 0,90 Q 50,90 100,50 T 200,90 L 250,90 Q 300,90 350,10 T 500,90 L 1000,90"
            fill="none"
            class="stroke-primary-600"
            stroke-width="2"
            stroke-linejoin="round"
          />
          <path
            d="M 0,90 Q 50,90 100,50 T 200,90 L 250,90 L 250,100 L 0,100 Z"
            class="fill-primary-600/10"
          />

          <!-- Stutter Blocks -->
          <rect
            x="520"
            y="20"
            width="10"
            height="80"
            class="fill-surface-600"
          />
          <rect
            x="540"
            y="20"
            width="10"
            height="80"
            class="fill-surface-600"
          />
          <rect
            x="560"
            y="20"
            width="10"
            height="80"
            class="fill-surface-600"
          />
          <rect
            x="580"
            y="20"
            width="10"
            height="80"
            class="fill-surface-600"
          />
        </svg>
      </div>
    </div>
  </div>
</div>
