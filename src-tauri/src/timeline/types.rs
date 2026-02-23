use serde::{Deserialize, Serialize};
use serde_json::Value;

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TimelineAuthority {
    RustClock,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TheatreUsage {
    AuthoringOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum QuantizeGrid {
    #[serde(rename = "1n")]
    Whole,
    #[serde(rename = "1/2n")]
    Half,
    #[serde(rename = "1/4n")]
    Quarter,
    #[serde(rename = "1/8n")]
    Eighth,
    #[serde(rename = "1/16n")]
    Sixteenth,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CueAction {
    TriggerClip,
    ApplyAccent,
    SwapScene,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EngineSequence {
    pub id: String,
    pub name: String,
    pub section: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EngineCueMarker {
    pub id: String,
    pub section: String,
    pub bar: u32,
    pub beat: u32,
    pub quantize: QuantizeGrid,
    pub action: CueAction,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EngineEnvelopeTemplate {
    pub id: String,
    pub name: String,
    pub attack_ms: u32,
    pub decay_ms: u32,
    pub sustain: f32,
    pub release_ms: u32,
    pub curve_in: String,
    pub curve_out: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TheatreExportBundle {
    pub version: String,
    pub fps: u32,
    pub sequences: Vec<EngineSequence>,
    pub cue_markers: Vec<EngineCueMarker>,
    pub envelope_templates: Vec<EngineEnvelopeTemplate>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CompiledTimeline {
    pub version: String,
    pub fps: u32,
    pub sections: Vec<String>,
    pub markers: Vec<EngineCueMarker>,
    pub envelopes: Vec<EngineEnvelopeTemplate>,
}
