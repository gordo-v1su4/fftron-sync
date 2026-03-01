import { describe, expect, it } from 'vitest';
import {
  buildWaveformPath,
  extractWaveformOverview,
  isLikelyWavFile,
} from './wav';

const writeString = (view: DataView, offset: number, value: string): void => {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
};

const buildPcm16Wav = (samples: number[], sampleRate = 8000): ArrayBuffer => {
  const channelCount = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channelCount * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    const int16 = Math.round(clamped * 32767);
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return buffer;
};

describe('wav utilities', () => {
  it('extracts deterministic peaks from PCM16 WAV data', () => {
    const buffer = buildPcm16Wav([0, 0.25, 0.5, 0.75, 1, 0.5, 0.25, 0], 8);
    const overview = extractWaveformOverview(buffer, {
      sourceName: 'test.wav',
      resolution: 4,
    });

    expect(overview.sourceName).toBe('test.wav');
    expect(overview.sampleRate).toBe(8);
    expect(overview.channelCount).toBe(1);
    expect(overview.bitsPerSample).toBe(16);
    expect(overview.durationSeconds).toBe(1);
    expect(overview.peaks).toHaveLength(4);
    expect(overview.peaks[0]).toBeCloseTo(0.25, 3);
    expect(overview.peaks[1]).toBeCloseTo(0.75, 3);
    expect(overview.peaks[2]).toBeCloseTo(1, 3);
    expect(overview.peaks[3]).toBeCloseTo(0.25, 3);
  });

  it('builds a closed SVG path for waveform rendering', () => {
    const path = buildWaveformPath([0.2, 0.6, 0.8], 100, 40);
    expect(path.startsWith('M 0,20')).toBe(true);
    expect(path.endsWith('Z')).toBe(true);
  });

  it('detects wav names and mime types', () => {
    expect(isLikelyWavFile('kick.wav')).toBe(true);
    expect(isLikelyWavFile('kick.mp3', 'audio/x-wav')).toBe(true);
    expect(isLikelyWavFile('kick.mp3', 'audio/mpeg')).toBe(false);
  });

  it('throws for invalid buffers', () => {
    const invalid = new ArrayBuffer(12);
    expect(() => extractWaveformOverview(invalid)).toThrow(/too short|Invalid/);
  });
});
