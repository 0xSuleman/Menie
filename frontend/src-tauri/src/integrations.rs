//! Approval-aware outbound integration contract.
//!
//! Connectors are intentionally not allowed to decide what leaves Menie. This
//! module represents the user-reviewed artifact and guards dispatch with an
//! explicit approval state and a stable idempotency key.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryState {
    PendingApproval,
    Approved,
    Sent,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OutboundDelivery {
    pub destination: String,
    pub event_type: String,
    pub schema_version: u32,
    pub idempotency_key: String,
    pub payload: serde_json::Value,
    pub state: DeliveryState,
}

impl OutboundDelivery {
    pub fn new(
        destination: impl Into<String>,
        event_type: impl Into<String>,
        idempotency_key: impl Into<String>,
        payload: serde_json::Value,
    ) -> Self {
        Self {
            destination: destination.into(),
            event_type: event_type.into(),
            schema_version: 1,
            idempotency_key: idempotency_key.into(),
            payload,
            state: DeliveryState::PendingApproval,
        }
    }

    pub fn approve(&mut self) {
        if self.state == DeliveryState::PendingApproval {
            self.state = DeliveryState::Approved;
        }
    }

    pub fn can_dispatch(&self) -> bool {
        self.state == DeliveryState::Approved
            && !self.destination.trim().is_empty()
            && !self.idempotency_key.trim().is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_delivery_cannot_dispatch_before_the_user_approves_the_exact_payload() {
        let mut delivery = OutboundDelivery::new(
            "webhook",
            "artifact_approved",
            "meeting-123:artifact-1:v1",
            serde_json::json!({"markdown": "Approved notes"}),
        );

        assert!(!delivery.can_dispatch());
        assert_eq!(delivery.schema_version, 1);
        delivery.approve();
        assert!(delivery.can_dispatch());
    }

    #[test]
    fn a_delivery_without_an_idempotency_key_stays_blocked() {
        let mut delivery =
            OutboundDelivery::new("webhook", "meeting_completed", "", serde_json::json!({}));
        delivery.approve();
        assert!(!delivery.can_dispatch());
    }
}
