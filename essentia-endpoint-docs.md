# Essentia API — Docs & Endpoints

## Overview

This document describes the Essentia analysis API used by this repository. The client code lives in `src/lib/services/essentia.ts` and provides small helpers to call the endpoints documented below.

## Base URL

- Default: `https://essentia.v1su4.dev`
- Can be overridden with the environment variable `VITE_ESSENTIA_API_BASE_URL` (no trailing slash).

## Authentication

All requests require an `X-API-Key` header with your API key.

## Common request format

- Method: `POST`
- Content-Type: `multipart/form-data`
- Form field: `file` — the audio file to analyze (server expects a file upload)

## Endpoints

- `/analyze/rhythm`
  - Description: Analyze tempo, beats, onsets and energy curve.
  - Request: `POST /analyze/rhythm` with form field `file` and header `X-API-Key`.
  - Response shape (TypeScript):

```ts
interface EssentiaRhythmResponse {
  bpm: number;
  beats: number[]; // beat timestamps (s)
  confidence: number; // confidence in bpm detection
  onsets: number[]; // onset timestamps (s)
  duration: number; // audio duration in seconds
  energy: {
    mean: number;
    std: number;
    curve: number[]; // per-frame energy values
  };
}
```

- `/analyze/structure`
  - Description: Detect structural sections (intro, verse, chorus, etc.) and boundaries.
  - Request: `POST /analyze/structure` with form field `file` and header `X-API-Key`.
  - Response shape (TypeScript):

```ts
interface EssentiaStructureSection {
  start: number; // start time (s)
  end: number;   // end time (s)
  label: string; // human-friendly label or algorithmic label
  duration: number;
  energy: number; // aggregated energy for the section
}

interface EssentiaStructureResponse {
  sections: EssentiaStructureSection[];
  boundaries: number[]; // boundary timestamps (s)
}
```

## Error handling

If the server returns a non-2xx status the client throws an Error containing the status and any returned body text. Calls from the repo use `fetch` and check `response.ok`.

## Example curl

Rhythm analysis:

```bash
curl -X POST "${VITE_ESSENTIA_API_BASE_URL:-https://essentia.v1su4.dev}/analyze/rhythm" \
  -H "X-API-Key: YOUR_API_KEY" \
  -F "file=@/path/to/audio.wav"
```

Structure analysis:

```bash
curl -X POST "${VITE_ESSENTIA_API_BASE_URL:-https://essentia.v1su4.dev}/analyze/structure" \
  -H "X-API-Key: YOUR_API_KEY" \
  -F "file=@/path/to/audio.wav"
```

## Usage — repository helpers

The repo exposes two helpers in `src/lib/services/essentia.ts`:

- `analyzeEssentiaRhythm(file: File, apiKey: string): Promise<EssentiaRhythmResponse>`
- `analyzeEssentiaStructure(file: File, apiKey: string): Promise<EssentiaStructureResponse>`

Example usage in browser/renderer code:

```ts
import { analyzeEssentiaRhythm } from './src/lib/services/essentia';

const resp = await analyzeEssentiaRhythm(fileInput.files[0], process.env.VITE_ESSENTIA_API_KEY);
console.log('BPM', resp.bpm, 'beats', resp.beats.length);
```

## Notes

- The client code automatically trims trailing slashes from the configured base URL.
- Ensure the API key has permission for analysis endpoints.
- The server returns JSON; large audio files may take time to process — handle UI loading states accordingly.

---

File reference: `src/lib/services/essentia.ts` for the exact client implementation.

## Complete Endpoint Reference (from /openapi.json)

### Health

- `GET /health`
  - Description: Check API health/status.
  - Response: `200` JSON — empty object or simple health payload.

### Analyze — Rhythm

- `POST /analyze/rhythm`
  - Description: Extract BPM, beat timestamps, onset timestamps, duration and energy curve.
  - Request: multipart/form-data with `file` and `X-API-Key` header.
  - Response schema: `RhythmAnalysis`
    - `bpm: number`
    - `beats: number[]` — beat timestamps in seconds
    - `confidence: number` — BPM detection confidence
    - `onsets: number[]` — onset timestamps in seconds
    - `duration: number` — audio duration in seconds
    - `energy: EnergyData` — see EnergyData below

### Analyze — Structure

- `POST /analyze/structure`
  - Description: Segment audio into sections (intro, verse, chorus, etc.) and boundary timestamps.
  - Request: multipart/form-data with `file` and `X-API-Key` header.
  - Response schema: `StructureAnalysis`
    - `sections: Section[]` — list of sections
      - `start: number` — start time (s)
      - `end: number` — end time (s)
      - `label: string` — algorithmic/human label
      - `duration: number` — seconds
      - `energy: number` — aggregated energy for the section
    - `boundaries: number[]` — boundary timestamps in seconds

### Analyze — Classification

- `POST /analyze/classification`
  - Description: Genre, mood, tags and higher-level classification features (danceability, approachability, engagement, acoustic_electronic, bright_dark, instrument, tonal_atonal).
  - Query parameter: `features` (optional comma-separated list — default: all)
  - Request: multipart/form-data with `file` and `X-API-Key` header.
  - Response schema: `ClassificationAnalysis`
    - `genres: ClassificationResult | null`
    - `moods: ClassificationResult | null`
    - `tags: string[] | null`
    - `danceability`, `approachability`, `engagement`, `acoustic_electronic`, `bright_dark`, `instrument`, `tonal_atonal`: `ClassificationFeature | null` or arrays where noted
  - `ClassificationResult` fields:
    - `label: string`
    - `confidence: number`
    - `all_scores: { [label: string]: number }` — scores for many classes
  - `ClassificationFeature` fields:
    - `label: string`
    - `confidence: number`

### Analyze — Tonal (Enhanced Tonal Analysis)

- `POST /analyze/tonal`
  - Description: Full tonal extraction (key, scale, key strength, TempoCNN tempo, and pitch data via CREPE).
  - Request: multipart/form-data with `file` and `X-API-Key` header.
  - Response schema: `EnhancedTonalAnalysis`
    - `key: string` — e.g. "C", "G#"
    - `scale: string` — e.g. "major", "minor"
    - `strength: number` — key strength
    - `tempo_cnn: number | null` — deep-learning tempo estimate
    - `pitch: PitchData | null` — see PitchData below

- `POST /analyze/tonal/key`
  - Description: Extract key, scale, and key strength only.
  - Response schema: `TonalAnalysis` (`key`, `scale`, `strength`)

- `POST /analyze/tonal/tempo`
  - Description: Extract deep-learning tempo only (TempoCNN).
  - Response schema: `TempoAnalysis`
    - `tempo_cnn: number | null`

- `POST /analyze/tonal/pitch`
  - Description: Extract pitch contour only using CREPE.
  - Response schema: `PitchAnalysis`
    - `pitch: PitchData | null`

### Analyze — Vocals

- `POST /analyze/vocals`
  - Description: Detect whether audio contains vocals or is instrumental and a vocal label.
  - Request: multipart/form-data with `file` and `X-API-Key` header.
  - Response schema: `VocalAnalysis`
    - `vocal_presence: number` — confidence/score for vocals presence
    - `label: string` — e.g. "vocals" | "instrumental"

### Analyze — Full

- `POST /analyze/full`
  - Description: Single-call full analysis that returns rhythm, structure, classification, tonal, and vocal analysis combined.
  - Request: multipart/form-data with `file` and `X-API-Key` header.
  - Response schema: `FullAnalysis`
    - `bpm`, `beats`, `confidence`, `onsets`, `duration`, `energy` (same as RhythmAnalysis)
    - `structure: StructureAnalysis`
    - `classification: ClassificationAnalysis | null`
    - `tonal: EnhancedTonalAnalysis | null`
    - `vocals: VocalAnalysis | null`

### Shared Schemas

- `EnergyData`
  - `mean: number`
  - `std: number`
  - `curve: number[]` — per-frame energy values (useful for envelopes / visualization)

- `PitchData`
  - `mean_frequency: number` — mean pitch frequency in Hz
  - `confidence: number` — confidence for pitch detection

---

## Useful links

- OpenAPI JSON: https://essentia.v1su4.dev/openapi.json
- API base: https://essentia.v1su4.dev

---

If you'd like, I can:
- add example JSON responses for each endpoint, or
- update `a.md` to match this expanded reference and include sample payloads.
