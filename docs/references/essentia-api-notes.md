# Essentia API Notes

Source docs:
- https://essentia.v1su4.dev/docs
- https://essentia.v1su4.dev/openapi.json

## Auth
- Analysis endpoints require `X-API-Key` header.
- Request body uses `multipart/form-data` with required `file`.

## Recommended endpoints for FFTRON

### `POST /analyze/rhythm`
- Returns BPM, beats, confidence, onsets, duration, energy.
- Best primary endpoint for onset/BPM-driven transport behavior.

### `POST /analyze/structure`
- Returns sections and boundaries.
- Best companion endpoint for section/timeline structure.

### `POST /analyze/full`
- Returns rhythm + structure + classification + tonal + vocals.
- Heavy path; user reports roughly 40s–2m latency.
- Best treated as a slow enrichment/fallback path rather than the primary interactive path.

## Execution guidance
- Prefer `rhythm + structure` for browser/UI testing and normal operation.
- Use `full` only for explicit slow-path enrichment.
