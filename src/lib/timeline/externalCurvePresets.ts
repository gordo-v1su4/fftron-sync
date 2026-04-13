import type { EssentiaFullResponse } from "$lib/services/essentia";
import {
  mapNormalizedToRange,
  mapRangeToNormalized,
} from "$lib/runtime/automationBounds";

export type CurvePoint = { x: number; y: number };
export type InterpolationMode =
  | "linear"
  | "smoothstep"
  | "ease_in"
  | "ease_out"
  | "step";

type LoopMode = "whole" | "bar" | "beat";
type TimeSignature = { beatsPerBar: number; beatUnit: number };
type PresetPoint = { x: number; y: number; tension?: number };

interface SourcePreset {
  id: string;
  name: string;
  loopMode: LoopMode;
  points: PresetPoint[];
  interpolation: InterpolationMode;
  buildPoints?: (
    durationSeconds: number,
    bpm: number,
    ts: TimeSignature,
  ) => PresetPoint[];
}

export interface TrackPreset {
  id: string;
  name: string;
  points: CurvePoint[];
  interpolation: InterpolationMode;
}

const timelineTimeSignature: TimeSignature = {
  beatsPerBar: 4,
  beatUnit: 4,
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const normalizePoints = (points: PresetPoint[]): CurvePoint[] => {
  const sorted = [...points]
    .map((point) => ({ x: clamp01(point.x), y: clamp01(point.y) }))
    .sort((left, right) => left.x - right.x);
  const unique: CurvePoint[] = [];

  for (const point of sorted) {
    const previous = unique[unique.length - 1];
    if (!previous || Math.abs(previous.x - point.x) > 1e-6) {
      unique.push(point);
    } else {
      unique[unique.length - 1] = point;
    }
  }

  return unique;
};

const getSecondsPerBeat = (bpm: number): number =>
  60 / Math.max(bpm, 1);

const getSecondsPerBar = (
  bpm: number,
  ts: TimeSignature,
): number => getSecondsPerBeat(bpm) * ts.beatsPerBar;

const generatePresetPoints = (
  preset: SourcePreset,
  durationSeconds: number,
  bpm: number,
  phaseMultiplier = 1,
): CurvePoint[] => {
  const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0
    ? durationSeconds
    : 8;
  const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 120;
  const effectiveBpm = Math.max(1, safeBpm * Math.max(0.25, phaseMultiplier));

  if (preset.buildPoints) {
    return normalizePoints(
      preset.buildPoints(safeDuration, effectiveBpm, timelineTimeSignature),
    );
  }

  if (preset.loopMode === "whole" || safeDuration <= 0) {
    return normalizePoints(preset.points);
  }

  const secondsPerBeat = getSecondsPerBeat(effectiveBpm);
  const secondsPerBar = getSecondsPerBar(effectiveBpm, timelineTimeSignature);
  const loops =
    preset.loopMode === "bar"
      ? Math.max(1, Math.ceil(safeDuration / secondsPerBar))
      : Math.max(1, Math.ceil(safeDuration / secondsPerBeat));

  const generated: PresetPoint[] = [];

  for (let loopIndex = 0; loopIndex < loops; loopIndex += 1) {
    const start = loopIndex / loops;
    const width = 1 / loops;
    for (const point of preset.points) {
      generated.push({
        x: start + point.x * width,
        y: point.y,
      });
    }
  }

  return normalizePoints(generated);
};

function mulberry32(seed: number) {
  return function next() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getBeatWidth(durationSeconds: number, bpm: number) {
  const beatSeconds = 60 / Math.max(bpm, 1);
  const totalBeats = Math.max(1, durationSeconds / beatSeconds);
  return 1 / totalBeats;
}

function buildOrganicStutterA(
  durationSeconds: number,
  bpm: number,
  ts: TimeSignature,
): PresetPoint[] {
  const seed =
    Math.round(durationSeconds * 1000) * 10007 +
    Math.round(bpm * 10) * 7919 +
    ts.beatsPerBar * 503 +
    ts.beatUnit * 131;
  const rnd = mulberry32(seed);
  const points: PresetPoint[] = [{ x: 0, y: 0 }];
  const beatW = getBeatWidth(durationSeconds, bpm);
  let t = 0;

  while (t < 1 - 1e-7) {
    if (rnd() < 0.38) {
      const gap = beatW * (0.12 + rnd() * 0.42);
      t = clamp01(t + gap);
      points.push({ x: t, y: 0 });
      continue;
    }

    const burstW = beatW * (0.18 + rnd() * 0.62);
    let consumed = 0;
    while (consumed < burstW - 1e-8 && t < 1 - 1e-8) {
      const remaining = burstW - consumed;
      const width = Math.min(remaining, beatW * (0.035 + rnd() * 0.14));
      if (width < 1e-8) break;
      const height = 0.28 + rnd() * 0.72;
      const up = t + width * (0.22 + rnd() * 0.28);
      const down = clamp01(t + width);
      if (up > t + 1e-9) {
        points.push({ x: up, y: height * (0.55 + rnd() * 0.45) });
      }
      points.push({ x: down, y: 0 });
      t = down;
      consumed += width;
    }

    if (rnd() < 0.22 && t < 1 - 1e-7) {
      const pw = beatW * (0.1 + rnd() * 0.22);
      const ph = 0.5 + rnd() * 0.48;
      const t1 = clamp01(t + pw * 0.08);
      const t2 = clamp01(t + pw * 0.42);
      const t3 = clamp01(t + pw * 0.78);
      const t4 = clamp01(t + pw);
      points.push({ x: t1, y: ph });
      points.push({ x: t2, y: ph * (0.82 + rnd() * 0.16) });
      points.push({ x: t3, y: ph * (0.88 + rnd() * 0.12) });
      points.push({ x: t4, y: 0 });
      t = t4;
    }
  }

  points.push({ x: 1, y: 0 });
  return points.map((point) => ({
    ...point,
    x: clamp01(point.x),
    y: clamp01(point.y),
  }));
}

function buildOrganicStutterB(
  durationSeconds: number,
  bpm: number,
  ts: TimeSignature,
): PresetPoint[] {
  const seed =
    Math.round(durationSeconds * 1000) * 20011 +
    Math.round(bpm * 10) * 9973 +
    ts.beatsPerBar * 17;
  const rnd = mulberry32(seed);
  const points: PresetPoint[] = [{ x: 0, y: 0 }];
  const beatW = getBeatWidth(durationSeconds, bpm);
  let t = 0;

  while (t < 1 - 1e-7) {
    if (rnd() < 0.52) {
      const gap = beatW * (0.35 + rnd() * 0.85);
      t = clamp01(t + gap);
      points.push({ x: t, y: 0 });
      continue;
    }

    const width = beatW * (0.15 + rnd() * 0.45);
    const height = 0.45 + rnd() * 0.55;
    const peakX = t + width * (0.55 + rnd() * 0.35);
    const endX = clamp01(t + width);
    points.push({ x: peakX, y: height });
    points.push({ x: endX, y: 0 });
    t = endX;

    if (rnd() < 0.35 && t < 1 - 1e-7) {
      const micro = beatW * (0.04 + rnd() * 0.08);
      for (let k = 0; k < 3 && t < 1; k += 1) {
        const mw = micro * (0.25 + rnd() * 0.5);
        const mh = height * (0.35 + rnd() * 0.45);
        const mx = clamp01(t + mw * 0.5);
        const ex = clamp01(t + mw);
        points.push({ x: mx, y: mh });
        points.push({ x: ex, y: 0 });
        t = ex;
      }
    }
  }

  points.push({ x: 1, y: 0 });
  return points.map((point) => ({
    ...point,
    x: clamp01(point.x),
    y: clamp01(point.y),
  }));
}

function buildOrganicSpeedRamp(
  durationSeconds: number,
  bpm: number,
  ts: TimeSignature,
): PresetPoint[] {
  const seed =
    Math.round(durationSeconds * 1000) * 13007 +
    Math.round(bpm * 10) * 401 +
    ts.beatsPerBar * 23;
  const rnd = mulberry32(seed);
  const totalBeats = Math.max(
    1,
    Math.ceil(durationSeconds / (60 / Math.max(bpm, 1))),
  );
  const baseY = 0.1 + rnd() * 0.1;
  const points: PresetPoint[] = [];
  const eps = 1e-5;

  for (let beat = 0; beat < totalBeats; beat += 1) {
    const start = beat / totalBeats;
    const end = (beat + 1) / totalBeats;
    const width = end - start;
    const peakX = start + width * (0.62 + rnd() * 0.34);
    const peakY = 0.48 + rnd() * 0.52;

    if (beat === 0) {
      points.push({ x: start, y: baseY });
    } else {
      const last = points[points.length - 1];
      if (Math.abs(last.x - start) > 1e-8) {
        points.push({ x: start, y: baseY });
      }
    }

    points.push({ x: peakX, y: peakY });
    const snapX = Math.min(
      peakX + Math.max(eps, width * 0.012),
      end - eps,
    );
    points.push({ x: snapX, y: baseY });

    if (end - snapX > 1e-6) {
      points.push({ x: end, y: baseY });
    }
  }

  if (points.length === 0 || points[points.length - 1].x < 1 - 1e-8) {
    points.push({ x: 1, y: baseY });
  }

  return points.map((point) => ({
    ...point,
    x: clamp01(point.x),
    y: clamp01(point.y),
  }));
}

function buildOrganicSpeedRampWild(
  durationSeconds: number,
  bpm: number,
  ts: TimeSignature,
): PresetPoint[] {
  const seed =
    Math.round(durationSeconds * 1000) * 17003 +
    Math.round(bpm * 10) * 11003 +
    ts.beatsPerBar * 29;
  const rnd = mulberry32(seed);
  const totalBeats = Math.max(
    1,
    Math.ceil(durationSeconds / (60 / Math.max(bpm, 1))),
  );
  const baseY = 0.08 + rnd() * 0.12;
  const widths: number[] = [];
  let sum = 0;
  const eps = 1e-5;

  for (let index = 0; index < totalBeats; index += 1) {
    const width = (1 / totalBeats) * (0.82 + rnd() * 0.38);
    widths.push(width);
    sum += width;
  }

  const boundaries: number[] = [0];
  for (let index = 0; index < totalBeats; index += 1) {
    boundaries.push(boundaries[index] + widths[index] / sum);
  }
  boundaries[boundaries.length - 1] = 1;

  const points: PresetPoint[] = [];
  for (let beat = 0; beat < totalBeats; beat += 1) {
    const start = boundaries[beat];
    const end = boundaries[beat + 1];
    const width = end - start;
    if (width < 1e-8) continue;

    const peakX = start + width * (0.52 + rnd() * 0.42);
    const peakY = 0.4 + rnd() * 0.6;

    if (beat === 0) {
      points.push({ x: start, y: baseY });
    } else {
      const last = points[points.length - 1];
      if (Math.abs(last.x - start) > 1e-8) {
        points.push({ x: start, y: baseY });
      }
    }

    points.push({ x: peakX, y: peakY });
    const snapX = Math.min(
      peakX + Math.max(eps, width * (0.008 + rnd() * 0.022)),
      end - eps,
    );
    points.push({ x: snapX, y: baseY });

    if (end - snapX > 1e-6) {
      points.push({ x: end, y: baseY });
    }
  }

  if (points.length === 0 || points[points.length - 1].x < 1 - 1e-8) {
    points.push({ x: 1, y: baseY });
  }

  return points.map((point) => ({
    ...point,
    x: clamp01(point.x),
    y: clamp01(point.y),
  }));
}

const stutterSourcePresets: SourcePreset[] = [
  {
    id: "linear-rise",
    name: "Linear Rise",
    loopMode: "whole",
    interpolation: "linear",
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
  },
  {
    id: "sidechain-pump",
    name: "Sidechain Pump",
    loopMode: "beat",
    interpolation: "smoothstep",
    points: [
      { x: 0, y: 0 },
      { x: 0.25, y: 0.58 },
      { x: 0.5, y: 0.92 },
      { x: 0.75, y: 1 },
      { x: 1, y: 0 },
    ],
  },
  {
    id: "saw-lfo",
    name: "Saw LFO",
    loopMode: "beat",
    interpolation: "linear",
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
  },
  {
    id: "reverse-swell",
    name: "Reverse Swell",
    loopMode: "bar",
    interpolation: "ease_in",
    points: [
      { x: 0, y: 0 },
      { x: 0.75, y: 1 },
      { x: 0.875, y: 0.45 },
      { x: 1, y: 0 },
    ],
  },
  {
    id: "trance-gate",
    name: "Trance Gate",
    loopMode: "bar",
    interpolation: "step",
    points: [
      { x: 0, y: 1 },
      { x: 0.125, y: 0.15 },
      { x: 0.25, y: 1 },
      { x: 0.375, y: 0.15 },
      { x: 0.5, y: 1 },
      { x: 0.625, y: 0.15 },
      { x: 0.75, y: 1 },
      { x: 0.875, y: 0.15 },
      { x: 1, y: 1 },
    ],
  },
  {
    id: "organic-stutter-a",
    name: "Glitch Stutter (Dense)",
    loopMode: "whole",
    interpolation: "linear",
    points: [],
    buildPoints: buildOrganicStutterA,
  },
  {
    id: "organic-stutter-b",
    name: "Glitch Stutter (Sparse)",
    loopMode: "whole",
    interpolation: "linear",
    points: [],
    buildPoints: buildOrganicStutterB,
  },
];

const speedSourcePresets: SourcePreset[] = [
  {
    id: "tempo-neutral",
    name: "Neutral",
    loopMode: "whole",
    interpolation: "linear",
    points: [
      { x: 0, y: 0.5 },
      { x: 1, y: 0.5 },
    ],
  },
  {
    id: "tempo-saw-beat",
    name: "Saw Wobble (Beat)",
    loopMode: "beat",
    interpolation: "linear",
    points: [
      { x: 0, y: 0.3875 },
      { x: 1, y: 0.7625 },
    ],
  },
  {
    id: "tempo-dip-beat",
    name: "Beat Dip",
    loopMode: "beat",
    interpolation: "smoothstep",
    points: [
      { x: 0, y: 0.875 },
      { x: 0.3, y: 0.815 },
      { x: 0.55, y: 0.425 },
      { x: 0.82, y: 0.815 },
      { x: 1, y: 0.875 },
    ],
  },
  {
    id: "tempo-bar-wave",
    name: "Bar Wave",
    loopMode: "bar",
    interpolation: "smoothstep",
    points: [
      { x: 0, y: 0.875 },
      { x: 0.35, y: 0.71 },
      { x: 0.65, y: 0.3875 },
      { x: 1, y: 0.875 },
    ],
  },
  {
    id: "tempo-accelerate",
    name: "Accelerate",
    loopMode: "whole",
    interpolation: "ease_in",
    points: [
      { x: 0, y: 0.3875 },
      { x: 0.4, y: 0.4625 },
      { x: 0.75, y: 0.59 },
      { x: 1, y: 0.71 },
    ],
  },
  {
    id: "tempo-decelerate",
    name: "Decelerate",
    loopMode: "whole",
    interpolation: "ease_out",
    points: [
      { x: 0, y: 0.71 },
      { x: 0.35, y: 0.59 },
      { x: 0.7, y: 0.485 },
      { x: 1, y: 0.3875 },
    ],
  },
  {
    id: "tempo-trance-gate",
    name: "Step Gate",
    loopMode: "bar",
    interpolation: "step",
    points: [
      { x: 0, y: 0.875 },
      { x: 0.125, y: 0.425 },
      { x: 0.25, y: 0.875 },
      { x: 0.375, y: 0.425 },
      { x: 0.5, y: 0.875 },
      { x: 0.625, y: 0.425 },
      { x: 0.75, y: 0.875 },
      { x: 0.875, y: 0.425 },
      { x: 1, y: 0.875 },
    ],
  },
  {
    id: "organic-speed-ramp",
    name: "Speed Ramp (Beat Saw)",
    loopMode: "whole",
    interpolation: "linear",
    points: [],
    buildPoints: buildOrganicSpeedRamp,
  },
  {
    id: "organic-speed-ramp-wild",
    name: "Speed Ramp (Wild Grid)",
    loopMode: "whole",
    interpolation: "linear",
    points: [],
    buildPoints: buildOrganicSpeedRampWild,
  },
];

const toInternalSpeedPoint = (
  point: CurvePoint,
  speedMinBound: number,
  speedMaxBound: number,
): CurvePoint => ({
  x: point.x,
  y: mapRangeToNormalized(
    mapNormalizedToRange(clamp01(point.y), speedMinBound, speedMaxBound),
    speedMinBound,
    speedMaxBound,
  ),
});

const toInternalSpeedMultiplierPoint = (
  x: number,
  multiplier: number,
  speedMinBound: number,
  speedMaxBound: number,
): CurvePoint => ({
  x: clamp01(x),
  y: mapRangeToNormalized(
    Math.max(speedMinBound, Math.min(speedMaxBound, multiplier)),
    speedMinBound,
    speedMaxBound,
  ),
});

const normalizeCurvePoints = (points: CurvePoint[]): CurvePoint[] =>
  normalizePoints(points.map((point) => ({ x: point.x, y: point.y })));

const stretchCurveToFullHeight = (
  points: CurvePoint[],
  neutralY = 0.5,
): CurvePoint[] => {
  if (points.length === 0) return points;
  const yValues = points.map((point) => point.y);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);
  const span = maxY - minY;
  if (span < 1e-5) {
    return points.map((point) => ({ ...point, y: clamp01(neutralY) }));
  }

  return points.map((point) => ({
    ...point,
    y: clamp01((point.y - minY) / span),
  }));
};

type AnchorCandidate = {
  time: number;
  score: number;
};

type RampProfile = "ease_in" | "ease_out" | "ease_in_out" | "noise";

type AnchorSelectionOptions = {
  limit: number;
  minSpacingSeconds: number;
  minScoreRatio?: number;
};

const sampleEnergyCurveAt = (
  curve: number[],
  timeSeconds: number,
  durationSeconds: number,
): number => {
  if (curve.length === 0 || durationSeconds <= 0) return 0.5;
  const normalizedTime = clamp01(timeSeconds / durationSeconds);
  const index = Math.round(normalizedTime * Math.max(0, curve.length - 1));
  return curve[Math.max(0, Math.min(curve.length - 1, index))] ?? 0.5;
};

const buildAnchorCandidates = (
  times: number[],
  curve: number[],
  durationSeconds: number,
  bpm: number,
): AnchorCandidate[] => {
  const safeDuration = Math.max(durationSeconds, 0.001);
  const secondsPerBeat = getSecondsPerBeat(Math.max(bpm, 1));
  const beforeWindow = Math.max(0.04, secondsPerBeat * 0.4);
  const afterWindow = Math.max(0.03, secondsPerBeat * 0.16);

  return times
    .filter((time) => Number.isFinite(time) && time >= 0 && time <= safeDuration)
    .map((time) => {
      const energy = sampleEnergyCurveAt(curve, time, safeDuration);
      const before = sampleEnergyCurveAt(
        curve,
        Math.max(0, time - beforeWindow),
        safeDuration,
      );
      const after = sampleEnergyCurveAt(
        curve,
        Math.min(safeDuration, time + afterWindow),
        safeDuration,
      );
      const attack = Math.max(0, energy - before);
      const sustain = Math.max(0, after - before);
      return {
        time,
        score: energy * 0.55 + attack * 0.35 + sustain * 0.1,
      };
    });
};

const selectStrongestAnchors = (
  candidates: AnchorCandidate[],
  { limit, minSpacingSeconds, minScoreRatio = 0 }: AnchorSelectionOptions,
): AnchorCandidate[] => {
  const sorted = [...candidates].sort((left, right) => right.score - left.score);
  const selected: AnchorCandidate[] = [];
  const topScore = sorted[0]?.score ?? 0;
  const bottomScore = sorted[sorted.length - 1]?.score ?? 0;
  const scoreSpan = Math.max(0.0001, topScore - bottomScore);

  for (const candidate of sorted) {
    const normalizedScore = Math.abs(topScore - bottomScore) < 1e-6
      ? 1
      : (candidate.score - bottomScore) / scoreSpan;
    if (normalizedScore < minScoreRatio) continue;
    const isTooClose = selected.some(
      (existing) => Math.abs(existing.time - candidate.time) < minSpacingSeconds,
    );
    if (!isTooClose) {
      selected.push(candidate);
    }
    if (selected.length >= limit) break;
  }

  return selected.sort((left, right) => left.time - right.time);
};

const selectDistributedAnchors = (
  candidates: AnchorCandidate[],
  durationSeconds: number,
  bucketCount: number,
  minScoreRatio = 0,
): AnchorCandidate[] => {
  if (candidates.length === 0 || durationSeconds <= 0 || bucketCount <= 0) return [];
  const sorted = [...candidates].sort((left, right) => left.time - right.time);
  const topScore = Math.max(...sorted.map((candidate) => candidate.score));
  const bottomScore = Math.min(...sorted.map((candidate) => candidate.score));
  const scoreSpan = Math.max(0.0001, topScore - bottomScore);
  const bucketDuration = durationSeconds / bucketCount;
  const selected: AnchorCandidate[] = [];

  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
    const start = bucketIndex * bucketDuration;
    const end = bucketIndex === bucketCount - 1
      ? durationSeconds + 1e-6
      : start + bucketDuration;
    const bucketCandidates = sorted.filter(
      (candidate) => candidate.time >= start && candidate.time < end,
    );
    if (bucketCandidates.length === 0) continue;
    const best = bucketCandidates.sort((left, right) => right.score - left.score)[0];
    const normalizedScore = Math.abs(topScore - bottomScore) < 1e-6
      ? 1
      : (best.score - bottomScore) / scoreSpan;
    if (normalizedScore >= minScoreRatio) {
      selected.push(best);
    }
  }

  return selected;
};

const mergeAnchors = (
  primary: AnchorCandidate[],
  secondary: AnchorCandidate[],
  minSpacingSeconds: number,
): AnchorCandidate[] => {
  const merged: AnchorCandidate[] = [...primary];
  const orderedSecondary = [...secondary].sort((left, right) => left.time - right.time);

  for (const candidate of orderedSecondary) {
    const overlaps = merged.some(
      (existing) => Math.abs(existing.time - candidate.time) < minSpacingSeconds,
    );
    if (!overlaps) {
      merged.push(candidate);
    }
  }

  return merged.sort((left, right) => left.time - right.time);
};

const buildAnchoredDriftCandidates = (
  anchors: AnchorCandidate[],
  durationSeconds: number,
  bpm: number,
): AnchorCandidate[] => {
  const safeDuration = Math.max(durationSeconds, 0.001);
  const safeBpm = Math.max(bpm, 1);
  const rnd = mulberry32(
    Math.round(safeDuration * 1000) * 3709 +
    Math.round(safeBpm * 100) * 9013 +
    anchors.length * 101,
  );
  const microWidth = Math.max(0.025, getSecondsPerBeat(safeBpm) * 0.16);
  const expanded: AnchorCandidate[] = [];

  for (const anchor of anchors) {
    expanded.push(anchor);
    const leftTime = Math.max(
      0,
      Math.min(safeDuration, anchor.time - microWidth * (0.45 + rnd() * 0.9)),
    );
    const rightTime = Math.max(
      0,
      Math.min(safeDuration, anchor.time + microWidth * (0.45 + rnd() * 0.9)),
    );
    expanded.push({
      time: leftTime,
      score: anchor.score * (0.42 + rnd() * 0.22),
    });
    expanded.push({
      time: rightTime,
      score: anchor.score * (0.38 + rnd() * 0.24),
    });
  }

  return expanded.sort((left, right) => left.time - right.time);
};

const quantizeAnchorTime = (
  timeSeconds: number,
  bpm: number,
  phaseMultiplier: number,
): number => {
  const secondsPerBar = getSecondsPerBar(Math.max(bpm, 1), timelineTimeSignature);
  const phaseGridSeconds = secondsPerBar / Math.max(0.25, phaseMultiplier);
  if (!Number.isFinite(phaseGridSeconds) || phaseGridSeconds <= 0) return timeSeconds;
  return Math.round(timeSeconds / phaseGridSeconds) * phaseGridSeconds;
};

const buildPunchPreset = ({
  anchors,
  id,
  name,
  durationSeconds,
  bpm,
  phaseMultiplier,
  speedMinBound,
  speedMaxBound,
  profile,
}: {
  anchors: AnchorCandidate[];
  id: string;
  name: string;
  durationSeconds: number;
  bpm: number;
  phaseMultiplier: number;
  speedMinBound: number;
  speedMaxBound: number;
  profile: RampProfile;
}): TrackPreset => {
  const safeDuration = Math.max(durationSeconds, 0.001);
  const baselineSpeed = Math.max(speedMinBound, Math.min(speedMaxBound, 1));
  const minScore = Math.min(...anchors.map((anchor) => anchor.score));
  const maxScore = Math.max(...anchors.map((anchor) => anchor.score));
  const scoreSpan = Math.max(0.0001, maxScore - minScore);
  const points: CurvePoint[] = [
    toInternalSpeedMultiplierPoint(0, baselineSpeed, speedMinBound, speedMaxBound),
  ];

  anchors.forEach((anchor, index) => {
    const anchorTime = Math.max(
      0,
      Math.min(
        safeDuration,
        quantizeAnchorTime(anchor.time, bpm, phaseMultiplier),
      ),
    );
    const previousAnchorTime = index === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            anchorTime,
            quantizeAnchorTime(anchors[index - 1].time, bpm, phaseMultiplier),
          ),
        );
    const nextAnchorTime = index === anchors.length - 1
      ? safeDuration
      : Math.min(
          safeDuration,
          Math.max(
            anchorTime,
            quantizeAnchorTime(anchors[index + 1].time, bpm, phaseMultiplier),
          ),
        );
    const leadSpanSeconds = Math.max(0.42, anchorTime - previousAnchorTime);
    const releaseSpanSeconds = Math.max(0.48, nextAnchorTime - anchorTime);
    const leadStartFactor =
      profile === "ease_out" ? 0.44 : profile === "noise" ? 0.9 : 0.86;
    const leadMidFactor =
      profile === "ease_out" ? 0.18 : profile === "ease_in" ? 0.56 : 0.42;
    const leadLateFactor =
      profile === "ease_out" ? 0.04 : profile === "ease_in" ? 0.2 : 0.12;
    const holdFactor =
      profile === "ease_out" ? 0.24 : profile === "noise" ? 0.4 : 0.34;
    const settleFactor =
      profile === "ease_in" ? 0.48 : profile === "ease_out" ? 0.78 : 0.62;
    const tailMidFactor =
      profile === "ease_in" ? 0.8 : profile === "ease_out" ? 0.92 : 0.84;
    const anchorNorm = clamp01(anchorTime / safeDuration);
    const leadStartNorm = clamp01(
      (anchorTime - leadSpanSeconds * leadStartFactor) / safeDuration,
    );
    const leadMidNorm = clamp01(
      (anchorTime - leadSpanSeconds * leadMidFactor) / safeDuration,
    );
    const leadLateNorm = clamp01(
      (anchorTime - leadSpanSeconds * leadLateFactor) / safeDuration,
    );
    const settleNorm = clamp01(
      (anchorTime + releaseSpanSeconds * settleFactor) / safeDuration,
    );
    const holdEndNorm = clamp01(
      (anchorTime + releaseSpanSeconds * holdFactor) / safeDuration,
    );
    const tailMidNorm = clamp01(
      (anchorTime + releaseSpanSeconds * tailMidFactor) / safeDuration,
    );
    const tailNorm = clamp01(
      (anchorTime + releaseSpanSeconds * 0.9) / safeDuration,
    );
    const scoreNorm = (anchor.score - minScore) / scoreSpan;
    const accentHighSpeed = Math.max(
      baselineSpeed,
      Math.min(speedMaxBound, 1.22 + scoreNorm * 0.56),
    );
    const accentLowSpeed = Math.max(
      speedMinBound,
      Math.min(baselineSpeed, 0.9 - scoreNorm * 0.14),
    );
    const highDelta = accentHighSpeed - baselineSpeed;
    const lowDelta = baselineSpeed - accentLowSpeed;
    const startGlideSpeed =
      profile === "ease_out"
        ? baselineSpeed + highDelta * 0.72
        : profile === "ease_in"
          ? baselineSpeed + highDelta * 0.08
          : baselineSpeed + highDelta * 0.18;
    const midGlideSpeed =
      profile === "ease_out"
        ? baselineSpeed + highDelta * 0.9
        : profile === "ease_in"
          ? baselineSpeed + highDelta * 0.44
          : baselineSpeed + highDelta * 0.58;
    const preAccentSpeed =
      profile === "ease_out"
        ? baselineSpeed + highDelta * 0.98
        : profile === "ease_in"
          ? baselineSpeed + highDelta * 0.86
          : baselineSpeed + highDelta * 0.92;
    const accentSpeed =
      profile === "ease_out"
        ? accentLowSpeed
        : accentHighSpeed;
    const settleSpeed =
      profile === "ease_in"
        ? baselineSpeed + highDelta * 0.18
        : profile === "ease_out"
          ? baselineSpeed - lowDelta * 0.46
          : baselineSpeed + highDelta * 0.42;
    const tailMidSpeed =
      profile === "ease_in"
        ? baselineSpeed + highDelta * 0.04
        : profile === "ease_out"
          ? baselineSpeed - lowDelta * 0.16
          : baselineSpeed + highDelta * 0.14;
    const noiseRnd = mulberry32(
      Math.round(anchorTime * 1000) * 7919 + Math.round(scoreNorm * 1000) * 101,
    );
    const holdNoiseA =
      profile === "noise"
        ? Math.max(
            baselineSpeed,
            Math.min(speedMaxBound, accentHighSpeed * (0.94 + noiseRnd() * 0.1)),
          )
        : accentSpeed;
    const holdNoiseB =
      profile === "noise"
        ? Math.max(
            baselineSpeed,
            Math.min(speedMaxBound, accentHighSpeed * (0.9 + noiseRnd() * 0.14)),
          )
        : accentSpeed;
    const holdNoiseNorm = clamp01(
      (anchorTime + releaseSpanSeconds * 0.18) / safeDuration,
    );

    if (leadStartNorm > 0) {
      points.push(
        toInternalSpeedMultiplierPoint(
          Math.max(0, leadStartNorm - 0.0012),
          baselineSpeed,
          speedMinBound,
          speedMaxBound,
        ),
      );
    }
    points.push(
      toInternalSpeedMultiplierPoint(
        leadStartNorm,
        startGlideSpeed,
        speedMinBound,
        speedMaxBound,
      ),
    );
    points.push(
      toInternalSpeedMultiplierPoint(
        leadMidNorm,
        midGlideSpeed,
        speedMinBound,
        speedMaxBound,
      ),
    );
    points.push(
      toInternalSpeedMultiplierPoint(
        leadLateNorm,
        preAccentSpeed,
        speedMinBound,
        speedMaxBound,
      ),
    );
    points.push(
      toInternalSpeedMultiplierPoint(
        anchorNorm,
        accentSpeed,
        speedMinBound,
        speedMaxBound,
      ),
    );
    points.push(
      toInternalSpeedMultiplierPoint(
        holdEndNorm,
        holdNoiseA,
        speedMinBound,
        speedMaxBound,
      ),
    );
    points.push(
      toInternalSpeedMultiplierPoint(
        holdNoiseNorm,
        holdNoiseB,
        speedMinBound,
        speedMaxBound,
      ),
    );
    points.push(
      toInternalSpeedMultiplierPoint(
        settleNorm,
        settleSpeed,
        speedMinBound,
        speedMaxBound,
      ),
    );
    points.push(
      toInternalSpeedMultiplierPoint(
        tailMidNorm,
        tailMidSpeed,
        speedMinBound,
        speedMaxBound,
      ),
    );
    points.push(
      toInternalSpeedMultiplierPoint(
        tailNorm,
        baselineSpeed,
        speedMinBound,
        speedMaxBound,
      ),
    );
  });

  points.push(
    toInternalSpeedMultiplierPoint(1, baselineSpeed, speedMinBound, speedMaxBound),
  );

  return {
    id,
    name,
    points: stretchCurveToFullHeight(normalizeCurvePoints(points)),
    interpolation: "smoothstep",
  };
};

export const buildStutterLanePresets = (
  durationSeconds: number,
  bpm: number,
): TrackPreset[] =>
  stutterSourcePresets.map((preset) => ({
    id: preset.id,
    name: preset.name,
    points: generatePresetPoints(preset, durationSeconds, bpm),
    interpolation: preset.interpolation,
  }));

export const buildSpeedLanePresets = (
  durationSeconds: number,
  bpm: number,
  speedMinBound: number,
  speedMaxBound: number,
  phaseMultiplier = 1,
): TrackPreset[] =>
  speedSourcePresets.map((preset) => ({
    id: preset.id,
    name: preset.name,
    points: stretchCurveToFullHeight(
      generatePresetPoints(
        preset,
        durationSeconds,
        bpm,
        phaseMultiplier,
      ),
      0.5,
    ).map((point) => toInternalSpeedPoint(point, speedMinBound, speedMaxBound)),
    interpolation: preset.interpolation,
  }));

export const buildEssentiaPunchSpeedPresets = ({
  full,
  durationSeconds,
  bpm,
  speedMinBound,
  speedMaxBound,
  phaseMultiplier = 1,
}: {
  full: EssentiaFullResponse | null;
  durationSeconds: number;
  bpm: number;
  speedMinBound: number;
  speedMaxBound: number;
  phaseMultiplier?: number;
}): TrackPreset[] => {
  if (!full) return [];

  const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0
    ? durationSeconds
    : full.duration;
  if (!Number.isFinite(safeDuration) || safeDuration <= 0) return [];

  const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : full.bpm;
  const curve = full.energy?.curve ?? [];
  const densityScale = Math.min(Math.max(0.5, phaseMultiplier), 2.5);
  const beatSeconds = getSecondsPerBeat(safeBpm);
  const beatAnchors = selectStrongestAnchors(
    buildAnchorCandidates(full.beats ?? [], curve, safeDuration, safeBpm),
    {
      limit: Math.max(3, Math.round(4 * densityScale)),
      minSpacingSeconds: Math.max(0.35, beatSeconds * (2.2 / densityScale)),
      minScoreRatio: 0.24 / densityScale,
    },
  );
  const onsetCandidates = buildAnchorCandidates(
    full.onsets ?? [],
    curve,
    safeDuration,
    safeBpm,
  );
  const onsetAnchors = selectStrongestAnchors(
    onsetCandidates,
    {
      limit: Math.max(4, Math.round(5 * densityScale)),
      minSpacingSeconds: Math.max(0.45, beatSeconds * (2.6 / densityScale)),
      minScoreRatio: 0.16 / densityScale,
    },
  );
  const distributedOnsetAnchors = selectDistributedAnchors(
    onsetCandidates,
    safeDuration,
    Math.max(4, Math.round(6 * densityScale)),
    0.04,
  );
  const mergedOnsetAnchors = mergeAnchors(
    onsetAnchors,
    distributedOnsetAnchors,
    Math.max(0.22, beatSeconds * 0.9),
  );
  const presets: TrackPreset[] = [];

  if (beatAnchors.length >= 2) {
    presets.push(
      buildPunchPreset({
        anchors: beatAnchors,
        id: "essentia-beat-ease-in",
        name: "Beat Ease In",
        durationSeconds: safeDuration,
        bpm: safeBpm,
        phaseMultiplier,
        speedMinBound,
        speedMaxBound,
        profile: "ease_in",
      }),
    );
    presets.push(
      buildPunchPreset({
        anchors: beatAnchors,
        id: "essentia-beat-ease-out",
        name: "Beat Ease Out",
        durationSeconds: safeDuration,
        bpm: safeBpm,
        phaseMultiplier,
        speedMinBound,
        speedMaxBound,
        profile: "ease_out",
      }),
    );
  }

  if (mergedOnsetAnchors.length >= 1) {
    presets.push(
      buildPunchPreset({
        anchors: mergedOnsetAnchors,
        id: "essentia-onset-ease-in",
        name: "Onset Ease In",
        durationSeconds: safeDuration,
        bpm: safeBpm,
        phaseMultiplier,
        speedMinBound,
        speedMaxBound,
        profile: "ease_in",
      }),
    );
    presets.push(
      buildPunchPreset({
        anchors: mergedOnsetAnchors,
        id: "essentia-onset-ease-out",
        name: "Onset Ease Out",
        durationSeconds: safeDuration,
        bpm: safeBpm,
        phaseMultiplier,
        speedMinBound,
        speedMaxBound,
        profile: "ease_out",
      }),
    );
    presets.push(
      buildPunchPreset({
        anchors: mergedOnsetAnchors,
        id: "essentia-onset-ease-in-out",
        name: "Onset Ease In/Out",
        durationSeconds: safeDuration,
        bpm: safeBpm,
        phaseMultiplier,
        speedMinBound,
        speedMaxBound,
        profile: "ease_in_out",
      }),
    );
    presets.push(
      buildPunchPreset({
        anchors: buildAnchoredDriftCandidates(
          mergedOnsetAnchors,
          safeDuration,
          safeBpm,
        ),
        id: "essentia-onset-noise",
        name: "Onset Noise",
        durationSeconds: safeDuration,
        bpm: safeBpm,
        phaseMultiplier,
        speedMinBound,
        speedMaxBound,
        profile: "noise",
      }),
    );
  }

  return presets;
};
