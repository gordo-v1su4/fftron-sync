# PRD / Consensus Plan — MasterSelects WebGPU Hot Deck VJ Refactor

Created: 2026-04-10T08:14:04.492477+00:00
Mode: `$plan --consensus --direct`
Input spec: `.omx/specs/deep-interview-masterselects-webgpu-hot-deck-vj.md`
Status: Final — Architect iterated, Critic approved

## Scope / Authorization Gate

This consensus plan is **planning/documentation only**. It does not authorize app code changes, dependency installation, full repo copy-in, or execution of the implementation phases. Any code implementation must be invoked by a follow-up execution workflow (for example `$ralph` or `$team`) using this plan and the test spec as input.

## Requirements Summary

Plan a future implementation that keeps FFTRON Sync on **Svelte + Tauri + Rust** while adapting the **WebGPU structure** and selected runtime ideas from `../MasterSelects` for a desktop-first hot-deck VJ instrument. The target is not a full NLE/layered alpha compositor: the renderer should normally present **one visible deck/layer**, with **two layers only during transitions**.

Current FFTRON Sync evidence:
- `src/lib/video/VideoDeckPanel.svelte` already has a clip matrix/deck shape with lane/slot clip metadata and selected clip playback state (`src/lib/video/VideoDeckPanel.svelte:22-46`), playable-lane filtering (`src/lib/video/VideoDeckPanel.svelte:68-73`), quantized switch timing (`src/lib/video/VideoDeckPanel.svelte:156-187`), audio-envelope-gated switching (`src/lib/video/VideoDeckPanel.svelte:190-214`), and audio-driven speed/stutter modulation (`src/lib/video/VideoDeckPanel.svelte:227-283`).
- `src/lib/audio/AudioReactivePanel.svelte` already builds a Web Audio FFT graph (`src/lib/audio/AudioReactivePanel.svelte:177-185`), supports mic capture (`src/lib/audio/AudioReactivePanel.svelte:225-246`), computes low/mid/high/full bands and envelopes (`src/lib/audio/AudioReactivePanel.svelte:258-344`), and publishes audio runtime clock state (`src/lib/audio/AudioReactivePanel.svelte:346-368`).
- Shared runtime stores already hold WebGPU/WebCodecs capability flags and selected backends (`src/lib/stores/runtime.ts:53-60`), tempo state (`src/lib/stores/runtime.ts:63-69`), audio bands/envelopes (`src/lib/stores/runtime.ts:91-107`), and speed/stutter automation bounds (`src/lib/stores/runtime.ts:121-130`).
- Engine types already include `RendererBackend = 'webgl2' | 'webgpu'` and `DecodeBackend = 'htmlvideo' | 'webcodecs' | 'native_ffmpeg'` (`src/lib/types/engine.ts:3-16`).
- Tauri/Rust already has backend capability selection scaffolding but reports Rust-side `webgpu` and `webcodecs` as false by default (`src-tauri/src/engine/media.rs:20-30`, `src-tauri/src/engine/media.rs:103-112`).
- Rust tempo and quantized scheduling already support downbeat/BPM state and quantized boundary scheduling (`src-tauri/src/engine/tempo.rs:45-100`, `src-tauri/src/engine/scheduler.rs:43-83`).
- Existing architecture docs identify Rust as runtime authority, WebGL2 default/WebGPU capability-gated rendering, and quantized scheduling as system rules (`docs/auto-editing-technical-blueprint-svelte-threlte-theatre.md:3-20`).

MasterSelects evidence to adapt:
- MasterSelects documents a WebGPU engine facade with context, render target management, render loop/dispatcher, layer collector, compositor, pipelines, texture/cache management, video frame manager, stats, and analysis modules (`../MasterSelects/docs/Features/GPU-Engine.md:31-68`, `../MasterSelects/docs/Features/GPU-Engine.md:100-132`).
- MasterSelects documents zero-copy video texture import requirements/fallbacks (`../MasterSelects/docs/Features/GPU-Engine.md:172-190`) and separate standard/external composite/copy pipelines (`../MasterSelects/docs/Features/GPU-Engine.md:207-214`).
- MasterSelects live VJ plan targets single-click slot launches without editor reload, warm first-frame readiness, hot slot launch within one frame or close to it, and live triggering/fading/retriggering (`../MasterSelects/docs/plans/slot-grid-live-vj-plan.md:36-47`).
- MasterSelects warm-slot contract defines slot-owned decks, runtime resources outside persisted store state, transient readiness metadata, and the `cold/warming/warm/hot/failed/disposed` lifecycle (`../MasterSelects/docs/plans/slot-grid-live-vj-phase-2-warm-slot-contract.md:48-87`, `../MasterSelects/docs/plans/slot-grid-live-vj-phase-2-warm-slot-contract.md:117-159`).
- MasterSelects media runtime types separate source descriptors, frame requests, runtime frame providers, decode sessions, and source runtimes (`../MasterSelects/src/services/mediaRuntime/types.ts:1-154`).
- MasterSelects slot deck manager has a soft cap, per-slot prepared deck entries, readiness snapshots, LRU-style eviction, and clip-ready marking (`../MasterSelects/src/services/slotDeckManager.ts:13-41`, `../MasterSelects/src/services/slotDeckManager.ts:130-193`).
- MasterSelects render scheduler separates independent render targets and throttles target rendering near 60fps (`../MasterSelects/src/services/renderScheduler.ts:1-16`, `../MasterSelects/src/services/renderScheduler.ts:193-220`).

## RALPLAN-DR Summary

### Principles
1. **Adapt structure, not framework:** use MasterSelects WebGPU architecture as a pattern while keeping Svelte/Tauri/Rust as the target stack.
2. **Deck switching over alpha compositing:** optimize one visible deck, max two during transitions; do not build a full multi-layer NLE compositor.
3. **Hot readiness must be honest:** `hot` means a frame/proxy/pre-render target is actually ready for one-frame switching; cold fallback must be reported as cold.
4. **Rust stays timing authority:** audio and WebGPU drive modulation/rendering, while beat/grid execution remains tied to Rust tempo/quantized scheduling.
5. **Design for reversibility:** phase the work behind contracts/feature flags and avoid new dependencies until their role is proven.

### Decision Drivers
1. **One-frame hot switch accuracy** over broad editor features.
2. **TimeShaper/Simpler-like live video time manipulation** over generic audio-reactive visuals.
3. **Maintaining desktop Svelte/Tauri/Rust architecture** over direct React/Vite porting.

### Viable Options

#### Option A — Full MasterSelects compositor transplant (rejected)
- Pros: maximizes reuse of known MasterSelects GPU concepts; may provide export/RAM-preview paths earlier.
- Cons: violates the clarified non-goal of no arbitrary multi-layer alpha compositor; creates React-to-Svelte translation risk; expands scope beyond one visible deck and two-layer transitions.
- Invalidation rationale: the user explicitly narrowed the target to lane/deck switching, normally one visible layer, at most two during transitions.

#### Option B — Narrowed MasterSelects-inspired hot deck renderer (favored)
- Pros: preserves MasterSelects WebGPU structure while fitting FFTRON Sync’s product shape; focuses on one-frame hot switching; maps naturally to slot deck lifecycle and source-owned runtime patterns; can later add export/RAM-preview parity.
- Cons: requires designing new Svelte/Tauri abstractions rather than copying code; may need staged WebGPU/WebCodecs capability work before real one-frame claims are measurable.

#### Option C — Incremental HTMLVideo-only enhancement (rejected as final target, acceptable fallback)
- Pros: lowest immediate risk; current `VideoDeckPanel.svelte` already uses HTMLVideo and audio-driven stutter/speed controls.
- Cons: unlikely to meet one-frame hot-switch accuracy and TimeShaper-like source-time jumps reliably; does not satisfy user request to use MasterSelects WebGPU structure.
- Invalidation rationale: keep as fallback path, not the target architecture.

## ADR — Architecture Direction

### Decision
Adopt **Option B: narrowed MasterSelects-inspired hot deck renderer**. The future implementation should introduce Svelte/Tauri/Rust-native modules that mirror the useful MasterSelects WebGPU/runtime roles, but restrict rendering to one visible deck in normal operation and two visible decks during transitions.

### Drivers
- One-frame hot deck switching is the success metric.
- User wants TimeShaper/Simpler-style video source-time manipulation driven by audio and manual controls.
- User wants MasterSelects WebGPU structure while preserving Svelte/Tauri/Rust desktop-first architecture.

### Alternatives considered
- Full MasterSelects compositor transplant: rejected for scope/product mismatch.
- HTMLVideo-only incremental improvements: rejected as final target, retained as fallback/prototyping layer.

### Why chosen
The narrowed architecture keeps the performance-oriented parts of MasterSelects (WebGPU facade/context/dispatcher/cache/runtime/deck readiness) without importing its full NLE compositing surface. It also aligns with existing FFTRON primitives: slot-like `VideoDeckPanel`, FFT/envelope stores, and Rust tempo scheduling.

### Consequences
- The plan must define contracts before code fanout: deck readiness, frame cache semantics, render ownership, and audio modulation APIs.
- Export/RAM-preview parity is later-phase work, not the first MVP.
- New dependencies are proposal items until a follow-up execution plan approves them.

### Follow-ups
- Draft module contracts first.
- Build tests around readiness truthfulness and one-frame hot switch targets.
- Only then implement WebGPU/decode runtime slices behind feature flags.

## Timing Authority Contract

The future implementation must define one measurable timing path before claiming “zero latency”:

1. **Rust scheduled boundary timestamp** — beat/grid boundary computed by the Rust quantized scheduler, preserving the existing scheduler semantics in `src-tauri/src/engine/scheduler.rs:43-83`.
2. **Frontend switch-request receipt timestamp** — when the Svelte/WebView runtime receives or issues the deck switch request. The current deck is frontend-timed with `Date.now()` in `src/lib/video/VideoDeckPanel.svelte:156-188`; the plan must replace or bridge this with an explicit Rust-authoritative timestamp path.
3. **Render/presentation timestamp** — when the WebGPU/renderer path presents the selected deck frame.
4. **Display frame budget** — one rendered frame at the active display cadence (for example ~16.67ms at 60Hz) for hot switches.
5. **Readiness classification** — every switch event must be classified as `hot`, `warm`, `coldFallback`, or `failed`.

A switch may claim `hot` only if it had a valid presentable frame/proxy/pre-render handle before the switch boundary and the measured presentation delta is within the frame budget.

## Frame / Cache Lifecycle Contract

Adapt MasterSelects’ runtime ownership model before implementing hot-deck fanout. MasterSelects separates frame handles, decode sessions, source runtimes, retain/release, and frame cache APIs (`../MasterSelects/src/services/mediaRuntime/types.ts:70-130`). The FFTRON adaptation should document and test equivalent rules:

- Acquiring a deck frame returns a handle with explicit ownership/release semantics.
- Disposing a deck releases associated runtime sessions and cache handles.
- Evicting a warm/hot deck releases frame/proxy/pre-render resources.
- Failed frame acquisition cannot transition to `hot`.
- Stale frame tolerance must be explicit: allowed only for defined frame-hold/fallback behavior, never hidden as fresh hot readiness.

## Capability / Fallback Matrix

The plan must handle these cases explicitly before code fanout:

| Case | Expected behavior | Can claim `hot`? |
| --- | --- | --- |
| WebGPU + frame/proxy ready | WebGPU hot switch path | Yes, if frame-budget telemetry passes |
| WebGPU available but frame not ready | warm/cold fallback status | No |
| No `navigator.gpu` | HTMLVideo/WebGL fallback or disabled hot-deck mode | No unless an equivalent prepared presentation contract exists |
| No WebCodecs | fallback decode/proxy strategy | No by default |
| Rust capability false, WebView probe true | JS/WebView capability may enable renderer, Rust stays conservative until bridged | Only with JS/WebView telemetry |
| Device loss | downgrade readiness and retry/recover | No during loss/recovery |
| HTMLVideo cold path | functional playback fallback | No |

## Proposed Module Map

| MasterSelects concept | FFTRON Sync adapted target | Purpose |
| --- | --- | --- |
| `WebGPUEngine` facade | `src/lib/rendering/webgpu/DeckGpuEngine.ts` | Thin facade over context, render loop, deck target manager, effects pipeline. |
| `WebGPUContext` | `src/lib/rendering/webgpu/WebGpuContext.ts` | Browser/Tauri WebView GPU device/canvas setup, loss recovery, feature probing. |
| `RenderTargetManager` | `src/lib/rendering/webgpu/DeckRenderTargetManager.ts` | One active deck target plus optional transition target; no arbitrary layer stack. |
| `RenderLoop`/`RenderDispatcher` | `src/lib/rendering/webgpu/DeckRenderLoop.ts` and `DeckRenderDispatcher.ts` | Present hot deck frames and transition frames at RAF cadence. |
| `LayerCollector` | `DeckSourceCollector.ts` | Resolve current visible deck frame or transition pair from runtime/deck state. |
| `CompositorPipeline`/`EffectsPipeline` | `DeckTimeShapePipeline.ts` + `DeckTransitionPipeline.ts` | TimeShaper effect curves, frame hold/crossfade policies, simple transitions. |
| `TextureManager`/`ScrubbingCache` | `DeckFrameCache.ts` | Store hot frames/proxies/pre-render results for one-frame switching. |
| `MediaSourceRuntime` / `DecodeSession` | `src/lib/runtime/media/*` | Source-owned sessions, frame requests, cache handles, decoder lifecycle. |
| `slotDeckManager` | `src/lib/runtime/decks/hotDeckManager.ts` | `cold/warming/warm/hot/failed/disposed` lifecycle and slot-owned resources. |

## Implementation Steps

### Phase 0 — Contract and docs hardening
1. Extend `docs/plans/masterselects-webgpu-hot-deck-vj-refactor.md` into an implementation contract with the module map above, a deck readiness state machine, and one-visible-deck render rule.
2. Add or update a `docs/interfaces/` document for hot deck runtime APIs: `HotDeckState`, `HotDeckId`, `DeckFrameRequest`, `VideoTimeShapeCurve`, `AudioTriggerConfig`, and `DeckSwitchResult`.
3. Define feature flags conceptually: `useWebGpuHotDecks`, `useVideoTimeShaper`, `useDeckFrameCache`, defaulting off for future implementation.
4. Document fallback semantics: HTMLVideo/cold path is allowed, but must not claim `hot`.

### Phase 1 — Test-first contracts (no renderer yet)
1. Add pure TypeScript tests for future readiness and curve math before runtime wiring.
2. Test state transitions against MasterSelects lifecycle (`cold -> warming -> warm/hot`, failure, dispose).
3. Test TimeShaper curve mapping from beat-cycle X and Y offset to source-time request.
4. Test one-visible-deck/two-transition-deck selector rules.

### Phase 2 — Source-owned deck runtime skeleton
1. Introduce FFTRON-native media runtime contracts inspired by MasterSelects `MediaSourceRuntime` and `DecodeSession` (`../MasterSelects/src/services/mediaRuntime/types.ts:1-154`).
2. Keep clips/decks as timeline/performance instances; move source metadata/session/cache responsibility into runtime objects.
3. Track deck ownership separately from UI/store metadata; runtime resources stay in services, store state remains serializable metadata only, matching MasterSelects' store boundary (`../MasterSelects/docs/plans/slot-grid-live-vj-phase-2-warm-slot-contract.md:61-87`).

### Phase 3 — WebGPU hot deck renderer skeleton
1. Implement the narrowed facade/context/target manager/dispatcher skeleton behind `useWebGpuHotDecks`.
2. Support one deck target and optional transition target only.
3. Integrate WebGPU capability state with existing backend capability stores (`src/lib/stores/runtime.ts:53-60`) and frontend backend types (`src/lib/types/engine.ts:3-16`).
4. Keep Rust-side capabilities conservative unless the WebView/JS side confirms real WebGPU/WebCodecs availability, because Rust media detection currently returns `webgpu: false` / `webcodecs: false` (`src-tauri/src/engine/media.rs:103-112`).

### Phase 4 — Hot deck warmup and switching
1. Create `hotDeckManager` with readiness states and soft-cap/eviction policy inspired by MasterSelects (`../MasterSelects/src/services/slotDeckManager.ts:13-41`, `../MasterSelects/src/services/slotDeckManager.ts:130-193`).
2. Warm source frames/proxies/pre-render results for assigned slots.
3. Make switching select prepared deck frame handles before swapping visible output.
4. Instrument switch accuracy and log whether each switch was hot, warm, cold fallback, or failed.

### Phase 5 — Video TimeShaper/Simpler effect model
1. Create pure curve/effect model: source-time offset, loopback, stutter/repeat, reverse, tape-stop, scratch, and half-speed patterns.
2. Feed it from existing FFT/envelope state (`src/lib/audio/AudioReactivePanel.svelte:258-344`, `src/lib/stores/runtime.ts:91-130`).
3. Preserve manual override, bypass, mix/depth, threshold, and frequency band selection.
4. Present curve editor UI only after the runtime contract has test coverage; reuse Svelte UI patterns and the existing automation lane concepts rather than porting React components.

### Phase 6 — Transition and fallback behavior
1. Add two-deck transition path only; do not generalize to arbitrary compositing.
2. Define frame-hold/crossfade behavior for “smooth step” and hard-cut behavior for “instant step.”
3. Keep cold fallback obvious in status/telemetry.

### Deferred phases
- Export/offline rendering parity.
- RAM-preview parity beyond hot frame/proxy cache needed for live switching.
- Web-serving/web-first productization.
- MIDI mapping beyond placeholder/manual trigger APIs.

## Acceptance Criteria

1. The implementation contract cites the existing FFTRON deck, audio, store, backend, and Rust scheduler files listed above.
2. Hot deck state machine has unit tests for every allowed transition in `cold/warming/warm/hot/failed/disposed`.
3. TimeShaper curve math has tests for beat-synced, audio-triggered, manual, smooth-step, and instant-step modes.
4. Render selection rules prove exactly one visible deck in steady state and exactly two during transitions.
5. A future hot-switch telemetry event can distinguish hot, warm, cold fallback, and failed launches.
6. A hot launch target is defined as presenting the selected prepared deck within one rendered frame at the current display cadence.
7. WebGPU/WebCodecs unavailable behavior is explicitly tested or documented as fallback, never as hot.
8. No React/Vite code is copied into FFTRON; all modules are Svelte/Tauri/Rust-adapted.
9. No dependencies are installed until a follow-up implementation phase approves them.
10. No full MasterSelects-style arbitrary multi-layer compositor is introduced; tests and docs name the one-visible-deck invariant as a hard rule.
11. No switch emits `hot` without a valid presentable frame/proxy/pre-render handle and telemetry proving the frame-budget target.
12. Capability fallback cases in the matrix above are represented in tests or explicit manual verification steps.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Over-porting MasterSelects full compositor | Keep one-visible-deck invariant in contracts/tests. |
| False `hot` readiness | Require a valid prepared frame/proxy/pre-render handle before `hot`. |
| WebGPU support mismatch in Tauri WebView | Probe in JS/WebView and keep Rust backend conservative until bridged. |
| Decoder/cache leaks | Source-owned runtime must own release/dispose APIs before hot deck fanout. |
| Audio-driven effects become uncontrollable | Require amount/mix/depth, threshold, bypass, and manual override in MVP contract. |
| One-frame target is unmeasurable | Add explicit switch telemetry timestamps at request and presentation boundary. |

## Verification Steps

- Run docs review: ensure all references exist and line citations remain valid.
- Run `bun run test` after implementation starts, especially new pure runtime/curve tests.
- Run `bun run check` after any Svelte/TypeScript implementation.
- Run Rust tests for scheduler/capability changes if Rust code changes.
- Manual smoke: load 4 video decks, warm two, switch hot deck, verify one visible deck and one-frame target telemetry.
- Manual smoke: trigger TimeShaper-style stutter with audio envelope threshold and verify bypass/depth controls.

## Available-Agent-Types Roster

Available roles suitable for follow-up:
- `planner` — refine contracts and milestone sequencing.
- `architect` — WebGPU/runtime boundary design and invariants.
- `executor` — implementation lanes.
- `test-engineer` — unit/integration/e2e test strategy.
- `verifier` — completion evidence and claim validation.
- `designer` — Svelte UI/curve editor interaction design.
- `security-reviewer` — Tauri/media file boundary review if file access expands.
- `critic` — latency/cache/decoder risk review, with performance concerns explicitly in the review brief.
- `build-fixer` — toolchain/typecheck/build failures.

## Follow-up Staffing Guidance

### `$ralph` path
Use when a single persistent owner should drive phases sequentially.
Suggested roles:
- 1 `architect` (high) for Phase 0/2/3 invariants.
- 1 `test-engineer` (medium) for Phase 1 test plan.
- 1 `executor` (high) for implementation once contracts pass.
- 1 `verifier` (high) for one-frame telemetry and fallback evidence.

### `$team` path
Use when implementing after plan approval because work naturally splits into disjoint lanes:
- Lane A — contracts/types/tests: `test-engineer` + `executor`.
- Lane B — WebGPU skeleton: `architect` + `executor`.
- Lane C — hot deck runtime/cache: `executor` + `critic` with a performance-risk review brief.
- Lane D — TimeShaper curve/audio model: `executor` + `designer`.
- Lane E — verification/build: `verifier` + `build-fixer`.

Launch hints:
```bash
$team .omx/plans/prd-masterselects-webgpu-hot-deck-vj.md
# or from shell in OMX runtime:
omx team --plan .omx/plans/prd-masterselects-webgpu-hot-deck-vj.md
```

Team verification path:
1. Team proves tests/checks pass for touched lanes.
2. Team records hot/warm/cold switch telemetry evidence.
3. Ralph or verifier performs final sequential validation against this PRD and `.omx/plans/test-spec-masterselects-webgpu-hot-deck-vj.md`.

## Changelog
- Initial consensus draft created from deep-interview spec.
- Applied Architect feedback: added authorization gate, timing authority contract, frame/cache lifecycle contract, capability fallback matrix, stronger hot-readiness acceptance criteria, and normalized staffing labels.
- Critic review approved the PRD/test-spec pair for future `$ralph` or `$team` execution handoff.
