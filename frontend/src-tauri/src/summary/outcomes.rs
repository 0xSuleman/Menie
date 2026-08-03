//! Conservative structured outcomes derived from a rendered local summary.
//!
//! This adapter never invents evidence. Until the transcript-level resolver is
//! available, extracted items explicitly report `NotFound` evidence so the UI
//! and exports can distinguish a useful draft from a verified claim.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutcomeKind {
    Decision,
    ActionItem,
    Risk,
    Blocker,
    Question,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceStatus {
    NotFound,
    Linked,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EvidenceSegment {
    pub text: String,
    pub start_time: f64,
    pub end_time: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StructuredOutcome {
    pub kind: OutcomeKind,
    pub text: String,
    pub owner: Option<String>,
    pub due: Option<String>,
    pub evidence_status: EvidenceStatus,
    pub evidence_timestamps: Vec<f64>,
}

fn explicit_action_metadata(text: &str) -> (Option<String>, Option<String>) {
    fn labelled_value(text: &str, label: &str) -> Option<String> {
        text.split(|character| matches!(character, '|' | ';' | '[' | ']'))
            .find_map(|part| {
                let part = part
                    .trim()
                    .trim_start_matches(|character: char| character == '-' || character == '—');
                let (field, value) = part.split_once(':')?;
                let value = value.trim();
                (field.trim().eq_ignore_ascii_case(label)
                    && !value.is_empty()
                    && value.chars().count() <= 120)
                    .then(|| value.to_string())
            })
    }
    (labelled_value(text, "owner"), labelled_value(text, "due"))
}

fn heading_kind(heading: &str) -> Option<OutcomeKind> {
    match heading.trim().to_ascii_lowercase().as_str() {
        "decision" | "decisions" | "key decision" | "key decisions" => Some(OutcomeKind::Decision),
        "action item" | "action items" | "actions" | "next steps" => Some(OutcomeKind::ActionItem),
        "risk" | "risks" => Some(OutcomeKind::Risk),
        "blocker" | "blockers" => Some(OutcomeKind::Blocker),
        "question" | "questions" | "open questions" => Some(OutcomeKind::Question),
        _ => None,
    }
}

/// Extract list items under supported markdown headings. Narrative paragraphs
/// are deliberately ignored: they are prose, not a user-reviewable outcome.
pub fn extract_structured_outcomes(markdown: &str) -> Vec<StructuredOutcome> {
    let mut kind = None;
    let mut outcomes = Vec::new();

    for line in markdown.lines() {
        let trimmed = line.trim();
        let heading = trimmed
            .strip_prefix("##")
            .map(|value| value.trim_start_matches('#').trim())
            .or_else(|| {
                trimmed
                    .strip_prefix("**")
                    .and_then(|value| value.strip_suffix("**"))
                    .map(str::trim)
            });
        if let Some(heading) = heading {
            kind = heading_kind(heading);
            continue;
        }

        let Some(kind) = kind.clone() else { continue };
        let Some(item) = trimmed
            .strip_prefix("- ")
            .or_else(|| trimmed.strip_prefix("* "))
        else {
            continue;
        };
        let text = item.trim();
        if !text.is_empty() {
            let (owner, due) = if kind == OutcomeKind::ActionItem {
                explicit_action_metadata(text)
            } else {
                (None, None)
            };
            outcomes.push(StructuredOutcome {
                kind,
                text: text.to_string(),
                owner,
                due,
                evidence_status: EvidenceStatus::NotFound,
                evidence_timestamps: Vec::new(),
            });
        }
    }

    outcomes
}

/// Attach evidence only for an exact normalized match in a timestamped source
/// segment. This intentionally prefers an unlinked draft over a plausible but
/// incorrect citation.
pub fn attach_exact_evidence(outcomes: &mut [StructuredOutcome], segments: &[EvidenceSegment]) {
    for outcome in outcomes {
        let normalized_outcome = normalize_for_evidence(&outcome.text);
        if normalized_outcome.len() < 8 {
            continue;
        }
        if let Some(segment) = segments
            .iter()
            .find(|segment| normalize_for_evidence(&segment.text).contains(&normalized_outcome))
        {
            outcome.evidence_status = EvidenceStatus::Linked;
            outcome.evidence_timestamps = match segment.end_time {
                Some(end) if end > segment.start_time => vec![segment.start_time, end],
                _ => vec![segment.start_time],
            };
        }
    }
}

fn normalize_for_evidence(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_lowercase)
        .map(|character| {
            if character.is_alphanumeric() {
                character
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_only_reviewable_items_under_outcome_headings() {
        let outcomes = extract_structured_outcomes(
            "## Decisions\n- Ship local mode\n\n## Action Items\n- Sam: add tests\n\nNarrative text",
        );

        assert_eq!(outcomes.len(), 2);
        assert_eq!(outcomes[0].kind, OutcomeKind::Decision);
        assert_eq!(outcomes[1].kind, OutcomeKind::ActionItem);
        assert!(outcomes
            .iter()
            .all(|item| item.evidence_status == EvidenceStatus::NotFound));
    }

    #[test]
    fn accepts_builtin_template_heading_styles_and_key_decisions() {
        let outcomes = extract_structured_outcomes(
            "**Key Decisions**\n- Keep processing local\n\n**Blockers**\n- Waiting for a model download",
        );

        assert_eq!(outcomes.len(), 2);
        assert_eq!(outcomes[0].kind, OutcomeKind::Decision);
        assert_eq!(outcomes[1].kind, OutcomeKind::Blocker);
    }

    #[test]
    fn links_only_exact_normalized_outcomes_to_timestamped_evidence() {
        let mut outcomes = extract_structured_outcomes("## Decisions\n- Keep all processing local");
        attach_exact_evidence(
            &mut outcomes,
            &[EvidenceSegment {
                text: "We agreed to keep all processing local on this device.".to_string(),
                start_time: 42.0,
                end_time: Some(46.0),
            }],
        );

        assert_eq!(outcomes[0].evidence_status, EvidenceStatus::Linked);
        assert_eq!(outcomes[0].evidence_timestamps, vec![42.0, 46.0]);
    }

    #[test]
    fn action_metadata_requires_explicit_owner_and_due_labels() {
        let outcomes = extract_structured_outcomes(
            "## Action Items\n- Prepare release checklist | Owner: Sam | Due: 2026-08-01\n- Follow up with the customer",
        );
        assert_eq!(outcomes[0].owner.as_deref(), Some("Sam"));
        assert_eq!(outcomes[0].due.as_deref(), Some("2026-08-01"));
        assert_eq!(outcomes[1].owner, None);
        assert_eq!(outcomes[1].due, None);
        let ambiguous =
            extract_structured_outcomes("## Action Items\n- Review overdue customer requests");
        assert_eq!(ambiguous[0].due, None);
    }
}
