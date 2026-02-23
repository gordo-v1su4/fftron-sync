pub mod compiler;
pub mod runtime_adapter;
pub mod types;

use thiserror::Error;
use types::TheatreExportBundle;

#[derive(Debug, Error)]
pub enum TimelineError {
    #[error("bundle version is required")]
    MissingVersion,
    #[error("fps must be greater than zero")]
    InvalidFps,
    #[error("at least one sequence is required")]
    MissingSequence,
    #[error("cue markers are required")]
    MissingMarkers,
    #[error("marker '{0}' has invalid beat; expected 1..=4")]
    InvalidBeat(String),
    #[error("section '{0}' was not found")]
    UnknownSection(String),
}

pub fn validate_bundle(bundle: &TheatreExportBundle) -> Result<(), TimelineError> {
    if bundle.version.trim().is_empty() {
        return Err(TimelineError::MissingVersion);
    }

    if bundle.fps == 0 {
        return Err(TimelineError::InvalidFps);
    }

    if bundle.sequences.is_empty() {
        return Err(TimelineError::MissingSequence);
    }

    if bundle.cue_markers.is_empty() {
        return Err(TimelineError::MissingMarkers);
    }

    for marker in &bundle.cue_markers {
        if !(1..=4).contains(&marker.beat) {
            return Err(TimelineError::InvalidBeat(marker.id.clone()));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::timeline::types::{CueAction, EngineCueMarker, EngineSequence, QuantizeGrid, TheatreExportBundle};

    #[test]
    fn reject_invalid_beat() {
        let bundle = TheatreExportBundle {
            version: "1.0.0".to_string(),
            fps: 60,
            sequences: vec![EngineSequence {
                id: "s1".to_string(),
                name: "Main".to_string(),
                section: "verse-a".to_string(),
            }],
            cue_markers: vec![EngineCueMarker {
                id: "m1".to_string(),
                section: "verse-a".to_string(),
                bar: 1,
                beat: 9,
                quantize: QuantizeGrid::Whole,
                action: CueAction::TriggerClip,
                payload: serde_json::json!({}),
            }],
            envelope_templates: vec![],
        };

        let error = validate_bundle(&bundle).expect_err("bundle should be invalid");
        assert!(matches!(error, TimelineError::InvalidBeat(_)));
    }
}
