use crate::source_config;
use std::collections::{HashMap, HashSet};

pub(crate) const AUTO_REFRESH_SETTING_KEY: &str = "refresh.auto_interval_seconds";
pub(crate) const DEFAULT_AUTO_REFRESH_SECONDS: u64 = 60 * 60;
pub(crate) const MAX_BACKGROUND_REFRESHES: usize = 2;

const BASE_BACKOFF_SECONDS: i64 = 60;
const MAX_BACKOFF_SECONDS: i64 = 6 * 60 * 60;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct SourceKey {
    pub(crate) source_kind: String,
    pub(crate) source_config_json: String,
}

impl SourceKey {
    pub(crate) fn new(
        source_kind: impl Into<String>,
        source_config_json: impl Into<String>,
    ) -> Result<Self, String> {
        let source_kind = source_kind.into();
        let source_config_json = source_config::canonicalize(&source_config_json.into())?;
        Ok(Self {
            source_kind,
            source_config_json,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum RefreshPriority {
    Auto,
    Manual,
}

#[derive(Debug, Clone)]
struct SourceSchedule {
    auto_interval_seconds: Option<u64>,
    next_due_at: Option<i64>,
    running: bool,
    failure_count: u32,
    blocked_until: Option<i64>,
}

impl SourceSchedule {
    fn new(now: i64, auto_interval_seconds: Option<u64>) -> Self {
        Self {
            auto_interval_seconds,
            next_due_at: auto_interval_seconds.map(|seconds| add_seconds(now, seconds)),
            running: false,
            failure_count: 0,
            blocked_until: None,
        }
    }

    fn restored(
        now: i64,
        auto_interval_seconds: Option<u64>,
        last_success: Option<i64>,
        failure_count: u32,
        blocked_until: Option<i64>,
    ) -> Self {
        let next_due_at = auto_interval_seconds.map(|seconds| {
            if let Some(blocked) = blocked_until.filter(|blocked| *blocked > now) {
                blocked
            } else if let Some(success) = last_success {
                add_seconds(success, seconds)
            } else {
                now
            }
        });
        Self {
            auto_interval_seconds,
            next_due_at,
            running: false,
            failure_count,
            blocked_until,
        }
    }
}

#[derive(Debug, Clone)]
struct PendingRequest {
    key: SourceKey,
    priority: RefreshPriority,
    sequence: u64,
}

#[derive(Debug)]
pub(crate) struct Scheduler {
    max_concurrent: usize,
    running_count: usize,
    sources: HashMap<SourceKey, SourceSchedule>,
    pending: Vec<PendingRequest>,
    next_sequence: u64,
}

impl Scheduler {
    pub(crate) fn new(max_concurrent: usize) -> Self {
        assert!(max_concurrent > 0, "scheduler concurrency must be positive");
        Self {
            max_concurrent,
            running_count: 0,
            sources: HashMap::new(),
            pending: Vec::new(),
            next_sequence: 0,
        }
    }

    pub(crate) fn sync_source(
        &mut self,
        key: SourceKey,
        now: i64,
        auto_interval_seconds: Option<u64>,
    ) {
        let interval_changed = self
            .sources
            .get(&key)
            .is_some_and(|state| state.auto_interval_seconds != auto_interval_seconds);

        if interval_changed {
            self.pending.retain(|request| {
                request.key != key || request.priority == RefreshPriority::Manual
            });
        }

        match self.sources.get_mut(&key) {
            Some(state) if state.auto_interval_seconds != auto_interval_seconds => {
                state.auto_interval_seconds = auto_interval_seconds;
                state.next_due_at = auto_interval_seconds.map(|seconds| add_seconds(now, seconds));
            }
            Some(_) => {}
            None => {
                self.sources
                    .insert(key, SourceSchedule::new(now, auto_interval_seconds));
            }
        }
    }

    pub(crate) fn sync_source_with_persisted_state(
        &mut self,
        key: SourceKey,
        now: i64,
        auto_interval_seconds: Option<u64>,
        last_success: Option<i64>,
        failure_count: u32,
        blocked_until: Option<i64>,
    ) {
        if self.sources.contains_key(&key) {
            self.sync_source(key, now, auto_interval_seconds);
            return;
        }

        self.sources.insert(
            key,
            SourceSchedule::restored(
                now,
                auto_interval_seconds,
                last_success,
                failure_count,
                blocked_until,
            ),
        );
    }

    pub(crate) fn disable_missing_sources(&mut self, active: &HashSet<SourceKey>) {
        self.pending.retain(|request| active.contains(&request.key));
        for (key, state) in &mut self.sources {
            if !active.contains(key) {
                state.auto_interval_seconds = None;
                state.next_due_at = None;
            }
        }
    }

    pub(crate) fn mark_due(&mut self, now: i64) {
        let due_keys: Vec<SourceKey> = self
            .sources
            .iter()
            .filter_map(|(key, state)| {
                let due = state.auto_interval_seconds.is_some()
                    && !state.running
                    && state.next_due_at.is_some_and(|deadline| deadline <= now);
                due.then(|| key.clone())
            })
            .collect();

        for key in due_keys {
            self.enqueue(key, RefreshPriority::Auto);
        }
    }

    pub(crate) fn request_manual(&mut self, key: SourceKey, now: i64) {
        self.sources
            .entry(key.clone())
            .or_insert_with(|| SourceSchedule::new(now, None));
        self.enqueue(key, RefreshPriority::Manual);
    }

    pub(crate) fn pop_ready(&mut self, now: i64) -> Option<SourceKey> {
        if self.running_count >= self.max_concurrent {
            return None;
        }

        let mut best_index: Option<usize> = None;
        for (index, request) in self.pending.iter().enumerate() {
            let Some(state) = self.sources.get(&request.key) else {
                continue;
            };
            let blocked = state.blocked_until.is_some_and(|until| until > now);
            if state.running || blocked {
                continue;
            }

            match best_index {
                None => best_index = Some(index),
                Some(current) => {
                    let incumbent = &self.pending[current];
                    let better_priority = request.priority > incumbent.priority;
                    let same_priority_earlier = request.priority == incumbent.priority
                        && request.sequence < incumbent.sequence;
                    if better_priority || same_priority_earlier {
                        best_index = Some(index);
                    }
                }
            }
        }

        let request = self.pending.remove(best_index?);
        let state = self.sources.get_mut(&request.key)?;
        state.running = true;
        self.running_count += 1;
        Some(request.key)
    }

    pub(crate) fn next_wakeup_at(&self, now: i64) -> Option<i64> {
        if self.running_count >= self.max_concurrent {
            return None;
        }

        let pending_deadline = self.pending.iter().filter_map(|request| {
            let state = self.sources.get(&request.key)?;
            if state.running {
                return None;
            }
            Some(
                state
                    .blocked_until
                    .filter(|blocked| *blocked > now)
                    .unwrap_or(now),
            )
        });

        let automatic_deadline = self.sources.values().filter_map(|state| {
            if state.running || state.auto_interval_seconds.is_none() {
                return None;
            }
            state.next_due_at
        });

        pending_deadline.chain(automatic_deadline).min()
    }

    pub(crate) fn complete_success(&mut self, key: &SourceKey, now: i64) {
        let Some(state) = self.sources.get_mut(key) else {
            return;
        };
        if state.running {
            state.running = false;
            self.running_count = self.running_count.saturating_sub(1);
        }
        state.failure_count = 0;
        state.blocked_until = None;
        state.next_due_at = state
            .auto_interval_seconds
            .map(|seconds| add_seconds(now, seconds));
    }

    pub(crate) fn complete_failure_with_retry_floor(
        &mut self,
        key: &SourceKey,
        now: i64,
        retry_floor_seconds: Option<u64>,
    ) {
        let Some(state) = self.sources.get_mut(key) else {
            return;
        };
        if state.running {
            state.running = false;
            self.running_count = self.running_count.saturating_sub(1);
        }
        state.failure_count = state.failure_count.saturating_add(1);
        let retry_floor = retry_floor_seconds
            .map(|seconds| i64::try_from(seconds).unwrap_or(i64::MAX))
            .unwrap_or(0);
        let delay = backoff_seconds(state.failure_count).max(retry_floor);
        let retry_at = now.saturating_add(delay);
        state.blocked_until = Some(retry_at);
        state.next_due_at = state.auto_interval_seconds.map(|_| retry_at);
    }

    pub(crate) fn failure_state(&self, key: &SourceKey) -> Option<(u32, Option<i64>)> {
        self.sources
            .get(key)
            .map(|state| (state.failure_count, state.blocked_until))
    }

    #[cfg(test)]
    fn queued_count(&self) -> usize {
        self.pending.len()
    }

    #[cfg(test)]
    fn running_count(&self) -> usize {
        self.running_count
    }

    #[cfg(test)]
    fn blocked_until(&self, key: &SourceKey) -> Option<i64> {
        self.sources.get(key).and_then(|state| state.blocked_until)
    }

    fn enqueue(&mut self, key: SourceKey, priority: RefreshPriority) {
        if let Some(existing) = self.pending.iter_mut().find(|request| request.key == key) {
            if priority > existing.priority {
                existing.priority = priority;
            }
            return;
        }

        let sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.wrapping_add(1);
        self.pending.push(PendingRequest {
            key,
            priority,
            sequence,
        });
    }
}

fn add_seconds(now: i64, seconds: u64) -> i64 {
    now.saturating_add(i64::try_from(seconds).unwrap_or(i64::MAX))
}

fn backoff_seconds(failure_count: u32) -> i64 {
    let shift = failure_count.saturating_sub(1).min(16);
    BASE_BACKOFF_SECONDS
        .saturating_mul(1_i64 << shift)
        .min(MAX_BACKOFF_SECONDS)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(name: &str) -> SourceKey {
        SourceKey::new(name, "{}").expect("test source config should canonicalize")
    }

    #[test]
    fn source_keys_collapse_equivalent_json_objects() {
        let first = SourceKey::new("arxiv", r#"{"query":"graph","max":10}"#)
            .expect("first source config should canonicalize");
        let second = SourceKey::new("arxiv", r#"{ "max": 10, "query": "graph" }"#)
            .expect("second source config should canonicalize");
        assert_eq!(first, second);
        assert_eq!(first.source_config_json, r#"{"max":10,"query":"graph"}"#);
    }

    #[test]
    fn automatic_refresh_is_soft_deadline_driven() {
        let mut scheduler = Scheduler::new(2);
        let source = key("arxiv");
        scheduler.sync_source(source.clone(), 100, Some(60));

        scheduler.mark_due(159);
        assert_eq!(scheduler.queued_count(), 0);
        scheduler.mark_due(160);
        assert_eq!(scheduler.queued_count(), 1);
        assert_eq!(scheduler.pop_ready(160), Some(source.clone()));

        scheduler.complete_success(&source, 165);
        scheduler.mark_due(224);
        assert_eq!(scheduler.queued_count(), 0);
        scheduler.mark_due(225);
        assert_eq!(scheduler.queued_count(), 1);
    }

    #[test]
    fn restored_never_refreshed_source_is_due_immediately_after_startup() {
        let mut scheduler = Scheduler::new(1);
        let source = key("arxiv");
        scheduler.sync_source_with_persisted_state(
            source.clone(),
            100,
            Some(86_400),
            None,
            0,
            None,
        );
        scheduler.mark_due(100);
        assert_eq!(scheduler.pop_ready(100), Some(source));
    }

    #[test]
    fn restored_success_uses_persisted_deadline() {
        let mut scheduler = Scheduler::new(1);
        let source = key("arxiv");
        scheduler.sync_source_with_persisted_state(
            source.clone(),
            100,
            Some(60),
            Some(80),
            0,
            None,
        );
        scheduler.mark_due(139);
        assert_eq!(scheduler.pop_ready(139), None);
        scheduler.mark_due(140);
        assert_eq!(scheduler.pop_ready(140), Some(source));
    }

    #[test]
    fn restored_blocked_source_honors_persisted_deadline() {
        let mut scheduler = Scheduler::new(1);
        let source = key("qiita");
        scheduler.sync_source_with_persisted_state(
            source.clone(),
            100,
            Some(60),
            Some(80),
            1,
            Some(500),
        );
        scheduler.mark_due(499);
        assert_eq!(scheduler.pop_ready(499), None);
        scheduler.mark_due(500);
        assert_eq!(scheduler.pop_ready(500), Some(source));
    }

    #[test]
    fn off_disables_auto_but_manual_refresh_still_runs() {
        let mut scheduler = Scheduler::new(1);
        let source = key("wikipedia");
        scheduler.sync_source(source.clone(), 0, None);
        scheduler.mark_due(1_000_000);
        assert_eq!(scheduler.queued_count(), 0);

        scheduler.request_manual(source.clone(), 1_000_000);
        assert_eq!(scheduler.pop_ready(1_000_000), Some(source));
    }

    #[test]
    fn turning_auto_off_cancels_queued_auto_but_preserves_manual() {
        let mut scheduler = Scheduler::new(1);
        let source = key("youtube");
        scheduler.sync_source(source.clone(), 0, Some(10));
        scheduler.mark_due(10);
        assert_eq!(scheduler.queued_count(), 1);

        scheduler.sync_source(source.clone(), 10, None);
        assert_eq!(scheduler.queued_count(), 0);
        assert_eq!(scheduler.pop_ready(10), None);

        scheduler.request_manual(source.clone(), 11);
        scheduler.sync_source(source.clone(), 11, Some(60));
        assert_eq!(scheduler.queued_count(), 1);
        assert_eq!(scheduler.pop_ready(11), Some(source));
    }

    #[test]
    fn missing_source_is_disabled_without_releasing_running_slot_early() {
        let mut scheduler = Scheduler::new(1);
        let source = key("arxiv");
        scheduler.request_manual(source.clone(), 0);
        assert_eq!(scheduler.pop_ready(0), Some(source.clone()));

        scheduler.disable_missing_sources(&HashSet::new());
        assert_eq!(scheduler.running_count(), 1);
        scheduler.complete_success(&source, 1);
        assert_eq!(scheduler.running_count(), 0);
        scheduler.mark_due(1_000_000);
        assert_eq!(scheduler.pop_ready(1_000_000), None);
    }

    #[test]
    fn duplicate_requests_collapse_and_manual_upgrades_priority() {
        let mut scheduler = Scheduler::new(1);
        let first = key("youtube");
        let second = key("arxiv");
        scheduler.sync_source(first.clone(), 0, Some(10));
        scheduler.sync_source(second.clone(), 0, Some(10));
        scheduler.mark_due(10);
        assert_eq!(scheduler.queued_count(), 2);

        scheduler.request_manual(second.clone(), 10);
        assert_eq!(scheduler.queued_count(), 2);
        assert_eq!(scheduler.pop_ready(10), Some(second));
    }

    #[test]
    fn concurrency_is_bounded() {
        let mut scheduler = Scheduler::new(2);
        for name in ["a", "b", "c"] {
            scheduler.request_manual(key(name), 0);
        }

        let first = scheduler.pop_ready(0).expect("first should start");
        let second = scheduler.pop_ready(0).expect("second should start");
        assert_ne!(first, second);
        assert_eq!(scheduler.running_count(), 2);
        assert_eq!(scheduler.pop_ready(0), None);

        scheduler.complete_success(&first, 1);
        assert!(scheduler.pop_ready(1).is_some());
    }

    #[test]
    fn blocked_pending_request_exposes_next_wakeup_deadline() {
        let mut scheduler = Scheduler::new(1);
        let source = key("example");
        scheduler.request_manual(source.clone(), 0);
        assert_eq!(scheduler.pop_ready(0), Some(source.clone()));
        scheduler.complete_failure_with_retry_floor(&source, 10, None);
        scheduler.request_manual(source, 11);
        assert_eq!(scheduler.next_wakeup_at(11), Some(70));
    }

    #[test]
    fn failure_uses_exponential_backoff_without_tight_retry() {
        let mut scheduler = Scheduler::new(1);
        let source = key("example");
        scheduler.sync_source(source.clone(), 0, Some(300));
        scheduler.request_manual(source.clone(), 0);
        assert_eq!(scheduler.pop_ready(0), Some(source.clone()));
        scheduler.complete_failure_with_retry_floor(&source, 10, None);
        assert_eq!(scheduler.blocked_until(&source), Some(70));

        scheduler.request_manual(source.clone(), 11);
        assert_eq!(scheduler.pop_ready(69), None);
        assert_eq!(scheduler.pop_ready(70), Some(source.clone()));
        scheduler.complete_failure_with_retry_floor(&source, 70, None);
        assert_eq!(scheduler.blocked_until(&source), Some(190));
    }

    #[test]
    fn retry_floor_extends_but_never_shortens_backoff() {
        let mut scheduler = Scheduler::new(1);
        let source = key("qiita");
        scheduler.request_manual(source.clone(), 0);
        assert_eq!(scheduler.pop_ready(0), Some(source.clone()));
        scheduler.complete_failure_with_retry_floor(&source, 10, Some(900));
        assert_eq!(scheduler.blocked_until(&source), Some(910));

        scheduler.request_manual(source.clone(), 11);
        assert_eq!(scheduler.pop_ready(909), None);
        assert_eq!(scheduler.pop_ready(910), Some(source.clone()));
        scheduler.complete_failure_with_retry_floor(&source, 910, Some(30));
        assert_eq!(scheduler.blocked_until(&source), Some(1030));
    }
}
