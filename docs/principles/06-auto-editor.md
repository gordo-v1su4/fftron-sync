# Principle 06: Auto-Reactive Synthesis and Arbitration (Expanded)

## Principle
The auto-editor merges authored structure with reactive adaptation while preserving deterministic live timing.

## Sub-Principles
1. Canonical clock authority
- Rust quantized scheduler controls execution timing.
2. Arbitration policy
- Priority order: manual override > auto-editor > authored timeline.
3. Relative continuity
- Clip transitions preserve temporal continuity when policy is active.
4. Section-aware execution
- Authored markers are filtered by active runtime section.

## Attribution to Modules
- Runtime adapter: `src-tauri/src/timeline/runtime_adapter.rs`
- Validation/arbitration entry: `src-tauri/src/timeline/mod.rs`
- UI control surface: `src/lib/timeline-authoring/TheatreAuthoringPanel.svelte`
