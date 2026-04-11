import type { ReactiveBandTarget } from '$lib/types/engine';

export interface FrequencyRange {
  startHz: number;
  endHz: number;
}

export interface FrequencyPreset extends FrequencyRange {
  id: ReactiveBandTarget;
  label: string;
}

export const EFFECT_RANGE_MIN_HZ = 20;
export const EFFECT_RANGE_MAX_HZ = 14_000;

export const FREQUENCY_PRESETS: readonly FrequencyPreset[] = [
  { id: 'low', label: 'Low', startHz: 20, endHz: 180 },
  { id: 'mid', label: 'Mid', startHz: 180, endHz: 2_000 },
  { id: 'high', label: 'High', startHz: 2_000, endHz: 10_000 },
  { id: 'full', label: 'Full', startHz: EFFECT_RANGE_MIN_HZ, endHz: EFFECT_RANGE_MAX_HZ }
] as const;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const logMin = Math.log10(EFFECT_RANGE_MIN_HZ);
const logMax = Math.log10(EFFECT_RANGE_MAX_HZ);
const logSpan = logMax - logMin;

export const clampFrequencyRange = (startHz: number, endHz: number): FrequencyRange => {
  const min = clamp(Math.min(startHz, endHz), EFFECT_RANGE_MIN_HZ, EFFECT_RANGE_MAX_HZ);
  const max = clamp(Math.max(startHz, endHz), EFFECT_RANGE_MIN_HZ, EFFECT_RANGE_MAX_HZ);
  return {
    startHz: min,
    endHz: Math.max(min, max)
  };
};

export const frequencyToPercent = (hz: number): number => {
  const safeHz = clamp(hz, EFFECT_RANGE_MIN_HZ, EFFECT_RANGE_MAX_HZ);
  return clamp(((Math.log10(safeHz) - logMin) / logSpan) * 100, 0, 100);
};

export const percentToFrequency = (percent: number): number => {
  const safePercent = clamp(percent, 0, 100);
  const value = 10 ** (logMin + (safePercent / 100) * logSpan);
  return clamp(value, EFFECT_RANGE_MIN_HZ, EFFECT_RANGE_MAX_HZ);
};

export const findPresetById = (id: ReactiveBandTarget): FrequencyPreset =>
  FREQUENCY_PRESETS.find((preset) => preset.id === id) ?? FREQUENCY_PRESETS[FREQUENCY_PRESETS.length - 1];

export const derivePresetTarget = (range: FrequencyRange): ReactiveBandTarget => {
  const normalized = clampFrequencyRange(range.startHz, range.endHz);
  let selected: ReactiveBandTarget = 'full';
  let bestPresetCoverage = 0;
  let bestRangeCoverage = 0;
  let strongOverlapCount = 0;
  const selectedSpan = Math.max(1, normalized.endHz - normalized.startHz);

  for (const preset of FREQUENCY_PRESETS) {
    if (preset.id === 'full') continue;
    const overlapStart = Math.max(normalized.startHz, preset.startHz);
    const overlapEnd = Math.min(normalized.endHz, preset.endHz);
    const overlap = Math.max(0, overlapEnd - overlapStart);
    const presetSpan = Math.max(1, preset.endHz - preset.startHz);
    const presetCoverage = overlap / presetSpan;
    const rangeCoverage = overlap / selectedSpan;

    if (rangeCoverage >= 0.2) strongOverlapCount += 1;

    if (presetCoverage > bestPresetCoverage) {
      bestPresetCoverage = presetCoverage;
      bestRangeCoverage = rangeCoverage;
      selected = preset.id;
    }
  }

  return bestPresetCoverage >= 0.5 && bestRangeCoverage >= 0.6 && strongOverlapCount === 1
    ? selected
    : 'full';
};

export const formatFrequency = (hz: number): string =>
  hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10_000 ? 0 : 1)} kHz` : `${Math.round(hz)} Hz`;
