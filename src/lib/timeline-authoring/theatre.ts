import { getProject } from '@theatre/core';
import type { ISheet } from '@theatre/core';
import type { TheatreExportBundle } from '$lib/types/timeline';

export interface TheatreAuthoringContext {
  projectId: string;
  sheet: ISheet;
}

let theatreContext: TheatreAuthoringContext | null = null;

export const ensureTheatreAuthoringContext = (): TheatreAuthoringContext => {
  if (theatreContext) return theatreContext;

  const projectId = 'resolume-gen-authoring';
  const project = getProject(projectId);
  const sheet = project.sheet('timeline-authoring');

  theatreContext = { projectId, sheet };
  return theatreContext;
};

export const buildStarterBundle = (): TheatreExportBundle => ({
  version: '1.0.0',
  fps: 60,
  sequences: [
    {
      id: 'seq-main',
      name: 'Main Sequence',
      section: 'verse-a'
    }
  ],
  cueMarkers: [
    {
      id: 'mk-1',
      section: 'verse-a',
      bar: 1,
      beat: 1,
      quantize: '1n',
      action: 'trigger_clip',
      payload: { clipId: 'clip-001' }
    },
    {
      id: 'mk-2',
      section: 'verse-a',
      bar: 2,
      beat: 1,
      quantize: '1n',
      action: 'apply_accent',
      payload: { accentId: 'pulse-main' }
    }
  ],
  envelopeTemplates: [
    {
      id: 'pulse-main',
      name: 'Pulse Main',
      attackMs: 40,
      decayMs: 140,
      sustain: 0.65,
      releaseMs: 120,
      curveIn: 'sine_in',
      curveOut: 'sine_out'
    }
  ]
});
