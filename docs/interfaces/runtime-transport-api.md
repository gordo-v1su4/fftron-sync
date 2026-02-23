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

## Native FFmpeg fallback

`native_ffmpeg` is available when:
1. `ffmpeg` executable is present in `PATH`, and
2. decode backend is set to `native_ffmpeg`.

Optional Rust-native FFmpeg bindings are feature-gated in Cargo:

```bash
cargo test --features native-ffmpeg
```
