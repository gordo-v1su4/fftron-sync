use std::collections::BTreeSet;

use super::types::{CompiledTimeline, TheatreExportBundle};

pub fn compile_bundle(bundle: TheatreExportBundle) -> CompiledTimeline {
    let mut markers = bundle.cue_markers;
    markers.sort_by_key(|marker| (marker.bar, marker.beat));

    let sections = markers
        .iter()
        .map(|marker| marker.section.clone())
        .chain(bundle.sequences.iter().map(|sequence| sequence.section.clone()))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();

    CompiledTimeline {
        version: bundle.version,
        fps: bundle.fps,
        sections,
        markers,
        envelopes: bundle.envelope_templates,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::timeline::types::{CueAction, EngineCueMarker, EngineEnvelopeTemplate, EngineSequence, QuantizeGrid, TheatreExportBundle};

    #[test]
    fn compile_bundle_sorts_markers_and_collects_sections() {
        let bundle = TheatreExportBundle {
            version: "1.0.0".to_string(),
            fps: 60,
            sequences: vec![EngineSequence {
                id: "seq-1".to_string(),
                name: "Main".to_string(),
                section: "chorus-a".to_string(),
            }],
            cue_markers: vec![
                EngineCueMarker {
                    id: "m2".to_string(),
                    section: "verse-a".to_string(),
                    bar: 2,
                    beat: 1,
                    quantize: QuantizeGrid::Whole,
                    action: CueAction::TriggerClip,
                    payload: serde_json::json!({}),
                },
                EngineCueMarker {
                    id: "m1".to_string(),
                    section: "chorus-a".to_string(),
                    bar: 1,
                    beat: 1,
                    quantize: QuantizeGrid::Whole,
                    action: CueAction::SwapScene,
                    payload: serde_json::json!({}),
                },
            ],
            envelope_templates: vec![EngineEnvelopeTemplate {
                id: "env-1".to_string(),
                name: "Pulse".to_string(),
                attack_ms: 10,
                decay_ms: 20,
                sustain: 0.5,
                release_ms: 30,
                curve_in: "sine_in".to_string(),
                curve_out: "sine_out".to_string(),
            }],
        };

        let compiled = compile_bundle(bundle);
        assert_eq!(compiled.markers[0].id, "m1");
        assert_eq!(compiled.sections, vec!["chorus-a".to_string(), "verse-a".to_string()]);
    }
}
