//! Password-protected local handoff envelopes.
//!
//! This is intentionally a file-to-file primitive: it does not open a socket,
//! contact a server, or include media. The caller still decides how and where
//! the envelope is transferred.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use ring::{
    aead, pbkdf2,
    rand::{SecureRandom, SystemRandom},
};
use serde::{Deserialize, Serialize};
use std::num::NonZeroU32;

const KDF_ROUNDS: u32 = 120_000;
const SALT_BYTES: usize = 16;
const NONCE_BYTES: usize = 12;
const KEY_BYTES: usize = 32;
const MIN_PASSWORD_CHARS: usize = 8;
const ENVELOPE_TYPE: &str = "menie-encrypted-local-handoff";

#[derive(Debug, Serialize, Deserialize)]
struct Envelope {
    handoff_type: String,
    schema_version: u32,
    kdf: String,
    rounds: u32,
    salt: String,
    nonce: String,
    ciphertext: String,
}

fn derive_key(password: &str, salt: &[u8]) -> [u8; KEY_BYTES] {
    let mut key = [0_u8; KEY_BYTES];
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA256,
        NonZeroU32::new(KDF_ROUNDS).expect("non-zero KDF rounds"),
        salt,
        password.as_bytes(),
        &mut key,
    );
    key
}

pub fn encrypt(bundle_json: &str, password: &str) -> Result<String, String> {
    if password.chars().count() < MIN_PASSWORD_CHARS {
        return Err(format!(
            "Handoff password must contain at least {MIN_PASSWORD_CHARS} characters"
        ));
    }
    if bundle_json.trim().is_empty() {
        return Err("Cannot encrypt an empty meeting bundle".to_string());
    }
    let rng = SystemRandom::new();
    let mut salt = [0_u8; SALT_BYTES];
    let mut nonce = [0_u8; NONCE_BYTES];
    rng.fill(&mut salt)
        .map_err(|_| "Could not generate handoff salt".to_string())?;
    rng.fill(&mut nonce)
        .map_err(|_| "Could not generate handoff nonce".to_string())?;
    let key_bytes = derive_key(password, &salt);
    let key = aead::LessSafeKey::new(
        aead::UnboundKey::new(&aead::AES_256_GCM, &key_bytes)
            .map_err(|_| "Could not initialize handoff encryption".to_string())?,
    );
    let mut ciphertext = bundle_json.as_bytes().to_vec();
    key.seal_in_place_append_tag(
        aead::Nonce::assume_unique_for_key(nonce),
        aead::Aad::from(ENVELOPE_TYPE),
        &mut ciphertext,
    )
    .map_err(|_| "Could not encrypt local handoff".to_string())?;
    serde_json::to_string_pretty(&Envelope {
        handoff_type: ENVELOPE_TYPE.to_string(),
        schema_version: 1,
        kdf: "PBKDF2-HMAC-SHA256".to_string(),
        rounds: KDF_ROUNDS,
        salt: BASE64.encode(salt),
        nonce: BASE64.encode(nonce),
        ciphertext: BASE64.encode(ciphertext),
    })
    .map_err(|error| format!("Could not serialize encrypted handoff: {error}"))
}

pub fn decrypt(envelope_json: &str, password: &str) -> Result<String, String> {
    if password.chars().count() < MIN_PASSWORD_CHARS {
        return Err(format!(
            "Handoff password must contain at least {MIN_PASSWORD_CHARS} characters"
        ));
    }
    let envelope: Envelope = serde_json::from_str(envelope_json)
        .map_err(|_| "Invalid encrypted handoff envelope".to_string())?;
    if envelope.handoff_type != ENVELOPE_TYPE
        || envelope.schema_version != 1
        || envelope.kdf != "PBKDF2-HMAC-SHA256"
        || envelope.rounds != KDF_ROUNDS
    {
        return Err("Unsupported encrypted handoff envelope".to_string());
    }
    let salt = BASE64
        .decode(envelope.salt)
        .map_err(|_| "Invalid handoff salt".to_string())?;
    let nonce = BASE64
        .decode(envelope.nonce)
        .map_err(|_| "Invalid handoff nonce".to_string())?;
    let mut ciphertext = BASE64
        .decode(envelope.ciphertext)
        .map_err(|_| "Invalid handoff ciphertext".to_string())?;
    if salt.len() != SALT_BYTES
        || nonce.len() != NONCE_BYTES
        || ciphertext.len() < aead::MAX_TAG_LEN
    {
        return Err("Malformed encrypted handoff envelope".to_string());
    }
    let key_bytes = derive_key(password, &salt);
    let key = aead::LessSafeKey::new(
        aead::UnboundKey::new(&aead::AES_256_GCM, &key_bytes)
            .map_err(|_| "Could not initialize handoff decryption".to_string())?,
    );
    let nonce_array: [u8; NONCE_BYTES] = nonce
        .try_into()
        .map_err(|_| "Invalid handoff nonce".to_string())?;
    let plaintext = key
        .open_in_place(
            aead::Nonce::assume_unique_for_key(nonce_array),
            aead::Aad::from(ENVELOPE_TYPE),
            &mut ciphertext,
        )
        .map_err(|_| "Could not decrypt handoff; check the password".to_string())?;
    String::from_utf8(plaintext.to_vec())
        .map_err(|_| "Decrypted handoff is not valid UTF-8".to_string())
}

#[cfg(test)]
mod tests {
    use super::{decrypt, encrypt};

    #[test]
    fn encrypted_handoff_round_trips_and_rejects_wrong_password() {
        let source = r#"{"bundle_type":"menie-local-meeting-bundle","schema_version":1}"#;
        let envelope = encrypt(source, "correct horse battery").unwrap();
        assert_eq!(decrypt(&envelope, "correct horse battery").unwrap(), source);
        assert!(decrypt(&envelope, "wrong password").is_err());
    }
}
