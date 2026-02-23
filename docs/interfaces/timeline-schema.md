# Timeline Schema

## Type Contracts
```ts
type TimelineAuthority = 'rust_clock';
type TheatreUsage = 'authoring_only';

type QuantizeGrid = '1n' | '1/2n' | '1/4n' | '1/8n' | '1/16n';
type CueAction = 'trigger_clip' | 'apply_accent' | 'swap_scene';

interface TheatreExportBundle {
  version: string;
  fps: number;
  sequences: EngineSequence[];
  cueMarkers: EngineCueMarker[];
  envelopeTemplates: EngineEnvelopeTemplate[];
}

interface EngineCueMarker {
  id: string;
  section: string;
  bar: number;
  beat: number;
  quantize: QuantizeGrid;
  action: CueAction;
  payload: Record<string, unknown>;
}
```

## Validation Rules
1. `version` must be non-empty.
2. `fps` must be > 0.
3. At least one sequence and one cue marker must exist.
4. `beat` must be in `1..=4` for v1.
5. Marker section names must map to known runtime sections after compilation.

## Runtime Semantics
1. Markers are sorted by `(bar, beat)` during compile.
2. Active section controls marker filtering in live view.
3. Marker execution is quantized and delegated to Rust scheduler.
