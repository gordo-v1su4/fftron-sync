export type VideoDeckPrewarmStatus = 'idle' | 'warming' | 'ready' | 'failed';
export type VideoDeckSwitchNoticeState = 'idle' | 'hotReady' | 'warmingHold' | 'coldFallback';

export interface VideoDeckSwitchNoticeInput {
  autoSwitchEnabled: boolean;
  playableClipCount: number;
  currentClipName?: string;
  nextClipName?: string;
  prewarmStatus: VideoDeckPrewarmStatus;
}

export interface VideoDeckSwitchNotice {
  state: VideoDeckSwitchNoticeState;
  headline: string;
  detail: string;
}

export function describeVideoDeckSwitchNotice(input: VideoDeckSwitchNoticeInput): VideoDeckSwitchNotice {
  const currentClipName = input.currentClipName ?? 'current clip';
  const nextClipName = input.nextClipName ?? 'next clip';

  if (!input.autoSwitchEnabled || input.playableClipCount < 2 || !input.nextClipName) {
    return {
      state: 'idle',
      headline: 'Steady deck',
      detail: 'Auto-switch needs at least two active clips.'
    };
  }

  if (input.prewarmStatus === 'failed') {
    return {
      state: 'coldFallback',
      headline: 'Cold fallback',
      detail: `${nextClipName} is not ready, so ${currentClipName} stays live until a presentable frame exists.`
    };
  }

  if (input.prewarmStatus === 'warming') {
    return {
      state: 'warmingHold',
      headline: 'Warming hold',
      detail: `${nextClipName} is still prewarming, so ${currentClipName} stays live to avoid a frozen-looking switch.`
    };
  }

  return {
    state: 'hotReady',
    headline: 'Switch hot-ready',
    detail: `${nextClipName} has a presentable frame and can switch on the next quantized boundary.`
  };
}
