# Principle 05: Envelopes and Accents (Expanded)

## Principle
Envelope logic converts authored or reactive control signals into stable visual modulation paths.

## Sub-Principles
1. ADSR normalization
- Theatre-authored envelope curves are normalized to engine ADSR fields.
2. Curve semantics
- `linear`, `sine_in`, `sine_out`, `exp` are supported v1 curves.
3. Playback behavior binding
- Envelopes may be bound to loop/bounce/random/once modes in effect presets.
4. Safety constraints
- Envelope outputs are clamped to destination-specific min/max ranges.

## Attribution to Modules
- Authoring map: `src/lib/timeline-authoring`
- Engine schema: `src/lib/types/timeline.ts`
- Runtime templates: `src-tauri/src/timeline/types.rs`
