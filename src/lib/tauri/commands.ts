import { browser } from '$app/environment';
import { invoke } from '@tauri-apps/api/core';
import type { DecodeBackend, RendererBackend, RuntimeCapabilities, ScheduledAction, TempoState } from '$lib/types/engine';
import type { EngineCueMarker, QuantizeGrid, TheatreExportBundle } from '$lib/types/timeline';

interface LocalRuntimeState {
  runtimeCapabilities: RuntimeCapabilities;
  tempo: TempoState;
  quantizeGrid: QuantizeGrid;
  markers: EngineCueMarker[];
  activeSection: string;
  scheduledActions: ScheduledAction[];
  nextActionId: number;
}

const localState: LocalRuntimeState = {
  runtimeCapabilities: {
    webgl2: true,
    webgpu: false,
    webcodecs: false,
    nativeFfmpeg: false,
    rustFfmpegFeature: false,
    selectedRenderer: 'webgl2',
    selectedDecode: 'htmlvideo'
  },
  tempo: {
    bpm: 120,
    confidence: 1,
    downbeatEpochMs: Date.now(),
    source: 'manual',
    tapCount: 0
  },
  quantizeGrid: '1/4n',
  markers: [],
  activeSection: 'verse-a',
  scheduledActions: [],
  nextActionId: 1
};

const hasTauriRuntime = (): boolean => {
  if (!browser || typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__);
};

const nowMs = (): number => Date.now();

const quantizeDurationMs = (grid: QuantizeGrid, bpm: number): number => {
  const clampedBpm = Math.max(20, Math.min(300, bpm || 120));
  const beatMs = 60000 / clampedBpm;
  switch (grid) {
    case '1n':
      return beatMs * 4;
    case '1/2n':
      return beatMs * 2;
    case '1/4n':
      return beatMs;
    case '1/8n':
      return beatMs / 2;
    case '1/16n':
      return beatMs / 4;
    default:
      return beatMs;
  }
};

const nextQuantizedBoundary = (grid: QuantizeGrid): number => {
  const durationMs = quantizeDurationMs(grid, localState.tempo.bpm);
  const elapsed = Math.max(0, nowMs() - localState.tempo.downbeatEpochMs);
  const slot = Math.ceil(elapsed / durationMs);
  return localState.tempo.downbeatEpochMs + slot * durationMs;
};

const scheduleAction = (action: string, section: string | null, quantize?: QuantizeGrid): ScheduledAction => {
  const grid = quantize ?? localState.quantizeGrid;
  const scheduled: ScheduledAction = {
    id: localState.nextActionId++,
    action,
    section,
    quantize: grid,
    executeAtMs: nextQuantizedBoundary(grid)
  };
  localState.scheduledActions.push(scheduled);
  return scheduled;
};

const validateLocalBundle = (bundle: TheatreExportBundle): boolean => {
  if (!bundle.version?.trim()) return false;
  if (!bundle.fps || bundle.fps <= 0) return false;
  if (!Array.isArray(bundle.sequences) || bundle.sequences.length === 0) return false;
  if (!Array.isArray(bundle.cueMarkers) || bundle.cueMarkers.length === 0) return false;
  if (bundle.cueMarkers.some((marker) => marker.beat < 1 || marker.beat > 4)) return false;
  return true;
};

const refreshBrowserCapabilities = (): RuntimeCapabilities => {
  const webgpu = browser && typeof navigator !== 'undefined' && 'gpu' in navigator;
  const webcodecs = browser && typeof window !== 'undefined' && 'VideoDecoder' in window;

  localState.runtimeCapabilities = {
    ...localState.runtimeCapabilities,
    webgl2: true,
    webgpu,
    webcodecs,
    nativeFfmpeg: false,
    rustFfmpegFeature: false,
    selectedRenderer: webgpu ? localState.runtimeCapabilities.selectedRenderer : 'webgl2',
    selectedDecode:
      localState.runtimeCapabilities.selectedDecode === 'webcodecs' && !webcodecs
        ? 'htmlvideo'
        : localState.runtimeCapabilities.selectedDecode
  };

  return localState.runtimeCapabilities;
};

const invokeOrFallback = async <T>(
  command: string,
  args: Record<string, unknown>,
  fallback: () => T | Promise<T>
): Promise<T> => {
  if (hasTauriRuntime()) {
    return invoke<T>(command, args);
  }
  return fallback();
};

export const validateTheatreBundle = (bundle: TheatreExportBundle): Promise<boolean> =>
  invokeOrFallback('validate_theatre_bundle', { bundle }, () => validateLocalBundle(bundle));

export const importTheatreBundle = (bundle: TheatreExportBundle): Promise<number> =>
  invokeOrFallback('import_theatre_bundle', { bundle }, () => {
    if (!validateLocalBundle(bundle)) {
      throw new Error('Theatre bundle validation failed');
    }
    localState.markers = [...bundle.cueMarkers].sort((a, b) => (a.bar === b.bar ? a.beat - b.beat : a.bar - b.bar));
    localState.activeSection = localState.markers[0]?.section ?? 'verse-a';
    return localState.markers.length;
  });

export const activateTimelineSection = (section: string): Promise<number> =>
  invokeOrFallback('activate_timeline_section', { section }, () => {
    const validSections = new Set(localState.markers.map((marker) => marker.section));
    if (validSections.size > 0 && !validSections.has(section)) {
      throw new Error(`section '${section}' was not found`);
    }
    localState.activeSection = section;
    return localState.markers.filter((marker) => marker.section === section).length;
  });

export const listTimelineMarkers = (section?: string): Promise<EngineCueMarker[]> =>
  invokeOrFallback('list_timeline_markers', { section: section ?? null }, () => {
    const selected = section ?? localState.activeSection;
    return localState.markers.filter((marker) => marker.section === selected);
  });

export const getTempoState = (): Promise<TempoState> =>
  invokeOrFallback('get_tempo_state', {}, () => localState.tempo);

export const setBpm = (bpm: number): Promise<TempoState> =>
  invokeOrFallback('set_bpm', { bpm }, () => {
    localState.tempo = {
      ...localState.tempo,
      bpm: Math.max(20, Math.min(300, bpm)),
      source: 'manual',
      confidence: 1
    };
    return localState.tempo;
  });

export const nudgeBpm = (delta: number): Promise<TempoState> =>
  invokeOrFallback('nudge_bpm', { delta }, () => {
    localState.tempo = {
      ...localState.tempo,
      bpm: Math.max(20, Math.min(300, localState.tempo.bpm + delta)),
      source: 'manual'
    };
    return localState.tempo;
  });

export const tapBpm = (timestampMs?: number): Promise<TempoState> =>
  invokeOrFallback('tap_bpm', { timestampMs: timestampMs ?? null }, () => {
    const now = timestampMs ?? nowMs();
    const beatMs = Math.max(250, Math.min(3000, now - localState.tempo.downbeatEpochMs));
    localState.tempo = {
      ...localState.tempo,
      bpm: Math.max(20, Math.min(300, 60000 / beatMs)),
      source: 'tap',
      confidence: 0.8,
      tapCount: localState.tempo.tapCount + 1,
      downbeatEpochMs: now
    };
    return localState.tempo;
  });

export const resyncDownbeat = (timestampMs?: number): Promise<TempoState> =>
  invokeOrFallback('resync_downbeat', { timestampMs: timestampMs ?? null }, () => {
    localState.tempo = {
      ...localState.tempo,
      downbeatEpochMs: timestampMs ?? nowMs()
    };
    return localState.tempo;
  });

export const setQuantization = (grid: QuantizeGrid): Promise<QuantizeGrid> =>
  invokeOrFallback('set_quantization', { grid }, () => {
    localState.quantizeGrid = grid;
    return grid;
  });

export const queuePreviewAction = (
  action: string,
  section?: string,
  quantize?: QuantizeGrid
): Promise<ScheduledAction> =>
  invokeOrFallback('queue_preview_action', { action, section: section ?? null, quantize: quantize ?? null }, () =>
    scheduleAction(action, section ?? localState.activeSection, quantize)
  );

export const queueSectionMarkers = (section?: string): Promise<number> =>
  invokeOrFallback('queue_section_markers', { section: section ?? null }, () => {
    const selected = section ?? localState.activeSection;
    const sectionMarkers = localState.markers.filter((marker) => marker.section === selected);
    for (const marker of sectionMarkers) {
      scheduleAction(marker.action, selected, marker.quantize);
    }
    return sectionMarkers.length;
  });

export const listScheduledActions = (): Promise<ScheduledAction[]> =>
  invokeOrFallback('list_scheduled_actions', {}, () => [...localState.scheduledActions]);

export const popDueActions = (timestampMs?: number): Promise<ScheduledAction[]> =>
  invokeOrFallback('pop_due_actions', { timestampMs: timestampMs ?? null }, () => {
    const now = timestampMs ?? nowMs();
    const due = localState.scheduledActions.filter((entry) => entry.executeAtMs <= now + 5);
    localState.scheduledActions = localState.scheduledActions.filter((entry) => entry.executeAtMs > now + 5);
    return due;
  });

export const detectRuntimeCapabilities = (): Promise<RuntimeCapabilities> =>
  invokeOrFallback('detect_runtime_capabilities', {}, () => refreshBrowserCapabilities());

export const setDecodeBackend = (backend: DecodeBackend): Promise<RuntimeCapabilities> =>
  invokeOrFallback('set_decode_backend', { backend }, () => {
    refreshBrowserCapabilities();
    if (backend === 'webcodecs' && !localState.runtimeCapabilities.webcodecs) {
      throw new Error('WebCodecs is unavailable in this browser');
    }
    if (backend === 'native_ffmpeg') {
      throw new Error('native_ffmpeg is only available in desktop runtime');
    }
    localState.runtimeCapabilities.selectedDecode = backend;
    return localState.runtimeCapabilities;
  });

export const setRendererBackend = (backend: RendererBackend): Promise<RuntimeCapabilities> =>
  invokeOrFallback('set_renderer_backend', { backend }, () => {
    refreshBrowserCapabilities();
    if (backend === 'webgpu' && !localState.runtimeCapabilities.webgpu) {
      throw new Error('WebGPU is unavailable in this browser');
    }
    localState.runtimeCapabilities.selectedRenderer = backend;
    return localState.runtimeCapabilities;
  });
