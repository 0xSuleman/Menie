//! Local, deterministic retrieval primitives for meeting memory.
//!
//! This is deliberately a grounding layer rather than a free-form answerer:
//! callers receive source text and timestamps, or an explicit refusal when the
//! selected local scope has insufficient evidence.

use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct KnowledgeSegment {
    #[serde(skip)]
    pub source_id: Option<String>,
    pub meeting_id: String,
    pub timestamp_seconds: f64,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Citation {
    pub meeting_id: String,
    pub timestamp_seconds: f64,
    pub text: String,
    pub score: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum GroundedAnswer {
    Evidence {
        citations: Vec<Citation>,
    },
    Generated {
        answer: String,
        citations: Vec<Citation>,
    },
    InsufficientEvidence {
        message: String,
        closest: Vec<Citation>,
    },
}

fn tokens(value: &str) -> HashSet<String> {
    value
        .split(|character: char| !character.is_alphanumeric())
        .filter(|token| token.len() > 1)
        .map(|token| token.to_lowercase())
        .collect()
}

pub const LOCAL_EMBEDDING_MODEL_ID: &str = "menie-local-hash-v1";
const EMBEDDING_DIMENSIONS: usize = 64;

fn local_embedding(value: &str) -> [f32; EMBEDDING_DIMENSIONS] {
    let mut vector = [0.0; EMBEDDING_DIMENSIONS];
    for token in tokens(value) {
        let mut hasher = DefaultHasher::new();
        token.hash(&mut hasher);
        let bucket = (hasher.finish() as usize) % EMBEDDING_DIMENSIONS;
        vector[bucket] += 1.0;
    }
    let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    if norm > 0.0 {
        vector.iter_mut().for_each(|value| *value /= norm);
    }
    vector
}

pub fn local_embedding_json(value: &str) -> String {
    serde_json::to_string(&local_embedding(value).to_vec()).expect("embedding serializes")
}

fn cosine_similarity(
    left: &[f32; EMBEDDING_DIMENSIONS],
    right: &[f32; EMBEDDING_DIMENSIONS],
) -> f32 {
    left.iter().zip(right).map(|(a, b)| a * b).sum()
}

/// Returns cited local segments ordered by token-overlap score. No generated
/// meeting claim is returned when the query has no support in the chosen scope.
pub fn retrieve_local(query: &str, segments: &[KnowledgeSegment], limit: usize) -> GroundedAnswer {
    retrieve_local_with_embeddings(query, segments, &HashMap::new(), limit)
}

pub fn retrieve_local_with_embeddings(
    query: &str,
    segments: &[KnowledgeSegment],
    stored_embeddings: &HashMap<String, Vec<f32>>,
    limit: usize,
) -> GroundedAnswer {
    let query_tokens = tokens(query);
    if query_tokens.is_empty() {
        return GroundedAnswer::InsufficientEvidence {
            message: "Enter a more specific question to search this local meeting scope."
                .to_string(),
            closest: Vec::new(),
        };
    }

    let query_embedding = local_embedding(query);
    let mut citations: Vec<Citation> = segments
        .iter()
        .filter_map(|segment| {
            let segment_tokens = tokens(&segment.text);
            let overlap = query_tokens.intersection(&segment_tokens).count();
            let vector_score = segment
                .source_id
                .as_ref()
                .and_then(|id| stored_embeddings.get(id))
                .and_then(|values| <&[f32; EMBEDDING_DIMENSIONS]>::try_from(values.as_slice()).ok())
                .map(|embedding| cosine_similarity(&query_embedding, embedding))
                .unwrap_or_else(|| {
                    cosine_similarity(&query_embedding, &local_embedding(&segment.text))
                });
            (overlap > 0 || vector_score >= 0.15).then(|| Citation {
                meeting_id: segment.meeting_id.clone(),
                timestamp_seconds: segment.timestamp_seconds,
                text: segment.text.clone(),
                score: (overlap as f32 / query_tokens.len() as f32) * 0.7 + vector_score * 0.3,
            })
        })
        .collect();

    citations.sort_by(|left, right| right.score.total_cmp(&left.score));
    citations.truncate(limit.max(1));

    if citations.is_empty() {
        let mut closest = segments
            .iter()
            .take(limit.max(1))
            .map(|segment| Citation {
                meeting_id: segment.meeting_id.clone(),
                timestamp_seconds: segment.timestamp_seconds,
                text: segment.text.clone(),
                score: 0.0,
            })
            .collect::<Vec<_>>();
        closest.truncate(limit.max(1));
        GroundedAnswer::InsufficientEvidence {
            message: "I could not find supporting evidence in the selected local meetings."
                .to_string(),
            closest,
        }
    } else {
        GroundedAnswer::Evidence { citations }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segment(meeting_id: &str, timestamp_seconds: f64, text: &str) -> KnowledgeSegment {
        KnowledgeSegment {
            source_id: None,
            meeting_id: meeting_id.to_string(),
            timestamp_seconds,
            text: text.to_string(),
        }
    }

    #[test]
    fn local_retrieval_returns_timestamped_evidence_instead_of_an_uncited_answer() {
        let result = retrieve_local(
            "launch date",
            &[
                segment("meeting-a", 42.0, "The launch date is Friday."),
                segment("meeting-b", 10.0, "We discussed design work."),
            ],
            3,
        );

        let GroundedAnswer::Evidence { citations } = result else {
            panic!("expected cited evidence");
        };
        assert_eq!(citations[0].meeting_id, "meeting-a");
        assert_eq!(citations[0].timestamp_seconds, 42.0);
    }

    #[test]
    fn local_retrieval_refuses_when_the_scope_has_no_supporting_evidence() {
        let result = retrieve_local(
            "budget",
            &[segment("meeting-a", 42.0, "The launch date is Friday.")],
            3,
        );

        assert!(matches!(
            result,
            GroundedAnswer::InsufficientEvidence { .. }
        ));
    }

    #[test]
    fn local_embedding_is_deterministic_and_normalized() {
        let first = local_embedding("launch date");
        let second = local_embedding("launch date");
        assert_eq!(first, second);
        assert!((cosine_similarity(&first, &first) - 1.0).abs() < 0.001);
    }
}
