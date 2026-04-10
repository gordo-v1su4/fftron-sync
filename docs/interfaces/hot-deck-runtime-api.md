# Hot Deck Runtime API Contract

Status: Phase 0 documentation contract for the MasterSelects-inspired WebGPU hot deck refactor. This document is a review and implementation boundary, not a claim that the runtime is already implemented.

Binding inputs:
- `docs/plans/prd-masterselects-webgpu-hot-deck-vj.md`
- `docs/plans/test-spec-masterselects-webgpu-hot-deck-vj.md`
- `docs/plans/masterselects-webgpu-hot-deck-vj-refactor.md`

## Code-quality review baseline

Current FFTRON Sync code already has useful primitives, but the hot-deck implementation must not treat them as proof of one-frame hot switching:

- `src/lib/video/VideoDeckPanel.svelte:22-73` models clips by lane/slot and can filter playable lanes, which is a good UI seed for deck ownership.
- `src/lib/video/VideoDeckPanel.svelte:156-214` performs frontend-timed quantized switching using `Date.now()` against the tempo store. This is acceptable as a prototype fallback, but hot-switch telemetry must be bridged to Rust scheduler timestamps before it can claim Rust-authoritative timing.
- `src/lib/video/VideoDeckPanel.svelte:227-283` already applies audio-driven playback-rate and stutter modulation on an `HTMLVideoElement`. Keep this as fallback behavior; do not call it WebGPU hot-deck readiness.
- `src/lib/audio/AudioReactivePanel.svelte:258-344` computes low/mid/high/full FFT bands plus envelopes that can feed TimeShaper curves without coupling curve math to the DOM.
- `src/lib/stores/runtime.ts:53-130` keeps runtime capabilities, tempo, audio bands/envelopes, and automation bounds in serializable Svelte stores. Runtime-owned GPU/video handles must stay out of these stores.
- `src/lib/types/engine.ts:3-16` already names `webgl2 | webgpu` and `htmlvideo | webcodecs | native_ffmpeg`; reuse those backend labels in hot-deck telemetry.
- `src-tauri/src/engine/media.rs:103-112` currently reports Rust-side `webgpu` and `webcodecs` as unavailable. JS/WebView probing may enable a browser-side renderer, but Rust capability state must remain conservative until explicitly bridged.
- `src-tauri/src/engine/scheduler.rs:43-83` and `src-tauri/src/engine/tempo.rs:45-100` are the scheduling authority for quantized execution. Hot-deck APIs should carry their scheduled boundary timestamps through to presentation telemetry.

## Hard invariants

1. **No literal React port.** MasterSelects is a structural reference only.
2. **No arbitrary multi-layer alpha compositor.** Steady-state render selection returns exactly one visible deck; transitions return at most two.
3. **Rust timing remains authoritative.** Frontend-only timestamps are diagnostic fallback data unless tied to a Rust scheduled boundary.
4. **`hot` readiness must be honest.** A deck is hot only when it owns or references a valid presentable prepared frame, proxy, or pre-render target before the switch boundary.
5. **Stores remain serializable.** GPU devices, video frames, decode sessions, object URLs, and retained cache handles live in runtime services, not Svelte store snapshots.
6. **Fallbacks are explicit.** HTMLVideo/WebGL/cold paths may keep playback functional but must not emit `hot` unless they satisfy the same prepared-presentation contract.

## Type contracts

These interfaces are the TypeScript-facing shape for the first implementation slice. Names may move during implementation, but semantic fields are required.

```ts
import type { DecodeBackend, RendererBackend, ReactiveBandTarget } from '$lib/types/engine';
import type { QuantizeGrid } from '$lib/types/timeline';

export type HotDeckId = string;
export type HotDeckReadiness = 'cold' | 'warming' | 'warm' | 'hot' | 'failed' | 'disposed';
export type DeckSwitchReadiness = 'hot' | 'warm' | 'coldFallback' | 'failed';
export type DeckFrameHandleKind = 'videoFrame' | 'proxyTexture' | 'preRenderTarget' | 'htmlVideoFallback';
export type TimeShapeStepMode = 'smooth' | 'instant';
export type TimeShapeDirection = 'forward' | 'reverse' | 'pingPong';

export interface DeckFrameHandleRef {
  id: string;
  kind: DeckFrameHandleKind;
  sourceId: string;
  deckId: HotDeckId;
  sourceTimeMs: number;
  createdAtMs: number;
  staleAfterMs: number | null;
  releaseToken: string;
}

export interface HotDeckState {
  id: HotDeckId;
  slotId: string;
  sourceId: string;
  readiness: HotDeckReadiness;
  rendererBackend: RendererBackend;
  decodeBackend: DecodeBackend;
  preparedFrame: DeckFrameHandleRef | null;
  lastError: string | null;
  updatedAtMs: number;
}

export interface DeckFrameRequest {
  deckId: HotDeckId;
  sourceId: string;
  requestedSourceTimeMs: number;
  quantize: QuantizeGrid | 'none';
  scheduledBoundaryMs: number | null;
  allowStaleFrameHold: boolean;
}

export interface AudioTriggerConfig {
  enabled: boolean;
  band: ReactiveBandTarget;
  threshold: number;
  sensitivity: number;
  detail: number;
  triggerShiftMs: number;
}

export interface VideoTimeShapeCurve {
  enabled: boolean;
  bypass: boolean;
  mix: number;
  depth: number;
  cycleBeats: number;
  yRangeMs: number;
  direction: TimeShapeDirection;
  stepMode: TimeShapeStepMode;
  points: Array<{ x: number; y: number }>;
  audio: AudioTriggerConfig;
}

export interface DeckSwitchRequest {
  fromDeckId: HotDeckId | null;
  toDeckId: HotDeckId;
  quantize: QuantizeGrid | 'none';
  transitionMs: number;
  scheduledBoundaryMs: number;
  frontendRequestedAtMs: number;
}

export interface DeckSwitchResult {
  requestId: string;
  fromDeckId: HotDeckId | null;
  toDeckId: HotDeckId;
  readiness: DeckSwitchReadiness;
  rendererBackend: RendererBackend;
  decodeBackend: DecodeBackend;
  scheduledBoundaryMs: number;
  frontendRequestedAtMs: number;
  frontendReceivedAtMs: number;
  presentedAtMs: number | null;
  displayFrameBudgetMs: number;
  frameDeltaMs: number | null;
  preparedFrameId: string | null;
  fallbackReason: string | null;
}
```

## Readiness state machine

Allowed transitions:

| From | Event | To | Required evidence |
| --- | --- | --- | --- |
| `cold` | `prepare` | `warming` | Source and slot identifiers are valid. |
| `warming` | `resourcesReady` | `warm` | Decoder/session/cache exists, but no presentable frame yet. |
| `warming` | `frameReady` | `hot` | A valid `DeckFrameHandleRef` is retained. |
| `warm` | `frameReady` | `hot` | A valid `DeckFrameHandleRef` is retained. |
| `warming`/`warm` | `prepareFailed` | `failed` | Error message and fallback reason are recorded. |
| `warm`/`hot`/`failed` | `dispose` | `disposed` | Runtime handles are released. |
| `failed`/`disposed` | `retry` | `warming` | Previous handles are released before retry begins. |

Disallowed transitions must fail loudly in tests, especially any transition to `hot` without a retained presentable handle.

## Render selection rule

The selector that feeds WebGPU must return a bounded presentation set:

```ts
export interface VisibleDeckSelection {
  mode: 'steady' | 'transition';
  decks: HotDeckId[];
}
```

- `steady` mode returns exactly one deck.
- `transition` mode returns exactly two decks: outgoing and incoming.
- More than two requested outputs must be rejected or deterministically reduced before render dispatch.
- The target manager may retain warm/hot resources for more decks, but only the selected one or transition pair is visible.

## Timing and telemetry contract

A switch may report `readiness: 'hot'` only when all of the following are true:

1. `scheduledBoundaryMs` is present and came from Rust quantized scheduling or an explicitly documented Rust-equivalent boundary.
2. The target deck had a retained prepared frame/proxy/pre-render handle before `scheduledBoundaryMs`.
3. The renderer reports `presentedAtMs`.
4. `frameDeltaMs = presentedAtMs - scheduledBoundaryMs` is less than or equal to `displayFrameBudgetMs`.
5. Device/backend state did not fall back during the request.

If any condition fails, the result must be `warm`, `coldFallback`, or `failed` with a `fallbackReason`.

Required event names:

- `hotDeck.prepare.start`
- `hotDeck.prepare.ready`
- `hotDeck.prepare.failed`
- `hotDeck.switch.requested`
- `hotDeck.switch.presented`
- `hotDeck.switch.fallbackCold`
- `timeShaper.trigger.detected`
- `timeShaper.curve.applied`
- `timeShaper.bypass.changed`

## Capability/fallback matrix

| Runtime case | Behavior | Hot claim |
| --- | --- | --- |
| WebGPU + prepared frame/proxy/pre-render target | WebGPU hot switch path with presentation telemetry. | Allowed if frame-budget check passes. |
| WebGPU available but no presentable frame | Stay `warm` or emit `coldFallback`. | Not allowed. |
| No `navigator.gpu` | Use WebGL/HTMLVideo fallback or disable hot-deck mode. | Not allowed by default. |
| No WebCodecs | Use HTMLVideo/native fallback decode strategy. | Not allowed unless an equivalent prepared-presentation contract exists. |
| Rust capability false, WebView probe true | JS/WebView renderer may run behind a feature flag; Rust state remains conservative. | Allowed only with JS presentation telemetry and documented Rust boundary bridge. |
| Device loss | Downgrade readiness and recover/retry. | Not allowed during loss/recovery. |
| HTMLVideo cold path | Functional playback fallback. | Not allowed. |

## Review checklist for implementation PRs

- Tests cover every allowed and disallowed readiness transition.
- Tests prove one visible deck in steady state and exactly two decks during transition.
- TimeShaper curve math is pure and testable without DOM or WebGPU.
- Audio trigger tests use `ReactiveBandTarget` labels from existing engine types.
- Svelte stores contain serializable metadata only; runtime service maps own release/dispose responsibilities.
- Every switch result classifies `hot`, `warm`, `coldFallback`, or `failed` and includes timing fields.
- WebGPU/WebCodecs unavailable paths are covered by tests or explicit manual verification.
- Documentation and UI labels avoid claiming "zero latency" unless telemetry proves one-frame hot switching.
