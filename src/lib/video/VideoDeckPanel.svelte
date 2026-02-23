<script lang="ts">
  import { onDestroy } from 'svelte';
  import TimelinePanel from '$lib/timeline/TimelinePanel.svelte';
  import { activeSection } from '$lib/stores/runtime';

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

  const play = async () => {
    if (!player) return;
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
    status = 'Stopped';
  };

  onDestroy(() => {
    for (const clip of clips) URL.revokeObjectURL(clip.url);
  });
</script>

<section class="deck-shell">
  <header class="deck-head">
    <h2>Video Deck</h2>
    <p>Upload clips, choose a section, and scrub on the timeline.</p>
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
          }}
          on:timeupdate={() => {
            currentTime = player?.currentTime ?? 0;
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

      <TimelinePanel {duration} {currentTime} onSeek={seekTo} />
      <p class="status">{status}</p>
    </div>
  </div>
</section>

<style>
  .deck-shell {
    border: 1px solid #3b3f4a;
    border-radius: 0.75rem;
    padding: 1rem;
    background: rgba(10, 14, 24, 0.7);
  }

  .deck-head h2 {
    margin: 0;
  }

  .deck-head p {
    margin: 0.3rem 0 0.9rem;
    color: #8fa4c2;
  }

  .deck-grid {
    display: grid;
    grid-template-columns: 300px minmax(0, 1fr);
    gap: 0.9rem;
  }

  .clip-bin {
    border: 1px solid #2d3f58;
    border-radius: 0.65rem;
    padding: 0.65rem;
    background: rgba(8, 16, 29, 0.9);
  }

  #video-upload {
    display: none;
  }

  .upload-btn {
    display: inline-block;
    width: 100%;
    text-align: center;
    padding: 0.5rem 0.7rem;
    border-radius: 0.55rem;
    background: #1f6feb;
    color: #fff;
    cursor: pointer;
    margin-bottom: 0.7rem;
  }

  .clip-list {
    display: grid;
    gap: 0.45rem;
    max-height: 430px;
    overflow: auto;
  }

  .empty {
    color: #7e93af;
    margin: 0;
  }

  .clip-card {
    border: 1px solid #2e425d;
    border-radius: 0.5rem;
    padding: 0.5rem;
    background: #0e1a2c;
  }

  .clip-card.active {
    border-color: #1f6feb;
  }

  .clip-pick {
    border: none;
    background: transparent;
    color: #dbe7fb;
    text-align: left;
    width: 100%;
    cursor: pointer;
    padding: 0;
    font-weight: 600;
  }

  .clip-card p {
    margin: 0.3rem 0;
    color: #8ba2c3;
    font-size: 0.8rem;
  }

  .clip-remove {
    border: 1px solid #3b4f70;
    background: #14233b;
    color: #d0dff7;
    border-radius: 0.35rem;
    padding: 0.22rem 0.45rem;
    cursor: pointer;
    font-size: 0.75rem;
  }

  .player-shell {
    border: 1px solid #2d3f58;
    border-radius: 0.65rem;
    padding: 0.65rem;
    background: rgba(8, 16, 29, 0.9);
    display: grid;
    gap: 0.65rem;
  }

  video,
  .placeholder {
    width: 100%;
    height: 330px;
    border-radius: 0.6rem;
    border: 1px solid #26374d;
    background: #020710;
  }

  .placeholder {
    display: grid;
    place-items: center;
    color: #86a0c0;
    text-align: center;
    padding: 1rem;
  }

  .transport-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .transport-row button {
    border-radius: 0.45rem;
    border: 1px solid #3a5175;
    background: #17325a;
    color: #e6f0ff;
    padding: 0.35rem 0.6rem;
    cursor: pointer;
  }

  .transport-row span {
    color: #93a8c6;
    font-size: 0.88rem;
  }

  .status {
    margin: 0;
    color: #67d4ad;
    font-size: 0.88rem;
  }

  @media (max-width: 1100px) {
    .deck-grid {
      grid-template-columns: 1fr;
    }

    video,
    .placeholder {
      height: 280px;
    }
  }
</style>
