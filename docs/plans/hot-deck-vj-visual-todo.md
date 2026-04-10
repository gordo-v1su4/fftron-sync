# Hot Deck VJ Visual + Timing TODO

This TODO captures the current operator-facing gaps after the initial hot-deck/TimeShaper implementation.

## P0 — Restore visible onsets on the waveform/timeline

Problem: onsets are no longer visible on the waveform, so it is hard to understand what audio events are being counted.

- [ ] Add visible onset markers to the waveform lane / timeline lane.
- [ ] Distinguish **detected audio onsets** from **counted switch onsets**.
- [ ] Show the current clip's accumulated onset count near the playhead and/or waveform.
- [ ] Make onset markers pulse or highlight when counted toward switching.
- [ ] Add a threshold line/label so the user can see why an onset did or did not count.
- [ ] Acceptance: while audio plays, the user can see each detected onset on the waveform and can tell which onsets counted toward the clip-switch threshold.

## P0 — Fix onset counter/dot semantics

Problem: the small onset dots fill up, but the relationship between each dot and each hit/onset needs to be explicit and reliable.

- [ ] Ensure the onset counter increments only on a rising-edge threshold crossing, not every frame while the envelope remains above threshold.
- [ ] Ensure the dot meter increments exactly once per counted onset.
- [ ] Reset the dot meter after clip switch.
- [ ] Add hover tooltip explaining: “current counted onsets / onsets needed before next clip.”
- [ ] Add visual flash for the newest counted dot.
- [ ] Acceptance: if `Onsets = 4`, the clip repeats until four counted onsets occur, then switches on the next quantized boundary.

## P0 — Fix frozen frames and lag when switching clips

Problem: switching between clips can show frozen frames and lag.

- [ ] Prewarm the next eligible clip before switch time.
- [ ] Keep a valid last-good frame/proxy for the outgoing and incoming clip.
- [ ] Do not switch to a clip until it has enough readiness to present a valid frame.
- [ ] If a clip is not ready, display an explicit `cold fallback` / `warming` status instead of freezing silently.
- [ ] Add switch telemetry: requested time, presented time, frame delta, readiness (`hot`, `warm`, `coldFallback`, `failed`).
- [ ] For transitions, allow at most two decks visible: outgoing + incoming.
- [ ] Acceptance: switching either presents the next clip within one frame when hot, or visibly reports the fallback reason without a silent freeze.

## P1 — Visual TimeShaper preset curve editor

Problem: TimeShaper presets affect timing, but there is no visible representation of the active preset curve like the ShaperBox visuals.

- [ ] Add a compact TimeShaper curve display in the Video Matrix controls.
- [ ] Draw X-axis as beat-cycle phase.
- [ ] Draw Y-axis as video source-time offset/lookback.
- [ ] Show preset curve shapes for:
  - [ ] `1/8 Beat Stutter`
  - [ ] `Backspin Scratch`
  - [ ] `Reverse Slice`
  - [ ] `Tape Stop`
  - [ ] `Half-Time Drag`
- [ ] Overlay current playhead/phase marker on the curve.
- [ ] Show hard-step vs smooth-step segments visually.
- [ ] Use a waveform/thumbnail-style background inspired by the ShaperBox screenshots and the provided pale green visual references.
- [ ] Acceptance: changing a preset visibly changes the curve drawing, and the user can see where the current beat phase is on that curve.

## P1 — FFT analyzer visual representation

Problem: the FFT analyzer needs a clearer visual representation of what it is capturing, similar to the second reference image request.

- [ ] Add a more prominent FFT/spectrum display in the Audio Reactive Analyzer.
- [ ] Show low/mid/high/full bands with separate colors or regions.
- [ ] Highlight the currently selected TimeShaper trigger band.
- [ ] Draw the threshold line used for onset detection.
- [ ] Show transient/onset blips when a band crosses the threshold.
- [ ] Show envelope A/B traces or meters next to the FFT display.
- [ ] Acceptance: the user can see which frequencies are driving the current onset/trigger behavior and why a hit counted or did not count.

## P1 — Explain how bottom curves interact with TimeShaper

Problem: it is confusing whether bottom timeline curves are included in the TimeShaper behavior.

- [ ] Add UI labels or tooltips explaining that bottom `STUTTER` and `SPEED` curves still drive automation values.
- [ ] Show a small routing indicator: `Bottom curves → speed/stutter`, `TimeShaper preset → source-time remap`, `Audio analyzer → onset trigger`.
- [ ] Consider a single “routing HUD” near the Video Matrix.
- [ ] Acceptance: user can tell that bottom curves are still factored in, but are separate from the TimeShaper source-time curve.

## P2 — Documentation and screenshots

- [ ] Update `docs/hot-deck-vj-operator-guide.md` after the visual work lands.
- [ ] Add new screen grabs showing:
  - [ ] onset markers on waveform
  - [ ] onset dot meter filling
  - [ ] TimeShaper curve display
  - [ ] FFT analyzer band/threshold view
- [ ] Include sample media workflow from `test videos-audio/`.

## Verification checklist

- [ ] `bun run check`
- [ ] `bun run test`
- [ ] `bun run build`
- [ ] Browser smoke with sample video(s) from `test videos-audio/videos/`
- [ ] Browser smoke with sample audio from `test videos-audio/audio/`
- [ ] Manual visual check: no silent frozen frames on hot/warm switch
- [ ] Manual visual check: onset markers and dot meter agree
- [ ] Manual visual check: TimeShaper preset curve changes when preset changes
- [ ] Manual visual check: FFT display reflects audio input and threshold crossings
