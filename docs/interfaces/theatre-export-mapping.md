# Theatre Export Mapping

## Intent
Theatre.js remains design-time only. Exported data is transformed into engine-native timeline objects and scheduled by Rust.

## Mapping Table
| Theatre Concept | Engine Target | Notes |
| --- | --- | --- |
| Sequence | `EngineSequence` | Section tags become runtime routing keys |
| Keyframed cue trigger | `EngineCueMarker` | Converted to quantized action intent |
| Keyframed envelope profile | `EngineEnvelopeTemplate` | Normalized to ADSR + curve identifiers |
| Timeline grouping | `section` | Used by `activate_timeline_section` |

## Compile Step
1. Parse Theatre export bundle.
2. Validate schema and constraints.
3. Normalize section identifiers and marker ordering.
4. Emit compiled timeline snapshot for runtime adapter.

## Conflict Policy
1. Manual overrides preempt all authored timeline actions.
2. Auto-editor policy preempts authored timeline when conflict exists.
3. Authored marker executes if no higher-priority instruction is pending.
