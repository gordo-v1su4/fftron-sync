import { describe, expect, it } from 'vitest';
import { describeVideoDeckSwitchNotice } from './hotDeckSwitchStatus';

describe('describeVideoDeckSwitchNotice', () => {
  it('stays idle when auto-switch is off or only one clip is playable', () => {
    expect(
      describeVideoDeckSwitchNotice({
        autoSwitchEnabled: false,
        playableClipCount: 2,
        currentClipName: 'Deck A',
        nextClipName: 'Deck B',
        prewarmStatus: 'ready'
      })
    ).toMatchObject({
      state: 'idle',
      headline: 'Steady deck'
    });

    expect(
      describeVideoDeckSwitchNotice({
        autoSwitchEnabled: true,
        playableClipCount: 1,
        currentClipName: 'Deck A',
        nextClipName: 'Deck B',
        prewarmStatus: 'ready'
      })
    ).toMatchObject({
      state: 'idle',
      headline: 'Steady deck'
    });
  });

  it('reports a hot-ready switch only when the next deck has a presentable frame', () => {
    expect(
      describeVideoDeckSwitchNotice({
        autoSwitchEnabled: true,
        playableClipCount: 3,
        currentClipName: 'Deck A',
        nextClipName: 'Deck B',
        prewarmStatus: 'ready'
      })
    ).toEqual({
      state: 'hotReady',
      headline: 'Switch hot-ready',
      detail: 'Deck B has a presentable frame and can switch on the next quantized boundary.'
    });
  });

  it('makes warming holds explicit instead of looking like a silent freeze', () => {
    expect(
      describeVideoDeckSwitchNotice({
        autoSwitchEnabled: true,
        playableClipCount: 3,
        currentClipName: 'Deck A',
        nextClipName: 'Deck B',
        prewarmStatus: 'warming'
      })
    ).toEqual({
      state: 'warmingHold',
      headline: 'Warming hold',
      detail: 'Deck B is still prewarming, so Deck A stays live to avoid a frozen-looking switch.'
    });
  });

  it('makes cold fallback explicit when prewarm fails', () => {
    expect(
      describeVideoDeckSwitchNotice({
        autoSwitchEnabled: true,
        playableClipCount: 3,
        currentClipName: 'Deck A',
        nextClipName: 'Deck B',
        prewarmStatus: 'failed'
      })
    ).toEqual({
      state: 'coldFallback',
      headline: 'Cold fallback',
      detail: 'Deck B is not ready, so Deck A stays live until a presentable frame exists.'
    });
  });
});
