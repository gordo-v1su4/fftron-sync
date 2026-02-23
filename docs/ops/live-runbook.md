# Live Runbook

## Preflight
0. Start tooling with Bun (`bun install`, `bun run tauri:dev`).
1. Confirm sample rate lock and primary audio interface.
2. Confirm external sync protocols (MIDI/OSC/Link) available.
3. Validate Theatre export bundle with `validate_theatre_bundle`.
4. Import bundle and activate intended section.
5. Confirm render backend (`webgl2` default, `webgpu` only if validated).
6. Confirm decode backend (`htmlvideo` fallback path available).
7. Confirm `native_ffmpeg` availability if selected (`ffmpeg -version` must succeed).

## During Show
1. Keep Rust clock as timing authority.
2. Use manual override for emergency correction.
3. Switch timeline sections only on phrase boundaries.
4. Monitor marker count and section status in control panel.

## Failure Handling
1. Unknown section activation: revert to current active section and continue transport.
2. Bundle validation failure: keep previous compiled timeline loaded.
3. Visual instability: force renderer back to WebGL2.
4. Decode instability: force decode path to HTMLVideo.

## Post Show
1. Export performance logs and marker execution trace.
2. Save final timeline section state and project snapshot.
3. Capture incident notes for next runbook iteration.
