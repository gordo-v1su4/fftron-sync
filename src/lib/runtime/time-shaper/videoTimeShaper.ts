import type { AudioBandState, ReactiveBandTarget } from '$lib/types/engine';

export type VideoTimeShapeStepMode = 'smoothStep' | 'instantStep';
export type VideoTimeShapePlaybackMode = 'sourceOffset' | 'stutterRepeat' | 'reverse' | 'tapeStop';
export type AudioTriggerStatus = 'triggered' | 'blockedByThreshold' | 'blockedByDensity' | 'disabled';
export type AudioTriggerBand = ReactiveBandTarget | 'effectRange';

export interface VideoTimeShapePoint {
  x: number;
  y: number;
}

export interface VideoTimeShapeCurve {
  points: readonly VideoTimeShapePoint[];
  cycleBeats: number;
  yRangeBeats: number;
  mix: number;
  depth: number;
  mode: VideoTimeShapeStepMode;
  bypass: boolean;
  playbackMode?: VideoTimeShapePlaybackMode;
  repeatWindowBeats?: number;
  tapeStopFloor?: number;
}

export interface VideoTimeShapeInput {
  normalSourceTimeSeconds: number;
  beatPosition: number;
  secondsPerBeat: number;
  curve: VideoTimeShapeCurve;
}

export interface VideoTimeShapeResult {
  sourceTimeSeconds: number;
  offsetBeats: number;
  phase: number;
  mixAmount: number;
  playbackRate: number;
  metadata: {
    mode: VideoTimeShapeStepMode;
    playbackMode: VideoTimeShapePlaybackMode;
    holdFrame: boolean;
    crossfadeSafe: boolean;
    hardJump: boolean;
    repeatWindowBeats: number | null;
  };
}

export interface AudioTriggerConfig {
  enabled: boolean;
  band: AudioTriggerBand;
  threshold: number;
  sensitivity: number;
  detail: number;
  triggerShiftMs: number;
  lastTriggeredAtMs: number | null;
}

export interface AudioTriggerResult {
  status: AudioTriggerStatus;
  bandValue: number;
  score: number;
  triggerAtMs: number | null;
  minGapMs: number;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const clamp01 = (value: number): number => clamp(value, 0, 1);

const positiveOr = (value: number, fallback: number): number => (value > 0 ? value : fallback);

const sampleCurve = (points: readonly VideoTimeShapePoint[], phase: number): number => {
  if (points.length === 0) return 0;
  const sorted = [...points]
    .map((point) => ({ x: clamp01(point.x), y: clamp(point.y, -1, 1) }))
    .sort((left, right) => left.x - right.x);

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return 0;
  if (phase <= first.x) return first.y;
  if (phase >= last.x) return last.y;

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const from = sorted[index];
    const to = sorted[index + 1];
    if (!from || !to || phase < from.x || phase > to.x) continue;
    const span = positiveOr(to.x - from.x, 1);
    const local = (phase - from.x) / span;
    return from.y + (to.y - from.y) * local;
  }

  return last.y;
};

const wrapPositive = (value: number, modulus: number): number =>
  ((value % modulus) + modulus) % modulus;

const mixTime = (normalTime: number, shapedTime: number, amount: number): number =>
  normalTime + (shapedTime - normalTime) * amount;

const calculatePlaybackRate = (
  playbackMode: VideoTimeShapePlaybackMode,
  phase: number,
  tapeStopFloor: number
): number => {
  switch (playbackMode) {
    case 'reverse':
      return -1;
    case 'tapeStop':
      return 1 - phase * (1 - tapeStopFloor);
    case 'sourceOffset':
    case 'stutterRepeat':
      return 1;
    default: {
      const exhaustive: never = playbackMode;
      return exhaustive;
    }
  }
};

const calculateModeTime = (
  input: VideoTimeShapeInput,
  playbackMode: VideoTimeShapePlaybackMode,
  wrappedBeat: number,
  offsetSeconds: number
): { sourceTimeSeconds: number; repeatWindowBeats: number | null } => {
  const cycleBeats = positiveOr(input.curve.cycleBeats, 1);
  const cycleStartTimeSeconds = input.normalSourceTimeSeconds - wrappedBeat * input.secondsPerBeat;

  switch (playbackMode) {
    case 'sourceOffset':
      return {
        sourceTimeSeconds: input.normalSourceTimeSeconds + offsetSeconds,
        repeatWindowBeats: null
      };
    case 'stutterRepeat': {
      const repeatWindowBeats = positiveOr(input.curve.repeatWindowBeats ?? 0.5, 0.5);
      const repeatBeat = wrapPositive(wrappedBeat, repeatWindowBeats);
      return {
        sourceTimeSeconds: cycleStartTimeSeconds + repeatBeat * input.secondsPerBeat + offsetSeconds,
        repeatWindowBeats
      };
    }
    case 'reverse':
      return {
        sourceTimeSeconds:
          cycleStartTimeSeconds + (cycleBeats - wrappedBeat) * input.secondsPerBeat + offsetSeconds,
        repeatWindowBeats: null
      };
    case 'tapeStop': {
      const phase = wrappedBeat / cycleBeats;
      const tapeStopFloor = clamp(input.curve.tapeStopFloor ?? 0.05, 0, 1);
      const playbackRate = calculatePlaybackRate(playbackMode, phase, tapeStopFloor);
      const dragSeconds = (1 - playbackRate) * wrappedBeat * input.secondsPerBeat * 0.5;
      return {
        sourceTimeSeconds: input.normalSourceTimeSeconds + offsetSeconds - dragSeconds,
        repeatWindowBeats: null
      };
    }
    default: {
      const exhaustive: never = playbackMode;
      return exhaustive;
    }
  }
};

export const applyVideoTimeShape = (input: VideoTimeShapeInput): VideoTimeShapeResult => {
  const cycleBeats = positiveOr(input.curve.cycleBeats, 1);
  const wrappedBeat = wrapPositive(input.beatPosition, cycleBeats);
  const phase = wrappedBeat / cycleBeats;
  const mixAmount = input.curve.bypass ? 0 : clamp01(input.curve.mix) * clamp01(input.curve.depth);
  const sampledY = sampleCurve(input.curve.points, phase);
  const offsetBeats = clamp(
    sampledY * Math.max(0, input.curve.yRangeBeats),
    -input.curve.yRangeBeats,
    input.curve.yRangeBeats
  );
  const playbackMode = input.curve.playbackMode ?? 'sourceOffset';
  const offsetSeconds = offsetBeats * input.secondsPerBeat;
  const modeTime = calculateModeTime(input, playbackMode, wrappedBeat, offsetSeconds);
  const sourceTimeSeconds = mixTime(
    input.normalSourceTimeSeconds,
    modeTime.sourceTimeSeconds,
    mixAmount
  );
  const smooth = input.curve.mode === 'smoothStep';
  const tapeStopFloor = clamp(input.curve.tapeStopFloor ?? 0.05, 0, 1);

  return {
    sourceTimeSeconds,
    offsetBeats: offsetBeats * mixAmount,
    phase,
    mixAmount,
    playbackRate: calculatePlaybackRate(playbackMode, phase, tapeStopFloor),
    metadata: {
      mode: input.curve.mode,
      playbackMode,
      holdFrame: smooth,
      crossfadeSafe: smooth,
      hardJump: !smooth,
      repeatWindowBeats: modeTime.repeatWindowBeats
    }
  };
};

const selectBandValue = (bands: AudioBandState, band: AudioTriggerBand): number =>
  band === 'effectRange' ? bands.envelopeA : bands[band];

export const evaluateAudioTrigger = (
  config: AudioTriggerConfig,
  bands: AudioBandState,
  nowMs: number
): AudioTriggerResult => {
  const bandValue = selectBandValue(bands, config.band);
  const score = bandValue * Math.max(0, config.sensitivity);
  const minGapMs = Math.round(320 - clamp01(config.detail) * 260);

  if (!config.enabled) {
    return { status: 'disabled', bandValue, score, triggerAtMs: null, minGapMs };
  }

  if (score < config.threshold) {
    return { status: 'blockedByThreshold', bandValue, score, triggerAtMs: null, minGapMs };
  }

  if (config.lastTriggeredAtMs !== null && nowMs - config.lastTriggeredAtMs < minGapMs) {
    return { status: 'blockedByDensity', bandValue, score, triggerAtMs: null, minGapMs };
  }

  return {
    status: 'triggered',
    bandValue,
    score,
    triggerAtMs: nowMs + clamp(config.triggerShiftMs, -250, 250),
    minGapMs
  };
};
