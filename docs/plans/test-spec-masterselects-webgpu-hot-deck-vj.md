# Test Spec — MasterSelects WebGPU Hot Deck VJ Refactor

Created: 2026-04-10T08:14:04.492477+00:00
Input PRD: `.omx/plans/prd-masterselects-webgpu-hot-deck-vj.md`
Status: Final — Architect iterated, Critic approved

## Test Strategy

The first executable work should be test-first around pure contracts before WebGPU implementation. This prevents the project from over-porting MasterSelects or making unmeasurable “zero latency” claims.

## Unit Tests

1. **Hot deck lifecycle reducer**
   - Given `cold`, `prepare` transitions to `warming`.
   - Given `warming`, first valid frame transitions to `hot`.
   - Given `warming`, resource readiness without first frame transitions to `warm`.
   - Given `warm`, frame readiness transitions to `hot`.
   - Given `warming`, load error transitions to `failed`.
   - Given `warm`/`hot`, dispose transitions to `disposed`.
   - Given `failed`/`disposed`, retry transitions to `warming`.

2. **One-visible-deck selector**
   - Steady state returns one visible deck.
   - Transition state returns exactly two decks.
   - More than two requested deck outputs is rejected or reduced deterministically.

3. **Video TimeShaper curve math**
   - X-axis beat position maps to source-time offset.
   - Y-axis offset clamps to configured beat/bar/fine range.
   - Smooth step uses hold/crossfade-safe transition metadata.
   - Instant step emits hard source-time jump metadata.
   - Manual bypass returns normal playback time.
   - Mix/depth 0 returns normal playback; mix/depth 1 returns full shaped time.

4. **Audio trigger configuration**
   - Threshold blocks sub-threshold transients.
   - Frequency band filters select low/mid/high/full sources.
   - Sensitivity/detail changes trigger density predictably.
   - Trigger shift offsets scheduled trigger time within configured bounds.

5. **Timing authority contract**
   - Hot switch measurement includes scheduled boundary, frontend request receipt, and presentation timestamps.
   - A hot switch passes only when presentation lands within one display-frame budget.
   - Frontend-only `Date.now()` timing is treated as fallback/prototype data unless bridged to Rust scheduler semantics.

6. **Frame/cache lifecycle**
   - A deck cannot become `hot` without a valid presentable frame/proxy/pre-render handle.
   - Disposing or evicting a deck releases frame/cache/session handles.
   - Failed or stale frame acquisition does not silently become `hot`.
   - Stale frame tolerance is explicit and mapped to frame-hold/fallback behavior.

## Integration Tests

1. **Runtime store integration**
   - Use existing runtime capability and audio stores (`src/lib/stores/runtime.ts:53-130`) without breaking existing consumers.
2. **Deck switching integration**
   - Existing quantized switch logic (`src/lib/video/VideoDeckPanel.svelte:156-214`) remains the behavioral baseline while hot-deck runtime is feature-gated.
3. **Audio loop integration**
   - FFT/envelope output (`src/lib/audio/AudioReactivePanel.svelte:258-344`) can feed the TimeShaper model without direct DOM/video coupling.
4. **Rust timing integration**
   - Quantized scheduling continues to use `src-tauri/src/engine/scheduler.rs:43-83` semantics.

5. **Capability / fallback matrix**
   - No WebGPU, no WebCodecs, device-loss, Rust/JS probe mismatch, HTMLVideo fallback, and cold-frame cases all produce explicit non-hot readiness states.

## E2E / Manual Smoke Tests

1. Load 4 video clips/decks.
2. Warm at least two decks.
3. Trigger hot deck switch; telemetry reports requested deck presented within one rendered frame.
4. Trigger cold deck switch; UI/telemetry reports cold fallback and does not claim hot.
5. Enable TimeShaper preset curve and verify stutter/loopback effect follows audio threshold.
6. Disable/bypass TimeShaper and verify normal playback.
7. Trigger a transition and verify only two decks are visible.
8. Disable WebGPU/WebCodecs capability and verify fallback is explicit.

## Observability

Future implementation should emit structured events:
- `hotDeck.prepare.start`
- `hotDeck.prepare.ready`
- `hotDeck.prepare.failed`
- `hotDeck.switch.requested`
- `hotDeck.switch.presented`
- `hotDeck.switch.fallbackCold`
- `timeShaper.trigger.detected`
- `timeShaper.curve.applied`
- `timeShaper.bypass.changed`

Required fields:
- deck id / slot id
- source id
- readiness state
- scheduled boundary timestamp
- requested timestamp
- frontend receipt timestamp
- presented timestamp
- frame delta
- display frame budget
- backend (`webgpu`, `webgl2`, `htmlvideo`, `webcodecs`, `native_ffmpeg`)
- fallback reason if any

## Acceptance Criteria Mapping

- One-frame switching: proven by `switch.presented - switch.requested <= one display frame budget` for hot decks.
- TimeShaper responsiveness: curve application reaches intended source frame at scheduled beat/grid boundary or documented fallback.
- Truthful readiness: non-hot paths never emit `hot` status.
- Manual override: bypass/depth controls produce deterministic output in unit tests.

- Capability fallback matrix: no unavailable-backend case can report `hot` without an equivalent prepared-frame contract.
- Frame/cache lifecycle: dispose and eviction release all owned handles in unit or integration tests.
