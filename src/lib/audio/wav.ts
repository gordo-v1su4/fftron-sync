export interface WaveformOverview {
  sourceName: string;
  sampleRate: number;
  channelCount: number;
  bitsPerSample: number;
  durationSeconds: number;
  peaks: number[];
  minValues: number[];
  maxValues: number[];
}

interface ParsedWavData {
  audioFormat: number;
  sampleRate: number;
  channelCount: number;
  bitsPerSample: number;
  blockAlign: number;
  frameCount: number;
  dataOffset: number;
}

const readChunkId = (view: DataView, offset: number): string =>
  String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );

const normalizePcmValue = (
  view: DataView,
  offset: number,
  bitsPerSample: number,
  audioFormat: number,
): number => {
  if (audioFormat === 3 && bitsPerSample === 32) {
    return view.getFloat32(offset, true);
  }

  switch (bitsPerSample) {
    case 8:
      return (view.getUint8(offset) - 128) / 128;
    case 16:
      return view.getInt16(offset, true) / 32768;
    case 24: {
      const b0 = view.getUint8(offset);
      const b1 = view.getUint8(offset + 1);
      const b2 = view.getUint8(offset + 2);
      const raw = b0 | (b1 << 8) | (b2 << 16);
      const signed = raw & 0x800000 ? raw | ~0xffffff : raw;
      return signed / 8388608;
    }
    case 32:
      return view.getInt32(offset, true) / 2147483648;
    default:
      throw new Error(`Unsupported PCM bit depth: ${bitsPerSample}`);
  }
};

const parseWav = (buffer: ArrayBuffer): ParsedWavData => {
  const view = new DataView(buffer);
  if (view.byteLength < 44) throw new Error('WAV data is too short');
  if (readChunkId(view, 0) !== 'RIFF') throw new Error('Invalid RIFF header');
  if (readChunkId(view, 8) !== 'WAVE') throw new Error('Invalid WAVE header');

  let offset = 12;
  let fmtOffset = -1;
  let fmtSize = 0;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= view.byteLength) {
    const chunkId = readChunkId(view, offset);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;

    if (chunkDataOffset + chunkSize > view.byteLength) {
      throw new Error(`Chunk '${chunkId}' exceeds file bounds`);
    }

    if (chunkId === 'fmt ') {
      fmtOffset = chunkDataOffset;
      fmtSize = chunkSize;
    } else if (chunkId === 'data') {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
      break;
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (fmtOffset < 0) throw new Error('Missing fmt chunk');
  if (fmtSize < 16) throw new Error('fmt chunk is too small');
  if (dataOffset < 0) throw new Error('Missing data chunk');
  if (dataSize <= 0) throw new Error('data chunk is empty');

  const audioFormat = view.getUint16(fmtOffset, true);
  const channelCount = view.getUint16(fmtOffset + 2, true);
  const sampleRate = view.getUint32(fmtOffset + 4, true);
  const blockAlign = view.getUint16(fmtOffset + 12, true);
  const bitsPerSample = view.getUint16(fmtOffset + 14, true);

  if (![1, 3].includes(audioFormat)) {
    throw new Error(`Unsupported WAV format: ${audioFormat}`);
  }
  if (channelCount < 1) throw new Error('Invalid channel count');
  if (sampleRate < 1) throw new Error('Invalid sample rate');
  if (blockAlign < 1) throw new Error('Invalid block align');

  const frameCount = Math.floor(dataSize / blockAlign);
  if (frameCount < 1) throw new Error('No sample frames in data chunk');

  return {
    audioFormat,
    sampleRate,
    channelCount,
    bitsPerSample,
    blockAlign,
    frameCount,
    dataOffset,
  };
};

export const isLikelyWavFile = (name: string, mimeType = ''): boolean => {
  const lowerName = name.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  return (
    lowerName.endsWith('.wav') ||
    lowerName.endsWith('.wave') ||
    lowerMime.includes('audio/wav') ||
    lowerMime.includes('audio/x-wav') ||
    lowerMime.includes('audio/wave')
  );
};

export const extractWaveformOverview = (
  buffer: ArrayBuffer,
  options?: {
    sourceName?: string;
    resolution?: number;
  },
): WaveformOverview => {
  const { sourceName = 'WAV Track', resolution = 2400 } = options ?? {};
  const wav = parseWav(buffer);
  const view = new DataView(buffer);
  const bucketCount = Math.max(4, Math.min(wav.frameCount, Math.floor(resolution)));
  const framesPerBucket = wav.frameCount / bucketCount;
  const peaks = new Array<number>(bucketCount).fill(0);
  const minValues = new Array<number>(bucketCount).fill(0);
  const maxValues = new Array<number>(bucketCount).fill(0);
  const bytesPerSample = wav.bitsPerSample / 8;

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const frameStart = Math.floor(bucket * framesPerBucket);
    const frameEnd = Math.max(
      frameStart + 1,
      Math.floor((bucket + 1) * framesPerBucket),
    );
    let bucketPeak = 0;
    let bucketMin = 1;
    let bucketMax = -1;

    for (let frame = frameStart; frame < frameEnd && frame < wav.frameCount; frame += 1) {
      const base = wav.dataOffset + frame * wav.blockAlign;
      for (let channel = 0; channel < wav.channelCount; channel += 1) {
        const sampleOffset = base + channel * bytesPerSample;
        const sampleValue = normalizePcmValue(
          view,
          sampleOffset,
          wav.bitsPerSample,
          wav.audioFormat,
        );
        const magnitude = Math.abs(sampleValue);
        if (magnitude > bucketPeak) bucketPeak = magnitude;
        if (sampleValue < bucketMin) bucketMin = sampleValue;
        if (sampleValue > bucketMax) bucketMax = sampleValue;
      }
    }

    peaks[bucket] = Math.min(1, bucketPeak);
    minValues[bucket] = Math.max(-1, bucketMax < bucketMin ? 0 : bucketMin);
    maxValues[bucket] = Math.min(1, bucketMax < bucketMin ? 0 : bucketMax);
  }

  return {
    sourceName,
    sampleRate: wav.sampleRate,
    channelCount: wav.channelCount,
    bitsPerSample: wav.bitsPerSample,
    durationSeconds: wav.frameCount / wav.sampleRate,
    peaks,
    minValues,
    maxValues,
  };
};

const sampleSeriesAt = (series: readonly number[], norm: number): number => {
  if (!series.length) return 0;
  if (series.length === 1) return series[0] ?? 0;
  const clampedNorm = Math.max(0, Math.min(1, norm));
  const scaled = clampedNorm * (series.length - 1);
  const index = Math.floor(scaled);
  const frac = scaled - index;
  const from = series[index] ?? 0;
  const to = series[Math.min(index + 1, series.length - 1)] ?? from;
  return from + (to - from) * frac;
};

export const buildWaveformViewportPath = (
  minValues: readonly number[],
  maxValues: readonly number[],
  width = 1000,
  height = 100,
  viewportStart = 0,
  viewportEnd = 1,
  samples = 1400,
): string => {
  const midline = height / 2;
  const halfHeight = Math.max(2, height / 2 - 2);

  if (!minValues.length || !maxValues.length) {
    return `M 0,${midline} L ${width},${midline} L ${width},${midline + 0.5} L 0,${midline + 0.5} Z`;
  }

  const start = Math.max(0, Math.min(1, viewportStart));
  const end = Math.max(start + 0.0001, Math.min(1, viewportEnd));
  const sampleCount = Math.max(64, Math.floor(samples));
  const upper: number[] = [];
  const lower: number[] = [];

  for (let index = 0; index <= sampleCount; index += 1) {
    const localNorm = index / sampleCount;
    const globalNorm = start + (end - start) * localNorm;
    const maxValue = Math.max(-1, Math.min(1, sampleSeriesAt(maxValues, globalNorm)));
    const minValue = Math.max(-1, Math.min(1, sampleSeriesAt(minValues, globalNorm)));
    const yA = midline - maxValue * halfHeight;
    const yB = midline - minValue * halfHeight;
    upper.push(Math.min(yA, yB));
    lower.push(Math.max(yA, yB));
  }

  let path = `M 0,${upper[0]} `;
  for (let index = 0; index <= sampleCount; index += 1) {
    const x = (index / sampleCount) * width;
    path += `L ${x},${upper[index]} `;
  }
  for (let index = sampleCount; index >= 0; index -= 1) {
    const x = (index / sampleCount) * width;
    path += `L ${x},${lower[index]} `;
  }
  path += "Z";
  return path;
};

export const buildWaveformPath = (
  peaks: readonly number[],
  width = 1000,
  height = 100,
): string => {
  const midline = height / 2;
  const halfHeight = Math.max(2, height / 2 - 2);
  if (peaks.length === 0) {
    return `M 0,${midline} L ${width},${midline} L ${width},${midline + 0.5} L 0,${midline + 0.5} Z`;
  }

  let path = `M 0,${midline} `;

  for (let index = 0; index < peaks.length; index += 1) {
    const x = (index / Math.max(1, peaks.length - 1)) * width;
    const clamped = Math.max(0, Math.min(1, peaks[index] || 0));
    const y = midline - clamped * halfHeight;
    path += `L ${x},${y} `;
  }

  for (let index = peaks.length - 1; index >= 0; index -= 1) {
    const x = (index / Math.max(1, peaks.length - 1)) * width;
    const clamped = Math.max(0, Math.min(1, peaks[index] || 0));
    const y = midline + clamped * halfHeight;
    path += `L ${x},${y} `;
  }

  path += 'Z';
  return path;
};
