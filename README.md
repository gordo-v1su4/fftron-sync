# FFTRON Sync

**Reactive Auto-Editor Console.** A desktop-first live performance and synchronization engine featuring Rust clock authority, a reactive clip matrix, and quantized execution.

## 🚀 Overview

FFTRON Sync is designed for precision media playback and synchronization. Built as a desktop application using the [Tauri](https://tauri.app/) framework, it leverages a robust Rust backend for timing and scheduling, paired with a blazing-fast [Svelte 5](https://svelte.dev/) (via SvelteKit) frontend for the reactive user interface.

### Key Features
- **Authoritative Rust Clock**: Reliable timing engine with tempo control, BPM nudging, tap tempo, and downbeat resynchronization.
- **Quantized Scheduler**: Grid-based scheduling of cue actions to ensure frame-perfect transitions and media triggering.
- **Media Runtime**: Connects with decode and renderer backends for audio and video playback, fully synchronized to the internal tempo.
- **Timeline & Sections**: Load, validate, and navigate "Theatre Bundles", allowing for complex timeline markers, cues, and sequence navigation.
- **Modern UI Workspace**: Organized sidebars and panels for Transport Control, Audio Reactivity, and Video Decks.

---

## 🏗️ Project Structure

The repository is a monorepo containing both the frontend application and the native Rust backend.

### `src/` (Frontend)
Powered by SvelteKit, Vite, and TypeScript.
- **`src/routes/`**: Contains the routing logic. The main workspace sits at `+page.svelte`.
- **`src/lib/`**: Core frontend modules.
  - **`audio/`**: Audio reaction and processing UI components.
  - **`video/`**: Video deck and rendering UI panels.
  - **`engine/`**: Transport controls for playback, tempo, and scheduling.
  - **`timeline/`**: Timeline visualization and marker management.
  - **`stores/`**: Svelte stores for global app state (likely tracking Rust backend state).
  - **`services/`**: Integration layers to communicate with the Rust backend or external APIs.
  - **`tauri/`**: Tauri IPC command invocations.
  - **`types/`**: TypeScript type definitions (e.g., `engine.ts`, `timeline.ts`) shared across the app.

### `src-tauri/` (Backend / Native App)
Powered by Tauri and Rust.
- **`src/main.rs`**: Application entry point defining Tauri commands exposed to the frontend (e.g., `set_bpm`, `queue_preview_action`, `import_theatre_bundle`).
- **`src/engine/`**: The heartbeat of the application. Contains the `TempoEngine`, `QuantizedScheduler`, and `MediaRuntime`.
- **`src/timeline/`**: Handles loading, parsing, and validating theatre bundles and managing timeline cues/markers.

---

## 🛠️ Tech Stack

- **Frontend**: [Svelte 5](https://svelte.dev/) / [SvelteKit](https://kit.svelte.dev/)
- **Bundler**: [Vite](https://vitejs.dev/)
- **Language**: [TypeScript](https://www.typescriptlang.org/) (Frontend) / [Rust](https://www.rust-lang.org/) (Backend)
- **Desktop Framework**: [Tauri v2](https://tauri.app/)
- **Package Manager**: [Bun](https://bun.sh/)
- **Testing**: [Vitest](https://vitest.dev/)

---

## 💻 Development Setup

### Prerequisites
Make sure you have the following installed:
- [Bun](https://bun.sh/)
- [Rust & Cargo](https://rustup.rs/) (including Tauri dependencies for your OS)

### Installation
1. Clone the repository and install dependencies:
   ```bash
   bun install
   ```

### Commands
The following scripts are specified in `package.json`:

- **Run Dev Server (Web only)**:
  ```bash
  bun run dev
  ```
- **Run Desktop App (Tauri Dev)**:
  *This builds the Rust backend and opens the native application window.*
  ```bash
  bun run tauri:dev
  ```
- **Build Web Assets**:
  ```bash
  bun run build
  ```
- **Build Desktop App (Production Release)**:
  ```bash
  bun run tauri:build
  ```
- **Check TypeScript/Svelte Types**:
  ```bash
  bun run check
  ```
- **Run Unit Tests**:
  ```bash
  bun run test
  ```

---

## 📝 License

*(Add License Information Here)*
