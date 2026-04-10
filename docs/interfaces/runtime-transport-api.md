# Runtime + Transport API

## Tauri Commands

### Timeline authoring
- `validate_theatre_bundle(bundle)`
- `import_theatre_bundle(bundle)`
- `activate_timeline_section(section)`
- `list_timeline_markers(section?)`

### Tempo/BPM
- `get_tempo_state()`
- `set_bpm(bpm)`
- `nudge_bpm(delta)`
- `tap_bpm(timestampMs?)`
- `resync_downbeat(timestampMs?)`

### Quantized scheduler
- `set_quantization(grid)`
- `queue_preview_action(action, section?, quantize?)`
- `queue_section_markers(section?)`
- `list_scheduled_actions()`
- `pop_due_actions(timestampMs?)`

### Runtime backends
- `detect_runtime_capabilities()`
- `set_decode_backend(backend)`
- `set_renderer_backend(backend)`

## Type Notes

- `DecodeBackend`: `htmlvideo | webcodecs | native_ffmpeg`
- `RendererBackend`: `webgl2 | webgpu`
- `TempoSource`: `manual | tap | link | midi_clock | auto`

## Hot deck runtime (planned contract)

See `docs/interfaces/hot-deck-runtime-api.md` for the Phase 0 API contract and code-quality review baseline for the MasterSelects-inspired WebGPU hot deck refactor. Any future Tauri command/event expansion must preserve these invariants:

- Rust quantized scheduling remains the timing authority for `scheduledBoundaryMs`.
- Frontend/WebGPU telemetry must classify every switch as `hot`, `warm`, `coldFallback`, or `failed`.
- Hot readiness requires a retained presentable frame/proxy/pre-render handle before the scheduled boundary.
- Runtime stores carry serializable metadata only; GPU/video/decode handles remain service-owned and releasable.

## Native FFmpeg fallback

`native_ffmpeg` is available when:
1. `ffmpeg` executable is present in `PATH`, and
2. decode backend is set to `native_ffmpeg`.

Optional Rust-native FFmpeg bindings are feature-gated in Cargo:

```bash
cargo test --features native-ffmpeg
```
