<script lang="ts">
  import "../app.css";
  import AudioReactivePanel from "$lib/audio/AudioReactivePanel.svelte";
  import TransportControlPanel from "$lib/engine/TransportControlPanel.svelte";
  import VideoDeckPanel from "$lib/video/VideoDeckPanel.svelte";
  import TimelinePanel from "$lib/timeline/TimelinePanel.svelte";
  import { audioRuntime, timelineSeekRequest } from "$lib/stores/runtime";

  let duration = 0;
  let currentTime = 0;
  let autoSwitchEnabled = true;
  let quantizeMode: "beat" | "bar" = "beat";
  let seekRequestId = 0;

  let seekTo: (time: number) => void;

  const handleTimelineSeek = (time: number) => {
    seekTo?.(time);
    timelineSeekRequest.set({
      time,
      requestId: ++seekRequestId,
    });
  };

  $: timelineDuration = Math.max(duration, $audioRuntime.duration);
  $: timelineCurrentTime =
    $audioRuntime.source === "file" && $audioRuntime.isPlaying
      ? $audioRuntime.currentTime
      : duration > 0
        ? currentTime
        : $audioRuntime.currentTime;
</script>

<div
  class="h-screen w-screen flex flex-col overflow-hidden bg-surface-950 text-surface-50 font-sans p-2 gap-2"
>
  <header
    class="flex-none flex flex-row items-center justify-between px-3 py-2 bg-surface-900 border border-surface-800 rounded-md"
  >
    <div>
      <h1
        class="text-sm font-bold m-0 tracking-tight uppercase text-surface-100"
      >
        FFTRON Sync Console
      </h1>
      <p class="text-[0.72rem] text-surface-400 m-0">
        Desktop-first live engine: Rust clock authority, reactive clip matrix,
        quantized execution.
      </p>
    </div>
    <div
      class="hidden md:flex items-center gap-2 text-[0.65rem] font-mono text-surface-300"
    >
      <span class="px-2 py-1 border border-surface-700 rounded-sm bg-surface-950"
        >Clock: Rust</span
      >
      <span class="px-2 py-1 border border-surface-700 rounded-sm bg-surface-950"
        >Mode: Live Edit</span
      >
    </div>
  </header>

  <div class="flex flex-col xl:flex-row gap-2 flex-1 min-h-0">
    <div class="flex flex-col gap-2 xl:w-3/5 min-w-0 min-h-0">
      <div class="flex-none">
        <TransportControlPanel />
      </div>
      <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
        <VideoDeckPanel
          bind:duration
          bind:currentTime
          bind:autoSwitchEnabled
          bind:quantizeMode
          bind:seekTo
        />
      </div>
    </div>
    <div class="flex flex-col gap-2 xl:w-2/5 min-w-0 min-h-0">
      <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
        <AudioReactivePanel />
      </div>
    </div>
  </div>

  <div
    class="flex-none h-[300px] bg-surface-900 border border-surface-800 rounded-md flex flex-col"
  >
    <TimelinePanel
      duration={timelineDuration}
      currentTime={timelineCurrentTime}
      onSeek={handleTimelineSeek}
      {autoSwitchEnabled}
      {quantizeMode}
      onToggleAutoSwitch={() => (autoSwitchEnabled = !autoSwitchEnabled)}
      onSetQuantizeMode={(mode) => (quantizeMode = mode)}
    />
  </div>
</div>
