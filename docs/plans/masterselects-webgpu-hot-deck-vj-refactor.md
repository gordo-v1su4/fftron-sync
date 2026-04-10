# MasterSelects WebGPU Hot Deck VJ Refactor — Documentation Brief

> Documentation-only brief created from deep-interview clarification. Do not treat this file as implementation authorization.

## Goal
Refactor direction: keep FFTRON Sync as a Svelte + Tauri + Rust desktop-first app, but design a future WebGPU runtime using the structure and lessons from `../MasterSelects` for hot deck switching and TimeShaper-style VJ performance.

## Product Target
Build toward an instrument-like video deck system:

- Hot slot decks that can launch without cold media setup.
- Real-time VJ triggering driven by audio, tempo, and manual performance controls.
- Video TimeShaper / Ableton Simpler-like clip manipulation: stutter, loopback, reorder, scratch, reverse, tape-stop, half-speed, and source-time offset curves.
- One-frame-accurate hot deck switching.

## Target Stack
- Svelte / SvelteKit UI
- Tauri desktop shell
- Rust timing / quantized scheduling authority
- WebGPU renderer structure adapted from MasterSelects
- Web-serving/web-first productization can be deferred

## Render Model Boundary
This is **not** a full NLE-style layered alpha compositor.

- Multiple lanes/tracks/decks may exist.
- Normally only **one deck/layer is visible**.
- During transitions, at most **two decks/layers** may be visible.
- WebGPU still matters for hot texture/frame presentation, shaders, transitions, effect curves, and proxy/pre-render output.

## MasterSelects Structures To Adapt
- `WebGPUEngine` facade concept
- `WebGPUContext`
- render loop / dispatcher
- deck/layer collector
- narrowed compositor/pipeline
- texture / scrubbing / hot-frame cache
- source-owned media runtime
- decode sessions by policy
- slot deck manager and readiness state model

## Hot Deck Lifecycle
Use a deck lifecycle similar to MasterSelects:

- `cold`: no prepared runtime exists
- `warming`: media/runtime setup is in progress
- `warm`: deck resources are retained, but first-frame presentation is not guaranteed
- `hot`: valid first frame / proxy / pre-render target is available for immediate or near-immediate launch
- `failed`: warmup failed
- `disposed`: resources intentionally released

A hot launch should land within **one rendered frame**.

## Video TimeShaper Model
Map TimeShaper concepts from audio to video:

- Audio buffer → video source-time/frame cache
- LFO curve X-axis → time/beat through the modulation cycle
- LFO curve Y-axis → video source-time offset/lookback
- Step curves → stutter/repeat/reorder/scratch patterns
- Smooth step → anti-flicker / frame-hold / crossfade-safe transitions
- Instant step → hard cuts when desired
- Time range → linked loop length, beat/bar ranges, fine frame/ms ranges
- Dry/wet/mix → visual effect depth between normal deck playback and time-shaped output

## Audio-Driven Controls
Audio can drive both triggering and modulation when enabled:

- transient threshold
- frequency band filters
- FFT low/mid/high/full bands
- envelope follower amount/depth
- sensitivity/detail
- trigger shift relative to detected transient
- add/multiply style interaction between a preset curve and audio envelope
- manual override, bypass, and per-section enable/disable controls

## Non-goals For First Implementation Plan
- No literal React port from MasterSelects.
- No full multi-layer alpha compositor.
- No app code changes from this documentation pass.
- No dependency installation from this documentation pass.
- Export/offline rendering parity is a later phase unless explicitly pulled forward.

## Success Criteria
A future implementation plan should be judged against:

1. Hot deck switch lands within one rendered frame.
2. Warmed TimeShaper stutter/slice/reorder actions hit the intended frame or beat/grid boundary.
3. Non-hot fallback is explicit and does not masquerade as hot readiness.
4. User can control effect amount, threshold, enabled regions, preset curves, and manual override.
5. Renderer design stays focused on one visible deck, max two during transitions.
6. Rust tempo/quantized scheduler remains the timing authority.

## Phase 0 Review Artifact

The first documentation/code-quality review slice is captured in `docs/interfaces/hot-deck-runtime-api.md`. Treat that document as the implementation-facing API contract for hot deck state, frame handle ownership, TimeShaper curve inputs, switch telemetry, capability fallback semantics, and the one-visible-deck render invariant.

It intentionally keeps the current `HTMLVideoElement` deck behavior as a fallback baseline and requires future WebGPU hot-switch claims to prove a retained presentable frame/proxy/pre-render handle plus one-display-frame telemetry against the Rust scheduled boundary.

## Reference Inputs
- MasterSelects repo: `/Users/robertspaniolo/Documents/Github/MasterSelects`
- MasterSelects summary: `.omx/context/masterselects-reference-summary.md`
- TimeShaper/Simpler summary: `.omx/context/timeshaper-simpler-reference-summary.md`
- ShaperBox visual summary: `.omx/context/shaperbox-visual-reference-summary.md`
- Deep-interview spec: `.omx/specs/deep-interview-masterselects-webgpu-hot-deck-vj.md`
