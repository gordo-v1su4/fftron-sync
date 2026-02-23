# Technical Blueprint v3: SvelteKit + Threlte + Theatre.js Authoring on Tauri v2/Rust

## Summary
This implementation is desktop-first for live reliability and uses a shared SvelteKit UI for web compatibility.

- Runtime authority: Rust quantized clock (Tauri v2 backend)
- UI: SvelteKit + TypeScript
- Visual composition: Threlte/Three.js
- Timeline authoring: Theatre.js (authoring-only)
- Decode strategy: HTMLVideo baseline, WebCodecs acceleration where available
- Render strategy: WebGL2 default, WebGPU capability-gated

## System Rules
1. Theatre exports must be validated and compiled before runtime activation.
2. Live scheduling is always executed by Rust quantized clock.
3. Priority arbitration order:
- Manual override
- Quantized auto-editor
- Authored timeline markers
4. Timeline actions execute only on quantized boundaries.

## Implemented Module Topology
- `src/lib/timeline-authoring`: Theatre bridge for bundle lifecycle
- `src/lib/engine/TransportControlPanel.svelte`: BPM/quantization/backend control surface
- `src/lib/rendering`: Threlte stage and backend exposure
- `src/lib/tauri/commands.ts`: typed command invocations
- `src-tauri/src/engine/tempo.rs`: tempo engine with tap estimator and nudge/resync controls
- `src-tauri/src/engine/scheduler.rs`: quantized scheduler queue and due-action dispatch
- `src-tauri/src/engine/media.rs`: runtime capability probing and decode/renderer backend selection
- `src-tauri/src/timeline/compiler.rs`: Theatre bundle to engine timeline compilation
- `src-tauri/src/timeline/runtime_adapter.rs`: active section + marker list runtime adapter
- `src-tauri/src/timeline/mod.rs`: validator + error model

## Core Command Surface
- `validate_theatre_bundle(bundle)`
- `import_theatre_bundle(bundle)`
- `activate_timeline_section(section)`
- `list_timeline_markers(section?)`
- `get_tempo_state()`
- `set_bpm(bpm)`, `nudge_bpm(delta)`, `tap_bpm(timestampMs?)`, `resync_downbeat(timestampMs?)`
- `set_quantization(grid)`, `queue_preview_action(action, section?, quantize?)`
- `queue_section_markers(section?)`, `list_scheduled_actions()`, `pop_due_actions(timestampMs?)`
- `detect_runtime_capabilities()`, `set_decode_backend(backend)`, `set_renderer_backend(backend)`

## Notes for Next Implementation Slice
1. Add FFT pipeline (`cpal` + `rustfft`) and emit `audio.fft_frame` event stream.
2. Add auto-editor arbitration runtime (`manual > auto > authored`) in command-level execution paths.
3. Add runtime backend switching metrics and health watchdogs.
4. Add WebCodecs availability probing from frontend and bridge to backend capability model.
