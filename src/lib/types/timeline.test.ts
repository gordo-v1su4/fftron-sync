import { describe, expect, it } from 'vitest';
import { isTheatreExportBundle } from './timeline';

describe('isTheatreExportBundle', () => {
  it('accepts valid payload', () => {
    expect(
      isTheatreExportBundle({
        version: '1.0.0',
        fps: 60,
        sequences: [],
        cueMarkers: [],
        envelopeTemplates: []
      })
    ).toBe(true);
  });

  it('rejects invalid payload', () => {
    expect(isTheatreExportBundle({ version: '1.0.0' })).toBe(false);
  });
});
