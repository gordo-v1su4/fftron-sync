import type { AudioBandState, ReactiveBandTarget } from '$lib/types/engine';

export type TimeShapeStepMode = 'smooth' | 'instant';

export interface TimeShapePoint {
  x: number;
  y: number;
}

export interface VideoTimeShapeCurve {
  points: readonly TimeShapePoint[];
  yRangeBeats: number;
  cycleBeats: number;
}

export interface TimeShapeConfig {
  enabled: boolean;
  bypass: boolean;
  mix: number;
  depth: number;
  beatDurationSeconds: number;
  sourceDurationSeconds: number;
  mode: TimeShapeStepMode;
}

export interface SourceTimeRequest {
  sourceTimeSeconds: number;
  offsetSeconds: number;
  applied: boolean;
  transition: 'hold-crossfade-safe' | 'hard-jump' | 'bypass';
}

export interface AudioTriggerConfig {
  enabled: boolean;
  band: ReactiveBandTarget;
  threshold: number;
  sensitivity: number;
  detail: number;
  triggerShiftMs: number;
}

export interface AudioTriggerResult {
  triggered: boolean;
  bandValue: number;
  effectiveValue: number;
  triggerDensity: number;
  scheduledAtMs: number | null;
}

export function applyVideoTimeShape(
  normalSourceTimeSeconds: number,
  beatPosition: number,
  curve: VideoTimeShapeCurve,
  config: TimeShapeConfig
): SourceTimeRequest {
  const normalizedNormalTime = wrapTime(normalSourceTimeSeconds, config.sourceDurationSeconds);
  const mixDepth = clamp01(config.mix) * clamp01(config.depth);

  if (!config.enabled || config.bypass || mixDepth === 0 || curve.points.length === 0) {
    return {
      sourceTimeSeconds: normalizedNormalTime,
      offsetSeconds: 0,
      applied: false,
      transition: 'bypass'
    };
  }

  const beatPhase = wrapUnit(beatPosition / Math.max(curve.cycleBeats, Number.EPSILON));
  const curveY = sampleCurve(curve.points, beatPhase);
  const offsetSeconds = clamp(curveY, -1, 1) * curve.yRangeBeats * config.beatDurationSeconds * mixDepth;
  const shapedTime = wrapTime(normalizedNormalTime + offsetSeconds, config.sourceDurationSeconds);

  return {
    sourceTimeSeconds: shapedTime,
    offsetSeconds,
    applied: true,
    transition: config.mode === 'smooth' ? 'hold-crossfade-safe' : 'hard-jump'
  };
}

export function evaluateAudioTrigger(
  bands: AudioBandState,
  config: AudioTriggerConfig,
  detectedAtMs: number
): AudioTriggerResult {
  const bandValue = selectBandValue(bands, config.band);
  const effectiveValue = bandValue * Math.max(0, config.sensitivity);
  const triggerDensity = Math.max(1, Math.round(1 + clamp01(config.detail) * 7));
  const triggered = config.enabled && effectiveValue >= Math.max(0, config.threshold);

  return {
    triggered,
    bandValue,
    effectiveValue,
    triggerDensity,
    scheduledAtMs: triggered ? detectedAtMs + config.triggerShiftMs : null
  };
}

export function selectBandValue(bands: AudioBandState, band: ReactiveBandTarget): number {
  switch (band) {
    case 'low':
      return bands.low;
    case 'mid':
      return bands.mid;
    case 'high':
      return bands.high;
    case 'full':
      return bands.full;
  }
}

function sampleCurve(points: readonly TimeShapePoint[], x: number): number {
  const sorted = [...points]
    .map((point) => ({ x: clamp01(point.x), y: point.y }))
    .sort((a, b) => a.x - b.x);

  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0].y;
  if (x <= sorted[0].x) return sorted[0].y;

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (x <= current.x) {
      const span = current.x - previous.x;
      if (span <= 0) return current.y;
      const localT = (x - previous.x) / span;
      return previous.y + (current.y - previous.y) * localT;
    }
  }

  return sorted[sorted.length - 1].y;
}

function wrapUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

function wrapTime(value: number, duration: number): number {
  if (!Number.isFinite(value)) return 0;
  if (!Number.isFinite(duration) || duration <= 0) return Math.max(0, value);
  const wrapped = value % duration;
  return wrapped < 0 ? wrapped + duration : wrapped;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
