use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TempoSource {
    Manual,
    Tap,
    Link,
    MidiClock,
    Auto,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TempoState {
    pub bpm: f64,
    pub confidence: f64,
    pub downbeat_epoch_ms: u64,
    pub source: TempoSource,
    pub tap_count: usize,
}

#[derive(Debug, Clone)]
pub struct TempoEngine {
    state: TempoState,
    taps: Vec<u64>,
}

impl Default for TempoEngine {
    fn default() -> Self {
        Self {
            state: TempoState {
                bpm: 120.0,
                confidence: 1.0,
                downbeat_epoch_ms: now_ms(),
                source: TempoSource::Manual,
                tap_count: 0,
            },
            taps: Vec::new(),
        }
    }
}

impl TempoEngine {
    pub fn state(&self) -> TempoState {
        self.state.clone()
    }

    pub fn set_bpm(&mut self, bpm: f64) -> TempoState {
        self.state.bpm = clamp_bpm(bpm);
        self.state.confidence = 1.0;
        self.state.source = TempoSource::Manual;
        self.state.tap_count = 0;
        self.taps.clear();
        self.state.clone()
    }

    pub fn nudge_bpm(&mut self, delta: f64) -> TempoState {
        self.state.bpm = clamp_bpm(self.state.bpm + delta);
        self.state.source = TempoSource::Manual;
        self.state.clone()
    }

    pub fn resync_downbeat(&mut self, timestamp_ms: Option<u64>) -> TempoState {
        self.state.downbeat_epoch_ms = timestamp_ms.unwrap_or_else(now_ms);
        self.state.clone()
    }

    pub fn tap_bpm(&mut self, timestamp_ms: Option<u64>) -> TempoState {
        let tap = timestamp_ms.unwrap_or_else(now_ms);
        self.taps.push(tap);

        if self.taps.len() > 8 {
            let keep_from = self.taps.len() - 8;
            self.taps.drain(0..keep_from);
        }

        let intervals = self
            .taps
            .windows(2)
            .map(|pair| pair[1].saturating_sub(pair[0]))
            .filter(|interval| (80..=3000).contains(interval))
            .collect::<Vec<_>>();

        if intervals.is_empty() {
            self.state.tap_count = self.taps.len();
            return self.state.clone();
        }

        let median_interval = median_ms(&intervals);
        let tapped_bpm = 60_000.0 / median_interval as f64;
        let confidence = tap_confidence(&intervals);

        self.state.bpm = clamp_bpm(tapped_bpm);
        self.state.confidence = confidence;
        self.state.source = TempoSource::Tap;
        self.state.tap_count = self.taps.len();
        self.state.downbeat_epoch_ms = tap;
        self.state.clone()
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn clamp_bpm(bpm: f64) -> f64 {
    bpm.clamp(20.0, 300.0)
}

fn median_ms(values: &[u64]) -> u64 {
    let mut sorted = values.to_vec();
    sorted.sort_unstable();

    let mid = sorted.len() / 2;
    if sorted.len() % 2 == 0 {
        (sorted[mid - 1] + sorted[mid]) / 2
    } else {
        sorted[mid]
    }
}

fn tap_confidence(intervals: &[u64]) -> f64 {
    if intervals.len() == 1 {
        return 0.35;
    }

    let mean = intervals.iter().map(|v| *v as f64).sum::<f64>() / intervals.len() as f64;
    if mean <= f64::EPSILON {
        return 0.2;
    }

    let variance = intervals
        .iter()
        .map(|value| {
            let diff = *value as f64 - mean;
            diff * diff
        })
        .sum::<f64>()
        / intervals.len() as f64;

    let std_dev = variance.sqrt();
    let coefficient_of_variation = std_dev / mean;

    let consistency = 1.0 - coefficient_of_variation;
    let sample_weight = (intervals.len() as f64 / 6.0).clamp(0.4, 1.0);

    (consistency * sample_weight).clamp(0.2, 0.99)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cmp::Ordering;

    #[test]
    fn tapping_updates_bpm_and_source() {
        let mut tempo = TempoEngine::default();
        tempo.tap_bpm(Some(1_000));
        let state = tempo.tap_bpm(Some(1_500));

        assert_eq!(state.source, TempoSource::Tap);
        assert!(state.bpm > 110.0 && state.bpm < 130.0);
        assert_eq!(state.tap_count, 2);
    }

    #[test]
    fn nudge_is_clamped() {
        let mut tempo = TempoEngine::default();
        tempo.set_bpm(290.0);
        let state = tempo.nudge_bpm(100.0);
        assert_eq!(state.bpm, 300.0);
    }

    #[test]
    fn median_supports_even_and_odd_inputs() {
        assert_eq!(median_ms(&[400, 500, 600]), 500);
        assert_eq!(median_ms(&[400, 500, 600, 700]), 550);
    }

    #[test]
    fn confidence_improves_for_consistent_taps() {
        let consistent = tap_confidence(&[500, 500, 500, 500]);
        let jittery = tap_confidence(&[400, 540, 450, 610]);

        assert_eq!(consistent.partial_cmp(&jittery), Some(Ordering::Greater));
    }
}
