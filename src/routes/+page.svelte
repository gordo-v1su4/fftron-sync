<script lang="ts">
  import "../app.css";
  import AudioReactivePanel from "$lib/audio/AudioReactivePanel.svelte";
  import TransportControlPanel from "$lib/engine/TransportControlPanel.svelte";
  import VideoDeckPanel from "$lib/video/VideoDeckPanel.svelte";
  import TimelinePanel from "$lib/timeline/TimelinePanel.svelte";

  let duration = 0;
  let currentTime = 0;
  let autoSwitchEnabled = true;
  let quantizeMode: "beat" | "bar" = "beat";

  let seekTo: (time: number) => void;
</script>

<div
  class="h-screen w-screen flex flex-col overflow-hidden bg-surface-950 text-surface-50 font-sans p-1 gap-1"
>
  <header
    class="flex-none flex flex-row items-center justify-between px-2 py-1 bg-surface-900 border border-surface-800 rounded-md"
  >
    <div>
      <h1
        class="text-xs font-bold m-0 tracking-tight uppercase text-surface-200"
      >
        Video Viewer & Parameter Matrix
      </h1>
      <p class="text-[0.6rem] text-surface-500 m-0">
        Desktop-first live engine: Rust clock authority, reactive clip matrix,
        quantized execution.
      </p>
    </div>
  </header>

  <div class="flex flex-row gap-1 flex-1 min-h-0">
    <div class="flex flex-col gap-1 w-1/2 min-w-0">
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
    <div class="flex flex-col gap-1 w-1/2 min-w-0">
      <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
        <AudioReactivePanel />
      </div>
    </div>
  </div>

  <div
    class="flex-none h-[280px] bg-surface-900 border border-surface-800 rounded-md flex flex-col"
  >
    <TimelinePanel
      {duration}
      {currentTime}
      onSeek={(time) => seekTo?.(time)}
      {autoSwitchEnabled}
      {quantizeMode}
      onToggleAutoSwitch={() => (autoSwitchEnabled = !autoSwitchEnabled)}
      onSetQuantizeMode={(mode) => (quantizeMode = mode)}
    />
  </div>
</div>
