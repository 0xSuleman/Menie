//! Local meeting-app detection.
//!
//! Detection uses only the operating system's process list. It never joins a
//! meeting, reads meeting content, or contacts a calendar/provider; recording
//! automation remains an explicit user-controlled action.

use serde::Serialize;
use sysinfo::System;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DetectedMeetingApp {
    pub id: String,
    pub name: String,
}

fn classify_process(process_name: &str) -> Option<DetectedMeetingApp> {
    let normalized = process_name.to_ascii_lowercase();
    let (id, name) = if normalized.contains("zoom") {
        ("zoom", "Zoom")
    } else if normalized.contains("teams") {
        ("teams", "Microsoft Teams")
    } else if normalized.contains("webex") {
        ("webex", "Webex")
    } else if normalized.contains("slack") {
        ("slack", "Slack")
    } else {
        return None;
    };

    Some(DetectedMeetingApp {
        id: id.to_string(),
        name: name.to_string(),
    })
}

pub fn detect_running_meeting_apps() -> Vec<DetectedMeetingApp> {
    let system = System::new_all();

    let mut apps: Vec<_> = system
        .processes()
        .values()
        .filter_map(|process| classify_process(&process.name().to_string_lossy()))
        .collect();
    apps.sort_by(|left, right| left.id.cmp(&right.id));
    apps.dedup_by(|left, right| left.id == right.id);
    apps
}

#[tauri::command]
pub fn get_detected_meeting_apps() -> Vec<DetectedMeetingApp> {
    detect_running_meeting_apps()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_supported_meeting_processes_without_browser_guessing() {
        assert_eq!(classify_process("Zoom.exe").unwrap().id, "zoom");
        assert_eq!(classify_process("ms-teams").unwrap().id, "teams");
        assert_eq!(classify_process("WebexHost").unwrap().id, "webex");
        assert_eq!(classify_process("slack.exe").unwrap().id, "slack");
        assert!(classify_process("chrome.exe").is_none());
    }
}
