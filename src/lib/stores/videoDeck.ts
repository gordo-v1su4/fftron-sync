import { writable } from 'svelte/store';

export type VideoDeckQuantizeMode = 'beat' | 'bar';

export interface VideoDeckClipRecord {
  id: string;
  name: string;
  url: string;
  sizeMb: string;
  lane: number;
  slot: number;
}

export interface VideoDeckAuthorityState {
  clips: VideoDeckClipRecord[];
  laneMuted: boolean[];
  soloLane: number | null;
  selectedClipId: string;
  prewarmClipId: string;
  prewarmReady: boolean;
  autoSwitchEnabled: boolean;
  quantizeMode: VideoDeckQuantizeMode;
  envelopeGateEnabled: boolean;
  onsetSwitchTarget: number;
  switchSkipChancePercent: number;
  onsetCountForClip: number;
  videoPlaybackActive: boolean;
  status: string;
}

export const initialVideoDeckAuthorityState: VideoDeckAuthorityState = {
  clips: [],
  laneMuted: [false, false, false],
  soloLane: null,
  selectedClipId: '',
  prewarmClipId: '',
  prewarmReady: false,
  autoSwitchEnabled: true,
  quantizeMode: 'beat',
  envelopeGateEnabled: true,
  onsetSwitchTarget: 4,
  switchSkipChancePercent: 0,
  onsetCountForClip: 0,
  videoPlaybackActive: false,
  status: '',
};

export const videoDeckAuthority = writable<VideoDeckAuthorityState>(
  initialVideoDeckAuthorityState,
);
