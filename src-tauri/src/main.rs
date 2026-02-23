#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use engine::media::{DecodeBackend, MediaRuntime, RendererBackend, RuntimeCapabilities};
use engine::scheduler::{QuantizedScheduler, ScheduledAction};
use engine::tempo::{TempoEngine, TempoState};
use tauri::State;
use timeline::runtime_adapter::TimelineRuntimeAdapter;
use timeline::types::{CueAction, EngineCueMarker, QuantizeGrid, TheatreExportBundle};

mod engine;
mod timeline;

struct AppState {
    timeline_runtime: Mutex<TimelineRuntimeAdapter>,
    tempo: Mutex<TempoEngine>,
    scheduler: Mutex<QuantizedScheduler>,
    media_runtime: Mutex<MediaRuntime>,
}

#[tauri::command]
fn validate_theatre_bundle(bundle: TheatreExportBundle) -> Result<bool, String> {
    timeline::validate_bundle(&bundle)
        .map(|_| true)
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn import_theatre_bundle(
    bundle: TheatreExportBundle,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    timeline::validate_bundle(&bundle).map_err(|err| err.to_string())?;
    let mut runtime = state
        .timeline_runtime
        .lock()
        .map_err(|err| err.to_string())?;
    Ok(runtime.import_bundle(bundle))
}

#[tauri::command]
fn activate_timeline_section(section: String, state: State<'_, AppState>) -> Result<usize, String> {
    let mut runtime = state
        .timeline_runtime
        .lock()
        .map_err(|err| err.to_string())?;
    if !runtime.sections().contains(&section) {
        return Err(timeline::TimelineError::UnknownSection(section).to_string());
    }
    Ok(runtime.activate_section(section))
}

#[tauri::command]
fn list_timeline_markers(
    section: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<EngineCueMarker>, String> {
    let runtime = state
        .timeline_runtime
        .lock()
        .map_err(|err| err.to_string())?;
    Ok(runtime.list_markers(section))
}

#[tauri::command]
fn get_tempo_state(state: State<'_, AppState>) -> Result<TempoState, String> {
    let tempo = state.tempo.lock().map_err(|err| err.to_string())?;
    Ok(tempo.state())
}

#[tauri::command]
fn set_bpm(bpm: f64, state: State<'_, AppState>) -> Result<TempoState, String> {
    let mut tempo = state.tempo.lock().map_err(|err| err.to_string())?;
    Ok(tempo.set_bpm(bpm))
}

#[tauri::command]
fn nudge_bpm(delta: f64, state: State<'_, AppState>) -> Result<TempoState, String> {
    let mut tempo = state.tempo.lock().map_err(|err| err.to_string())?;
    Ok(tempo.nudge_bpm(delta))
}

#[tauri::command]
fn tap_bpm(timestamp_ms: Option<u64>, state: State<'_, AppState>) -> Result<TempoState, String> {
    let mut tempo = state.tempo.lock().map_err(|err| err.to_string())?;
    Ok(tempo.tap_bpm(timestamp_ms))
}

#[tauri::command]
fn resync_downbeat(
    timestamp_ms: Option<u64>,
    state: State<'_, AppState>,
) -> Result<TempoState, String> {
    let mut tempo = state.tempo.lock().map_err(|err| err.to_string())?;
    Ok(tempo.resync_downbeat(timestamp_ms))
}

#[tauri::command]
fn set_quantization(grid: QuantizeGrid, state: State<'_, AppState>) -> Result<QuantizeGrid, String> {
    let mut scheduler = state.scheduler.lock().map_err(|err| err.to_string())?;
    Ok(scheduler.set_grid(grid))
}

#[tauri::command]
fn queue_preview_action(
    action: String,
    section: Option<String>,
    quantize: Option<QuantizeGrid>,
    state: State<'_, AppState>,
) -> Result<ScheduledAction, String> {
    let tempo_state = {
        let tempo = state.tempo.lock().map_err(|err| err.to_string())?;
        tempo.state()
    };

    let mut scheduler = state.scheduler.lock().map_err(|err| err.to_string())?;
    Ok(scheduler.schedule(
        now_ms(),
        tempo_state.bpm,
        tempo_state.downbeat_epoch_ms,
        quantize,
        action,
        section,
    ))
}

#[tauri::command]
fn queue_section_markers(
    section: Option<String>,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let markers = {
        let runtime = state
            .timeline_runtime
            .lock()
            .map_err(|err| err.to_string())?;
        runtime.list_markers(section)
    };

    let tempo_state = {
        let tempo = state.tempo.lock().map_err(|err| err.to_string())?;
        tempo.state()
    };

    let mut scheduler = state.scheduler.lock().map_err(|err| err.to_string())?;
    for marker in &markers {
        scheduler.schedule(
            now_ms(),
            tempo_state.bpm,
            tempo_state.downbeat_epoch_ms,
            Some(marker.quantize.clone()),
            cue_action_name(&marker.action),
            Some(marker.section.clone()),
        );
    }

    Ok(markers.len())
}

#[tauri::command]
fn list_scheduled_actions(state: State<'_, AppState>) -> Result<Vec<ScheduledAction>, String> {
    let scheduler = state.scheduler.lock().map_err(|err| err.to_string())?;
    Ok(scheduler.list())
}

#[tauri::command]
fn pop_due_actions(
    timestamp_ms: Option<u64>,
    state: State<'_, AppState>,
) -> Result<Vec<ScheduledAction>, String> {
    let mut scheduler = state.scheduler.lock().map_err(|err| err.to_string())?;
    Ok(scheduler.pop_due(timestamp_ms.unwrap_or_else(now_ms)))
}

#[tauri::command]
fn detect_runtime_capabilities(state: State<'_, AppState>) -> Result<RuntimeCapabilities, String> {
    let mut runtime = state
        .media_runtime
        .lock()
        .map_err(|err| err.to_string())?;
    Ok(runtime.refresh_capabilities())
}

#[tauri::command]
fn set_decode_backend(
    backend: DecodeBackend,
    state: State<'_, AppState>,
) -> Result<RuntimeCapabilities, String> {
    let mut runtime = state
        .media_runtime
        .lock()
        .map_err(|err| err.to_string())?;
    runtime.set_decode(backend).map_err(|err| err.to_string())
}

#[tauri::command]
fn set_renderer_backend(
    backend: RendererBackend,
    state: State<'_, AppState>,
) -> Result<RuntimeCapabilities, String> {
    let mut runtime = state
        .media_runtime
        .lock()
        .map_err(|err| err.to_string())?;
    runtime.set_renderer(backend).map_err(|err| err.to_string())
}

fn cue_action_name(action: &CueAction) -> String {
    match action {
        CueAction::TriggerClip => "trigger_clip".to_string(),
        CueAction::ApplyAccent => "apply_accent".to_string(),
        CueAction::SwapScene => "swap_scene".to_string(),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            timeline_runtime: Mutex::new(TimelineRuntimeAdapter::default()),
            tempo: Mutex::new(TempoEngine::default()),
            scheduler: Mutex::new(QuantizedScheduler::default()),
            media_runtime: Mutex::new(MediaRuntime::default()),
        })
        .invoke_handler(tauri::generate_handler![
            import_theatre_bundle,
            validate_theatre_bundle,
            activate_timeline_section,
            list_timeline_markers,
            get_tempo_state,
            set_bpm,
            nudge_bpm,
            tap_bpm,
            resync_downbeat,
            set_quantization,
            queue_preview_action,
            queue_section_markers,
            list_scheduled_actions,
            pop_due_actions,
            detect_runtime_capabilities,
            set_decode_backend,
            set_renderer_backend
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
