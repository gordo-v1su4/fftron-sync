use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

use crate::timeline::types::QuantizeGrid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledAction {
    pub id: u64,
    pub action: String,
    pub section: Option<String>,
    pub quantize: QuantizeGrid,
    pub execute_at_ms: u64,
}

#[derive(Debug, Clone)]
pub struct QuantizedScheduler {
    grid: QuantizeGrid,
    look_ahead_ms: u64,
    jitter_budget_ms: u64,
    next_id: u64,
    queue: VecDeque<ScheduledAction>,
}

impl Default for QuantizedScheduler {
    fn default() -> Self {
        Self {
            grid: QuantizeGrid::Quarter,
            look_ahead_ms: 100,
            jitter_budget_ms: 5,
            next_id: 1,
            queue: VecDeque::new(),
        }
    }
}

impl QuantizedScheduler {
    pub fn set_grid(&mut self, grid: QuantizeGrid) -> QuantizeGrid {
        self.grid = grid.clone();
        grid
    }

    pub fn schedule(
        &mut self,
        now_ms: u64,
        bpm: f64,
        downbeat_epoch_ms: u64,
        quantize: Option<QuantizeGrid>,
        action: String,
        section: Option<String>,
    ) -> ScheduledAction {
        let quantize_value = quantize.unwrap_or_else(|| self.grid.clone());
        let execute_at_ms = quantize_next_boundary(now_ms + self.look_ahead_ms, bpm, downbeat_epoch_ms, &quantize_value);

        let scheduled = ScheduledAction {
            id: self.next_id,
            action,
            section,
            quantize: quantize_value,
            execute_at_ms,
        };
        self.next_id += 1;
        self.queue.push_back(scheduled.clone());
        scheduled
    }

    pub fn list(&self) -> Vec<ScheduledAction> {
        self.queue.iter().cloned().collect()
    }

    pub fn pop_due(&mut self, now_ms: u64) -> Vec<ScheduledAction> {
        let mut due = Vec::new();
        while self
            .queue
            .front()
            .is_some_and(|action| action.execute_at_ms <= now_ms + self.jitter_budget_ms)
        {
            if let Some(action) = self.queue.pop_front() {
                due.push(action);
            }
        }
        due
    }
}

pub fn quantize_next_boundary(now_ms: u64, bpm: f64, downbeat_epoch_ms: u64, grid: &QuantizeGrid) -> u64 {
    let safe_bpm = bpm.clamp(20.0, 300.0);
    let beat_ms = 60_000.0 / safe_bpm;
    let slot_beats = match grid {
        QuantizeGrid::Whole => 4.0,
        QuantizeGrid::Half => 2.0,
        QuantizeGrid::Quarter => 1.0,
        QuantizeGrid::Eighth => 0.5,
        QuantizeGrid::Sixteenth => 0.25,
    };
    let slot_ms = beat_ms * slot_beats;

    if now_ms <= downbeat_epoch_ms {
        return downbeat_epoch_ms;
    }

    let elapsed = now_ms - downbeat_epoch_ms;
    let slots = (elapsed as f64 / slot_ms).ceil();
    downbeat_epoch_ms + (slots * slot_ms).round() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quantize_to_next_quarter_note_boundary() {
        let now = 1_010;
        let downbeat = 1_000;
        let bpm = 120.0;

        let boundary = quantize_next_boundary(now, bpm, downbeat, &QuantizeGrid::Quarter);
        assert_eq!(boundary, 1_500);
    }

    #[test]
    fn scheduler_queues_and_releases_due_actions() {
        let mut scheduler = QuantizedScheduler::default();
        let action = scheduler.schedule(
            1_000,
            120.0,
            1_000,
            Some(QuantizeGrid::Quarter),
            "trigger_clip".into(),
            Some("verse-a".into()),
        );

        assert_eq!(scheduler.list().len(), 1);
        let due = scheduler.pop_due(action.execute_at_ms);
        assert_eq!(due.len(), 1);
        assert_eq!(scheduler.list().len(), 0);
    }
}
