<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { audioBands, audioRuntime, reactiveEnvelope, tempoState } from '$lib/stores/runtime';
  import type { ReactiveBandTarget } from '$lib/types/engine';

  const targets: ReactiveBandTarget[] = ['low', 'mid', 'high', 'full'];
  const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

  let audioElement: HTMLAudioElement | null = null;
  let fileInput: HTMLInputElement | null = null;
  let context: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let monitorGain: GainNode | null = null;
  let mediaNode: MediaElementAudioSourceNode | null = null;
  let micNode: MediaStreamAudioSourceNode | null = null;
  let micStream: MediaStream | null = null;
  let rafId = 0;
  let lastFrameMs = 0;
  let fftData: Uint8Array | null = null;
  let loadedTrackUrl = '';
  let status = 'Load a song (or mic) to drive FFT and envelopes.';

  let target: ReactiveBandTarget = 'full';
  let attackMs = 27;
  let releaseMs = 190;
  let threshold = 0.12;
  let sensitivity = 1;

  let envelopeA = 0;
  let envelopeB = 0;

  const applyEnvelopeSettings = () => {
    reactiveEnvelope.set({
      target,
      attackMs,
      releaseMs,
      threshold,
      sensitivity
    });
  };

  const disconnectSources = () => {
    mediaNode?.disconnect();
    micNode?.disconnect();
  };

  const ensureAudioGraph = async () => {
    if (!context) context = new AudioContext();
    if (context.state === 'suspended') await context.resume();

    if (!analyser) {
      analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.22;
      fftData = new Uint8Array(analyser.frequencyBinCount);
    }

    if (!monitorGain) {
      monitorGain = context.createGain();
      monitorGain.gain.value = 1;
      analyser.connect(monitorGain);
      monitorGain.connect(context.destination);
    }
  };

  const attachFileSource = async () => {
    if (!audioElement) return;
    await ensureAudioGraph();
    if (!context || !analyser || !monitorGain) return;

    if (!mediaNode) {
      mediaNode = context.createMediaElementSource(audioElement);
    }

    disconnectSources();
    mediaNode.connect(analyser);
    monitorGain.gain.value = 1;
    status = 'File source routed to FFT engine.';
  };

  const attachMicSource = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      status = 'Microphone capture is unavailable in this browser.';
      return;
    }

    await ensureAudioGraph();
    if (!context || !analyser || !monitorGain) return;

    if (micStream) {
      micStream.getTracks().forEach((track) => track.stop());
      micStream = null;
    }

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    micNode = context.createMediaStreamSource(micStream);
    disconnectSources();
    micNode.connect(analyser);
    monitorGain.gain.value = 0;
    audioElement?.pause();

    audioRuntime.set({
      source: 'mic',
      trackName: 'External audio input',
      isPlaying: true,
      currentTime: 0,
      duration: 0
    });
    status = 'Mic source live. Monitoring disabled to prevent feedback.';
  };

  const teardownMic = () => {
    if (micStream) {
      micStream.getTracks().forEach((track) => track.stop());
      micStream = null;
    }
    micNode?.disconnect();
    micNode = null;
  };

  const bandAverage = (startHz: number, endHz: number): number => {
    if (!fftData || !analyser || !context) return 0;

    const nyquist = context.sampleRate / 2;
    const start = Math.max(0, Math.floor((startHz / nyquist) * fftData.length));
    const end = Math.min(fftData.length - 1, Math.floor((endHz / nyquist) * fftData.length));
    if (end <= start) return 0;

    let total = 0;
    for (let index = start; index <= end; index += 1) {
      total += fftData[index];
    }
    return total / ((end - start + 1) * 255);
  };

  const smoothEnvelope = (current: number, next: number, dtMs: number, riseMs: number, fallMs: number): number => {
    const tau = next > current ? Math.max(6, riseMs) : Math.max(6, fallMs);
    const alpha = 1 - Math.exp(-dtMs / tau);
    return current + (next - current) * alpha;
  };

  const startFftLoop = () => {
    if (rafId) return;

    const frame = (timestamp: number) => {
      rafId = requestAnimationFrame(frame);
      if (!analyser || !fftData) return;

      analyser.getByteFrequencyData(fftData as Uint8Array<ArrayBuffer>);

      const low = bandAverage(20, 180);
      const mid = bandAverage(180, 2000);
      const high = bandAverage(2000, 10000);
      const full = bandAverage(20, 14000);

      const targetedRaw =
        target === 'low' ? low : target === 'mid' ? mid : target === 'high' ? high : full;
      const scaledTarget = clamp01(((targetedRaw - threshold) / Math.max(0.01, 1 - threshold)) * sensitivity);
      const scaledFull = clamp01(((full - threshold) / Math.max(0.01, 1 - threshold)) * sensitivity);

      const dt = lastFrameMs > 0 ? timestamp - lastFrameMs : 16.67;
      lastFrameMs = timestamp;

      envelopeA = smoothEnvelope(envelopeA, scaledTarget, dt, attackMs, releaseMs);
      envelopeB = smoothEnvelope(envelopeB, scaledFull, dt, attackMs * 1.6, releaseMs * 1.45);

      audioBands.set({
        low,
        mid,
        high,
        full,
        envelopeA,
        envelopeB,
        peak: envelopeA > 0.82 || high > 0.9
      });
    };

    rafId = requestAnimationFrame(frame);
  };

  const loadTrack = async (event: Event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file || !audioElement) {
      status = 'No media file selected.';
      return;
    }

    teardownMic();

    if (loadedTrackUrl) URL.revokeObjectURL(loadedTrackUrl);
    loadedTrackUrl = URL.createObjectURL(file);
    audioElement.src = loadedTrackUrl;
    audioElement.load();
    await attachFileSource();

    audioRuntime.set({
      source: 'file',
      trackName: file.name,
      isPlaying: false,
      currentTime: 0,
      duration: 0
    });

    status = `Loaded track: ${file.name}`;
  };

  const playTrack = async () => {
    if (!audioElement || !$audioRuntime.trackName || $audioRuntime.source !== 'file') return;
    await ensureAudioGraph();
    await audioElement.play();
    status = 'Track playback running.';
  };

  const pauseTrack = () => {
    audioElement?.pause();
    status = 'Track paused.';
  };

  const stopTrack = () => {
    if (!audioElement) return;
    audioElement.pause();
    audioElement.currentTime = 0;
    status = 'Track stopped.';
  };

  const toggleMic = async () => {
    if ($audioRuntime.source === 'mic') {
      teardownMic();
      if (audioElement?.src) {
        await attachFileSource();
        audioRuntime.update((state) => ({
          ...state,
          source: 'file',
          isPlaying: false
        }));
        status = 'Mic disabled. File source restored.';
      } else {
        audioRuntime.set({
          source: 'none',
          trackName: 'No track loaded',
          isPlaying: false,
          currentTime: 0,
          duration: 0
        });
        status = 'Mic disabled.';
      }
      return;
    }

    try {
      await attachMicSource();
    } catch (error) {
      status = `Mic enable failed: ${error instanceof Error ? error.message : 'unknown error'}`;
    }
  };

  onMount(() => {
    applyEnvelopeSettings();
    startFftLoop();
  });

  onDestroy(() => {
    if (rafId) cancelAnimationFrame(rafId);
    if (loadedTrackUrl) URL.revokeObjectURL(loadedTrackUrl);
    teardownMic();
    disconnectSources();
    analyser?.disconnect();
    monitorGain?.disconnect();
    if (context) void context.close();
  });
</script>

<section class="panel">
  <header class="head">
    <h2>Audio Reactive</h2>
    <p>Song or live input drives FFT + dual envelopes for visuals and clip policy.</p>
  </header>

  <div class="layout">
    <div class="controls">
      <div class="row">
        <label for="track-file" class="btn btn-accent">Load Song</label>
        <input id="track-file" bind:this={fileInput} type="file" accept="audio/*,video/*" on:change={loadTrack} />
        <button class="btn" on:click={toggleMic}>{$audioRuntime.source === 'mic' ? 'Mic Off' : 'Mic In'}</button>
      </div>

      <div class="track">{ $audioRuntime.trackName }</div>

      <div class="row row-tight">
        <span class="mono">{$tempoState.bpm.toFixed(2)}</span>
        <button class="icon" on:click={playTrack}>▶</button>
        <button class="icon" on:click={pauseTrack}>▮▮</button>
        <button class="icon" on:click={stopTrack}>■</button>
        <span class="clock">
          {$audioRuntime.currentTime.toFixed(1)} / {Math.max($audioRuntime.duration, 0).toFixed(1)}s
        </span>
      </div>

      <div class="row row-node">
        <label for="reactive-target">Node</label>
        <select id="reactive-target" bind:value={target} on:change={applyEnvelopeSettings}>
          {#each targets as option}
            <option value={option}>{option}</option>
          {/each}
        </select>

        <label for="reactive-attack">Attack</label>
        <input
          id="reactive-attack"
          type="number"
          min="5"
          max="800"
          step="1"
          bind:value={attackMs}
          on:input={applyEnvelopeSettings}
        />

        <label for="reactive-release">Release</label>
        <input
          id="reactive-release"
          type="number"
          min="20"
          max="1500"
          step="5"
          bind:value={releaseMs}
          on:input={applyEnvelopeSettings}
        />
      </div>

      <div class="row row-envelope">
        <label for="reactive-threshold">Threshold</label>
        <input
          id="reactive-threshold"
          type="range"
          min="0"
          max="0.8"
          step="0.01"
          bind:value={threshold}
          on:input={applyEnvelopeSettings}
        />

        <label for="reactive-sensitivity">Sensitivity</label>
        <input
          id="reactive-sensitivity"
          type="range"
          min="0.5"
          max="2.5"
          step="0.01"
          bind:value={sensitivity}
          on:input={applyEnvelopeSettings}
        />
      </div>

      <div class="envelopes">
        <div class="env-item">
          <span>Envelope A</span>
          <div class="meter"><div style={`width:${$audioBands.envelopeA * 100}%`}></div></div>
        </div>
        <div class="env-item">
          <span>Envelope B</span>
          <div class="meter"><div style={`width:${$audioBands.envelopeB * 100}%`}></div></div>
        </div>
      </div>
    </div>

    <aside class="states">
      <h3>States</h3>
      <p class="legend"><span class="dash"></span>Selected</p>
      <p class="legend"><span class="block"></span>Pressed</p>
      <div class="bands">
        <div><span>L</span><div class="meter"><div style={`width:${$audioBands.low * 100}%`}></div></div></div>
        <div><span>M</span><div class="meter"><div style={`width:${$audioBands.mid * 100}%`}></div></div></div>
        <div><span>H</span><div class="meter"><div style={`width:${$audioBands.high * 100}%`}></div></div></div>
        <div><span>F</span><div class="meter"><div style={`width:${$audioBands.full * 100}%`}></div></div></div>
      </div>
      <div class:live={$audioBands.peak} class="peak-light">P1</div>
    </aside>
  </div>

  <audio
    bind:this={audioElement}
    preload="metadata"
    on:loadedmetadata={() =>
      audioRuntime.update((state) => ({
        ...state,
        duration: Number.isFinite(audioElement?.duration) ? audioElement?.duration ?? 0 : 0
      }))}
    on:timeupdate={() =>
      audioRuntime.update((state) => ({
        ...state,
        currentTime: audioElement?.currentTime ?? 0
      }))}
    on:play={() =>
      audioRuntime.update((state) => ({
        ...state,
        isPlaying: true
      }))}
    on:pause={() =>
      audioRuntime.update((state) => ({
        ...state,
        isPlaying: false
      }))}
  ></audio>

  <p class="status">{status}</p>
</section>

<style>
  .panel {
    border: 1px solid var(--border);
    border-radius: 0.6rem;
    padding: 0.65rem;
    background: rgba(15, 15, 16, 0.94);
  }

  .head h2 {
    margin: 0 0 0.2rem;
    font-size: 1rem;
  }

  .head p {
    margin: 0 0 0.45rem;
    color: var(--muted);
    font-size: 0.73rem;
  }

  .layout {
    display: grid;
    gap: 0.55rem;
    grid-template-columns: minmax(0, 1fr) 170px;
  }

  .controls {
    display: grid;
    gap: 0.36rem;
  }

  .row {
    display: flex;
    gap: 0.28rem;
    align-items: center;
    flex-wrap: wrap;
  }

  .row-tight {
    gap: 0.22rem;
  }

  .row-node {
    display: grid;
    grid-template-columns: auto minmax(95px, 1fr) auto 84px auto 84px;
    align-items: center;
    gap: 0.28rem;
  }

  .row-envelope {
    display: grid;
    grid-template-columns: auto 1fr auto 1fr;
    align-items: center;
    gap: 0.28rem;
  }

  label {
    color: var(--muted);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  #track-file {
    display: none;
  }

  .btn,
  select,
  input[type='number'] {
    height: 1.82rem;
    border: 1px solid var(--border);
    border-radius: 0.36rem;
    background: var(--surface-2);
    color: var(--text);
    padding: 0 0.48rem;
    font: inherit;
    font-size: 0.72rem;
    font-weight: 600;
  }

  .btn {
    cursor: pointer;
  }

  .btn-accent {
    background: var(--accent);
    border-color: var(--accent);
    color: #1a1408;
  }

  .mono {
    min-width: 5.3rem;
    border: 1px solid var(--border);
    border-radius: 0.3rem;
    background: var(--surface-2);
    padding: 0.25rem 0.42rem;
    font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
    font-size: 0.78rem;
  }

  .icon {
    width: 1.85rem;
    height: 1.85rem;
    border: 1px solid var(--border);
    border-radius: 0.36rem;
    background: var(--surface-2);
    color: var(--text);
    cursor: pointer;
    font-size: 0.72rem;
  }

  .clock {
    color: var(--muted);
    font-size: 0.7rem;
  }

  .track {
    border: 1px solid var(--border);
    border-radius: 0.36rem;
    background: var(--surface-1);
    padding: 0.3rem 0.42rem;
    color: var(--text);
    font-size: 0.72rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  input[type='range'] {
    width: 100%;
    accent-color: var(--accent);
  }

  .envelopes {
    display: grid;
    gap: 0.24rem;
  }

  .env-item {
    display: grid;
    grid-template-columns: 75px 1fr;
    align-items: center;
    gap: 0.3rem;
    color: var(--muted);
    font-size: 0.7rem;
    text-transform: uppercase;
  }

  .meter {
    height: 0.55rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface-2);
    overflow: hidden;
  }

  .meter > div {
    height: 100%;
    background: linear-gradient(90deg, var(--accent), var(--accent-ok));
    transition: width 80ms linear;
  }

  .states {
    border: 1px solid var(--border);
    border-radius: 0.45rem;
    background: var(--surface-0);
    padding: 0.4rem;
    display: grid;
    align-content: start;
    gap: 0.3rem;
  }

  .states h3 {
    margin: 0;
    color: var(--accent-strong);
    font-size: 0.95rem;
  }

  .legend {
    margin: 0;
    color: var(--text);
    font-size: 0.72rem;
    display: flex;
    align-items: center;
    gap: 0.34rem;
  }

  .dash {
    width: 56px;
    border-top: 2px dashed var(--text);
  }

  .block {
    width: 56px;
    height: 0.65rem;
    background: #d4d4d8;
  }

  .bands {
    display: grid;
    gap: 0.22rem;
    margin-top: 0.1rem;
  }

  .bands > div {
    display: grid;
    grid-template-columns: 10px 1fr;
    align-items: center;
    gap: 0.22rem;
    color: var(--muted);
    font-size: 0.66rem;
  }

  .peak-light {
    margin-top: 0.2rem;
    border: 1px solid var(--border);
    border-radius: 0.3rem;
    min-height: 72px;
    display: grid;
    place-items: center;
    color: var(--text);
    font-size: 1.9rem;
    font-weight: 700;
  }

  .peak-light.live {
    border-color: var(--accent-ok);
    box-shadow: 0 0 0 1px var(--accent-ok) inset, 0 0 14px rgba(16, 185, 129, 0.34);
    color: var(--accent-ok);
  }

  .status {
    margin: 0.45rem 0 0;
    color: var(--accent-ok);
    font-size: 0.72rem;
  }

  audio {
    display: none;
  }

  @media (max-width: 1180px) {
    .layout {
      grid-template-columns: 1fr;
    }

    .row-node,
    .row-envelope {
      grid-template-columns: auto 1fr;
    }
  }
</style>
