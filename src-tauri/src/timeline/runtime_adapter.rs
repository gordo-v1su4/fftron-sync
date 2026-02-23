use super::compiler::compile_bundle;
use super::types::{CompiledTimeline, EngineCueMarker, TheatreExportBundle};

#[derive(Default)]
pub struct TimelineRuntimeAdapter {
    compiled: Option<CompiledTimeline>,
    active_section: Option<String>,
}

impl TimelineRuntimeAdapter {
    pub fn import_bundle(&mut self, bundle: TheatreExportBundle) -> usize {
        let compiled = compile_bundle(bundle);
        let marker_count = compiled.markers.len();
        self.active_section = compiled.sections.first().cloned();
        self.compiled = Some(compiled);
        marker_count
    }

    pub fn activate_section(&mut self, section: String) -> usize {
        self.active_section = Some(section.clone());
        self.list_markers(Some(section)).len()
    }

    pub fn list_markers(&self, section: Option<String>) -> Vec<EngineCueMarker> {
        let Some(compiled) = &self.compiled else {
            return Vec::new();
        };

        let selected = section.or_else(|| self.active_section.clone());
        match selected {
            Some(section_name) => compiled
                .markers
                .iter()
                .filter(|marker| marker.section == section_name)
                .cloned()
                .collect(),
            None => compiled.markers.clone(),
        }
    }

    pub fn sections(&self) -> Vec<String> {
        self.compiled
            .as_ref()
            .map(|compiled| compiled.sections.clone())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::timeline::types::{CueAction, EngineCueMarker, EngineEnvelopeTemplate, EngineSequence, QuantizeGrid, TheatreExportBundle};

    fn fixture_bundle() -> TheatreExportBundle {
        TheatreExportBundle {
            version: "1.0.0".to_string(),
            fps: 60,
            sequences: vec![EngineSequence {
                id: "s1".to_string(),
                name: "Main".to_string(),
                section: "verse-a".to_string(),
            }],
            cue_markers: vec![
                EngineCueMarker {
                    id: "m1".to_string(),
                    section: "verse-a".to_string(),
                    bar: 1,
                    beat: 1,
                    quantize: QuantizeGrid::Whole,
                    action: CueAction::TriggerClip,
                    payload: serde_json::json!({}),
                },
                EngineCueMarker {
                    id: "m2".to_string(),
                    section: "chorus-a".to_string(),
                    bar: 2,
                    beat: 1,
                    quantize: QuantizeGrid::Whole,
                    action: CueAction::ApplyAccent,
                    payload: serde_json::json!({}),
                },
            ],
            envelope_templates: vec![EngineEnvelopeTemplate {
                id: "e1".to_string(),
                name: "Pulse".to_string(),
                attack_ms: 1,
                decay_ms: 1,
                sustain: 0.7,
                release_ms: 1,
                curve_in: "linear".to_string(),
                curve_out: "linear".to_string(),
            }],
        }
    }

    #[test]
    fn section_activation_filters_markers() {
        let mut adapter = TimelineRuntimeAdapter::default();
        adapter.import_bundle(fixture_bundle());

        let count = adapter.activate_section("chorus-a".to_string());
        let markers = adapter.list_markers(None);

        assert_eq!(count, 1);
        assert_eq!(markers.len(), 1);
        assert_eq!(markers[0].id, "m2");
    }
}
