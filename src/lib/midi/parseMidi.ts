import type { MidiNoteEvent, MidiTrackSummary, ParsedMidiFile } from './types';

interface TempoChange {
  tick: number;
  microsecondsPerQuarterNote: number;
}

interface TrackState {
  name: string;
  openNotes: Map<string, { tick: number; velocity: number; note: number; channel: number }>;
  events: MidiNoteEvent[];
  channels: Set<number>;
}

interface OpenMidiNote {
  tick: number;
  velocity: number;
  note: number;
  channel: number;
}

const readUint32 = (view: DataView, offset: number): number => view.getUint32(offset, false);
const readUint16 = (view: DataView, offset: number): number => view.getUint16(offset, false);

const readVarLen = (view: DataView, start: number): { value: number; nextOffset: number } => {
  let value = 0;
  let offset = start;
  while (offset < view.byteLength) {
    const byte = view.getUint8(offset);
    value = (value << 7) | (byte & 0x7f);
    offset += 1;
    if ((byte & 0x80) === 0) break;
  }
  return { value, nextOffset: offset };
};

const decodeText = (view: DataView, offset: number, length: number): string => {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
  return new TextDecoder().decode(bytes).trim();
};

const defaultTempo = 500_000;

const createMidiNoteEvent = (
  trackIndex: number,
  trackName: string,
  key: string,
  note: OpenMidiNote,
  endTick: number,
  tempoChanges: readonly TempoChange[],
  ticksPerQuarterNote: number
): MidiNoteEvent => {
  const startSeconds = ticksToSeconds(note.tick, tempoChanges, ticksPerQuarterNote);
  const endSeconds = ticksToSeconds(endTick, tempoChanges, ticksPerQuarterNote);

  return {
    id: `${trackIndex}-${key}-${note.tick}`,
    note: note.note,
    velocity: note.velocity / 127,
    startTicks: note.tick,
    durationTicks: Math.max(0, endTick - note.tick),
    startSeconds,
    durationSeconds: Math.max(0, endSeconds - startSeconds),
    endSeconds,
    channel: note.channel,
    trackIndex,
    trackName
  };
};

const ticksToSeconds = (
  tick: number,
  tempoChanges: readonly TempoChange[],
  ticksPerQuarterNote: number
): number => {
  const sorted = [...tempoChanges].sort((left, right) => left.tick - right.tick);
  let seconds = 0;
  let previousTick = 0;
  let currentTempo = sorted[0]?.microsecondsPerQuarterNote ?? defaultTempo;

  for (let index = 1; index < sorted.length; index += 1) {
    const tempo = sorted[index];
    if (tempo.tick >= tick) break;
    const deltaTicks = tempo.tick - previousTick;
    seconds += (deltaTicks / ticksPerQuarterNote) * (currentTempo / 1_000_000);
    previousTick = tempo.tick;
    currentTempo = tempo.microsecondsPerQuarterNote;
  }

  seconds += ((tick - previousTick) / ticksPerQuarterNote) * (currentTempo / 1_000_000);
  return seconds;
};

const closeDanglingNotes = (
  trackState: TrackState,
  endTick: number,
  tempoChanges: readonly TempoChange[],
  ticksPerQuarterNote: number,
  trackIndex: number
) => {
  for (const [key, note] of trackState.openNotes.entries()) {
    trackState.events.push(
      createMidiNoteEvent(
        trackIndex,
        trackState.name || `Track ${trackIndex + 1}`,
        key,
        note,
        endTick,
        tempoChanges,
        ticksPerQuarterNote
      )
    );
  }
  trackState.openNotes.clear();
};

export const parseMidiFile = (buffer: ArrayBuffer, name = 'midi-file.mid'): ParsedMidiFile => {
  const view = new DataView(buffer);
  if (decodeText(view, 0, 4) !== 'MThd') {
    throw new Error('Invalid MIDI header');
  }

  const headerLength = readUint32(view, 4);
  const format = readUint16(view, 8);
  const trackCount = readUint16(view, 10);
  const division = readUint16(view, 12);
  if ((division & 0x8000) !== 0) {
    throw new Error('SMPTE time division is not supported');
  }

  const ticksPerQuarterNote = division;
  let offset = 8 + headerLength;
  const tempoChanges: TempoChange[] = [{ tick: 0, microsecondsPerQuarterNote: defaultTempo }];
  const trackStates: TrackState[] = [];
  let maxTick = 0;

  for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
    if (decodeText(view, offset, 4) !== 'MTrk') {
      throw new Error(`Invalid MIDI track header at ${offset}`);
    }
    const trackLength = readUint32(view, offset + 4);
    offset += 8;
    const trackEnd = offset + trackLength;
    let absoluteTick = 0;
    let runningStatus = 0;
    const trackState: TrackState = {
      name: `Track ${trackIndex + 1}`,
      openNotes: new Map(),
      events: [],
      channels: new Set()
    };

    while (offset < trackEnd) {
      const delta = readVarLen(view, offset);
      absoluteTick += delta.value;
      offset = delta.nextOffset;
      maxTick = Math.max(maxTick, absoluteTick);

      let status = view.getUint8(offset);
      if (status < 0x80) {
        status = runningStatus;
      } else {
        offset += 1;
        runningStatus = status;
      }

      if (status === 0xff) {
        const metaType = view.getUint8(offset);
        const metaLength = readVarLen(view, offset + 1);
        const metaOffset = metaLength.nextOffset;
        if (metaType === 0x03) {
          trackState.name = decodeText(view, metaOffset, metaLength.value) || trackState.name;
        }
        if (metaType === 0x51 && metaLength.value === 3) {
          const microsecondsPerQuarterNote =
            (view.getUint8(metaOffset) << 16) |
            (view.getUint8(metaOffset + 1) << 8) |
            view.getUint8(metaOffset + 2);
          tempoChanges.push({ tick: absoluteTick, microsecondsPerQuarterNote });
        }
        offset = metaOffset + metaLength.value;
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        const sysexLength = readVarLen(view, offset);
        offset = sysexLength.nextOffset + sysexLength.value;
        continue;
      }

      const command = status & 0xf0;
      const channel = status & 0x0f;
      const data1 = view.getUint8(offset);
      const data2 = command === 0xc0 || command === 0xd0 ? 0 : view.getUint8(offset + 1);
      offset += command === 0xc0 || command === 0xd0 ? 1 : 2;
      trackState.channels.add(channel);

      if (command === 0x90 && data2 > 0) {
        trackState.openNotes.set(`${channel}:${data1}`, {
          tick: absoluteTick,
          velocity: data2,
          note: data1,
          channel
        });
        continue;
      }

      if (command === 0x80 || (command === 0x90 && data2 === 0)) {
        const key = `${channel}:${data1}`;
        const note = trackState.openNotes.get(key);
        if (!note) continue;
        trackState.openNotes.delete(key);
        trackState.events.push(
          createMidiNoteEvent(
            trackIndex,
            trackState.name || `Track ${trackIndex + 1}`,
            key,
            note,
            absoluteTick,
            tempoChanges,
            ticksPerQuarterNote
          )
        );
      }
    }

    closeDanglingNotes(trackState, absoluteTick, tempoChanges, ticksPerQuarterNote, trackIndex);
    trackStates.push(trackState);
    offset = trackEnd;
  }

  const tracks: MidiTrackSummary[] = trackStates.flatMap((trackState, trackIndex) => {
    const channelCounts = new Map<number, number>();
    for (const event of trackState.events) {
      channelCounts.set(event.channel, (channelCounts.get(event.channel) ?? 0) + 1);
    }

    if (channelCounts.size <= 1) {
      const channel = channelCounts.size === 1 ? [...channelCounts.keys()][0] : null;
      return [
        {
          key: channel === null ? `track:${trackIndex}` : `track:${trackIndex}:ch:${channel}`,
          name: trackState.name || `Track ${trackIndex + 1}`,
          channel,
          noteCount: trackState.events.length
        }
      ];
    }

    return [...channelCounts.entries()].map(([channel, noteCount]) => ({
      key: `track:${trackIndex}:ch:${channel}`,
      name: `${trackState.name || `Track ${trackIndex + 1}`} · CH ${channel + 1}`,
      channel,
      noteCount
    }));
  });

  const events = trackStates
    .flatMap((trackState) => trackState.events)
    .sort((left, right) => left.startSeconds - right.startSeconds || left.note - right.note);

  return {
    name,
    format,
    ticksPerQuarterNote,
    durationSeconds: ticksToSeconds(maxTick, tempoChanges, ticksPerQuarterNote),
    events,
    tracks
  };
};
