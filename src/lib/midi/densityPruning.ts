import type { MidiNoteEvent } from './types';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const scoreEvent = (event: MidiNoteEvent): number =>
  event.velocity * 1000 + event.durationSeconds * 100 + Math.max(0, 10 - event.note / 12);

export const pruneMidiEventsByDensity = (
  events: readonly MidiNoteEvent[],
  density: number
): MidiNoteEvent[] => {
  if (events.length <= 1) return [...events];

  const normalizedDensity = clamp01(density);
  if (normalizedDensity >= 0.999) return [...events];

  const keepCount = Math.max(1, Math.round(events.length * normalizedDensity));
  const ranked = [...events]
    .map((event, index) => ({ event, index, score: scoreEvent(event) }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    })
    .slice(0, keepCount)
    .sort((left, right) => {
      if (left.event.startSeconds !== right.event.startSeconds) {
        return left.event.startSeconds - right.event.startSeconds;
      }
      return left.event.note - right.event.note;
    });

  return ranked.map(({ event }) => event);
};
