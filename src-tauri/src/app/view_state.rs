use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ViewState {
    Hidden,
    #[default]
    Idle,
    Compact,
    Board,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ViewEvent {
    GlobalToggle,
    ClickIdleOrb,
    OpenCompact,
    OpenBoard,
    Hide,
    ExternalLaunch,
}

impl ViewState {
    pub(crate) fn transition(self, event: ViewEvent) -> Self {
        match event {
            ViewEvent::GlobalToggle => match self {
                Self::Hidden | Self::Idle => Self::Compact,
                Self::Compact | Self::Board => Self::Idle,
            },
            ViewEvent::ClickIdleOrb => match self {
                Self::Idle => Self::Compact,
                other => other,
            },
            ViewEvent::OpenCompact => Self::Compact,
            ViewEvent::OpenBoard => Self::Board,
            ViewEvent::Hide => Self::Hidden,
            ViewEvent::ExternalLaunch => match self {
                Self::Compact => Self::Idle,
                other => other,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ViewEvent, ViewState};

    #[test]
    fn global_toggle_opens_compact_from_hidden_or_idle() {
        assert_eq!(
            ViewState::Hidden.transition(ViewEvent::GlobalToggle),
            ViewState::Compact
        );
        assert_eq!(
            ViewState::Idle.transition(ViewEvent::GlobalToggle),
            ViewState::Compact
        );
    }

    #[test]
    fn global_toggle_collapses_compact_or_board_to_idle() {
        assert_eq!(
            ViewState::Compact.transition(ViewEvent::GlobalToggle),
            ViewState::Idle
        );
        assert_eq!(
            ViewState::Board.transition(ViewEvent::GlobalToggle),
            ViewState::Idle
        );
    }

    #[test]
    fn explicit_restore_and_maximize_choose_compact_or_board() {
        assert_eq!(
            ViewState::Board.transition(ViewEvent::OpenCompact),
            ViewState::Compact
        );
        assert_eq!(
            ViewState::Compact.transition(ViewEvent::OpenBoard),
            ViewState::Board
        );
    }

    #[test]
    fn external_launch_collapses_only_compact() {
        assert_eq!(
            ViewState::Compact.transition(ViewEvent::ExternalLaunch),
            ViewState::Idle
        );
        assert_eq!(
            ViewState::Board.transition(ViewEvent::ExternalLaunch),
            ViewState::Board
        );
    }

    #[test]
    fn idle_orb_click_only_expands_idle() {
        assert_eq!(
            ViewState::Idle.transition(ViewEvent::ClickIdleOrb),
            ViewState::Compact
        );
        assert_eq!(
            ViewState::Hidden.transition(ViewEvent::ClickIdleOrb),
            ViewState::Hidden
        );
    }

    #[test]
    fn open_board_and_hide_are_explicit() {
        assert_eq!(
            ViewState::Idle.transition(ViewEvent::OpenBoard),
            ViewState::Board
        );
        assert_eq!(
            ViewState::Board.transition(ViewEvent::Hide),
            ViewState::Hidden
        );
    }
}
