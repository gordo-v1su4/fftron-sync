# Hot Deck Runtime Interface

This interface is the Svelte/Tauri/Rust-adapted contract for the MasterSelects-inspired hot deck runtime. It intentionally is not a React port and not an arbitrary multi-layer alpha compositor.

## Hard invariants

- Rust scheduler timestamps remain authoritative for hot switch claims.
- A steady render selection returns one visible deck.
- A transition render selection returns at most two visible decks.
- `hot` requires a valid presentable frame/proxy/pre-render handle before the switch.
- HTMLVideo/WebGPU/WebCodecs fallback paths may remain playable, but must not claim `hot` without the prepared-frame and frame-budget telemetry contract.

## Contract surfaces

- `src/lib/types/hot-deck.ts` defines `HotDeckState`, `HotDeckId`, `DeckFrameRequest`, `DeckSwitchResult`.
- `src/lib/runtime/decks/hotDeck.ts` owns pure readiness transitions, one/two deck render selection, release-aware leases, and switch telemetry classification.
- `src/lib/runtime/media/types.ts` defines source-owned media runtime and decode-session boundaries so cache/session resources do not live in serializable UI stores.
- WebGPU and TimeShaper implementations are separate lanes; this document only reserves the contracts needed by the hot deck manager to classify backend and switch readiness.
