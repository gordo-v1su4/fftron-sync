import { invoke } from '@tauri-apps/api/core';
import type { DecodeBackend, RendererBackend, RuntimeCapabilities, ScheduledAction, TempoState } from '$lib/types/engine';
import type { EngineCueMarker, QuantizeGrid, TheatreExportBundle } from '$lib/types/timeline';

export const validateTheatreBundle = (bundle: TheatreExportBundle): Promise<boolean> =>
  invoke('validate_theatre_bundle', { bundle });

export const importTheatreBundle = (bundle: TheatreExportBundle): Promise<number> =>
  invoke('import_theatre_bundle', { bundle });

export const activateTimelineSection = (section: string): Promise<number> =>
  invoke('activate_timeline_section', { section });

export const listTimelineMarkers = (section?: string): Promise<EngineCueMarker[]> =>
  invoke('list_timeline_markers', { section: section ?? null });

export const getTempoState = (): Promise<TempoState> =>
  invoke('get_tempo_state');

export const setBpm = (bpm: number): Promise<TempoState> =>
  invoke('set_bpm', { bpm });

export const nudgeBpm = (delta: number): Promise<TempoState> =>
  invoke('nudge_bpm', { delta });

export const tapBpm = (timestampMs?: number): Promise<TempoState> =>
  invoke('tap_bpm', { timestampMs: timestampMs ?? null });

export const resyncDownbeat = (timestampMs?: number): Promise<TempoState> =>
  invoke('resync_downbeat', { timestampMs: timestampMs ?? null });

export const setQuantization = (grid: QuantizeGrid): Promise<QuantizeGrid> =>
  invoke('set_quantization', { grid });

export const queuePreviewAction = (
  action: string,
  section?: string,
  quantize?: QuantizeGrid
): Promise<ScheduledAction> =>
  invoke('queue_preview_action', { action, section: section ?? null, quantize: quantize ?? null });

export const queueSectionMarkers = (section?: string): Promise<number> =>
  invoke('queue_section_markers', { section: section ?? null });

export const listScheduledActions = (): Promise<ScheduledAction[]> =>
  invoke('list_scheduled_actions');

export const popDueActions = (timestampMs?: number): Promise<ScheduledAction[]> =>
  invoke('pop_due_actions', { timestampMs: timestampMs ?? null });

export const detectRuntimeCapabilities = (): Promise<RuntimeCapabilities> =>
  invoke('detect_runtime_capabilities');

export const setDecodeBackend = (backend: DecodeBackend): Promise<RuntimeCapabilities> =>
  invoke('set_decode_backend', { backend });

export const setRendererBackend = (backend: RendererBackend): Promise<RuntimeCapabilities> =>
  invoke('set_renderer_backend', { backend });
