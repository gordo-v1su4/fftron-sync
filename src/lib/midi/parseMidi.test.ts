import { describe, expect, it } from 'vitest';
import { parseMidiFile } from './parseMidi';

const encodeVarLen = (value: number): number[] => {
  let buffer = value & 0x7f;
  const bytes = [] as number[];
  while ((value >>= 7)) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }
  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
  return bytes;
};

const chunk = (id: string, data: number[]): number[] => [
  ...id.split('').map((char) => char.charCodeAt(0)),
  (data.length >>> 24) & 0xff,
  (data.length >>> 16) & 0xff,
  (data.length >>> 8) & 0xff,
  data.length & 0xff,
  ...data
];


const buildSysexRunningStatusMidi = (): ArrayBuffer => {
  const header = [
    ...'MThd'.split('').map((char) => char.charCodeAt(0)),
    0x00, 0x00, 0x00, 0x06,
    0x00, 0x00,
    0x00, 0x01,
    0x00, 0x60
  ];

  const trackData = [
    0x00, 0x90, 0x3c, 0x64,
    0x00, 0xf0, 0x01, 0x7f,
    0x00, 0x3e, 0x64,
    ...encodeVarLen(0x60), 0x80, 0x3c, 0x00,
    0x00, 0xff, 0x2f, 0x00
  ];

  return new Uint8Array([...header, ...chunk('MTrk', trackData)]).buffer;
};

const buildMalformedVarLenMidi = (): ArrayBuffer => {
  const header = [
    ...'MThd'.split('').map((char) => char.charCodeAt(0)),
    0x00, 0x00, 0x00, 0x06,
    0x00, 0x00,
    0x00, 0x01,
    0x00, 0x60
  ];

  const trackData = [
    0x80, 0x80, 0x80, 0x80, 0x80,
    0xff, 0x2f, 0x00
  ];

  return new Uint8Array([...header, ...chunk('MTrk', trackData)]).buffer;
};

const buildSimpleMidi = (): ArrayBuffer => {
  const header = [
    ...'MThd'.split('').map((char) => char.charCodeAt(0)),
    0x00, 0x00, 0x00, 0x06,
    0x00, 0x00,
    0x00, 0x01,
    0x00, 0x60
  ];

  const trackData = [
    0x00, 0xff, 0x03, 0x04, 0x4b, 0x69, 0x63, 0x6b,
    0x00, 0x90, 0x3c, 0x64,
    ...encodeVarLen(0x60), 0x80, 0x3c, 0x00,
    0x00, 0xff, 0x2f, 0x00
  ];

  return new Uint8Array([...header, ...chunk('MTrk', trackData)]).buffer;
};

describe('parseMidiFile', () => {
  it('parses note timing, velocity, and track metadata from a simple SMF', () => {
    const parsed = parseMidiFile(buildSimpleMidi(), 'kick.mid');

    expect(parsed.name).toBe('kick.mid');
    expect(parsed.events).toHaveLength(1);
    expect(parsed.tracks[0]?.name).toBe('Kick');
    expect(parsed.events[0]).toMatchObject({
      note: 60,
      velocity: expect.closeTo(100 / 127, 5),
      startSeconds: 0,
      durationSeconds: expect.closeTo(0.5, 5),
      trackName: 'Kick'
    });
  });

  it('does not reuse running status after a sysex event', () => {
    const parsed = parseMidiFile(buildSysexRunningStatusMidi(), 'sysex.mid');

    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]?.note).toBe(60);
  });

  it('bounds malformed variable-length quantities to four bytes', () => {
    expect(() => parseMidiFile(buildMalformedVarLenMidi(), 'malformed.mid')).toThrow();
  });

  it('rejects invalid headers', () => {
    expect(() => parseMidiFile(new Uint8Array([0, 1, 2, 3]).buffer)).toThrow('Invalid MIDI header');
  });
});
