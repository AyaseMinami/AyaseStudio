use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};

fn text(encoded: &str) -> Result<String, String> {
    String::from_utf8(STANDARD.decode(encoded.trim()).map_err(|_| "签名格式无效")?)
        .map_err(|_| "签名格式无效".into())
}

pub fn validate_public_key(encoded: &str) -> Result<(), String> {
    PublicKey::decode(&text(encoded)?).map(|_| ()).map_err(|_| "更新公钥未配置或无效".into())
}

/// Same outer base64/minisign verification as the official updater; never accepts unsigned bytes.
fn verified_signature(bytes: &[u8], public_key: &str, signature: &str) -> Result<Signature, String> {
    let key = PublicKey::decode(&text(public_key)?).map_err(|_| "更新公钥无效")?;
    let signature = Signature::decode(&text(signature)?).map_err(|_| "更新签名格式无效")?;
    key.verify(bytes, &signature, true).map_err(|_| "更新包签名校验失败")?;
    Ok(signature)
}

fn verify_file(bytes: &[u8], public_key: &str, signature: &str, filename: &str) -> Result<(), String> {
    let signature = verified_signature(bytes, public_key, signature)?;
    // CLI 2.11.4 signs the original filename in the global signature. Bind that authenticated
    // versioned name, rather than trusting the unsigned manifest's version or download URL.
    let filenames: Vec<_> = signature.trusted_comment().split('\t').filter_map(|s| s.strip_prefix("file:")).collect();
    if filenames != [filename] { return Err("更新包的签名版本与清单不一致".into()); }
    Ok(())
}

pub fn verify_release(bytes: &[u8], public_key: &str, signature: &str, version: &str) -> Result<(), String> {
    let parsed = semver::Version::parse(version).map_err(|_| "更新版本格式无效")?;
    if parsed.to_string() != version { return Err("更新版本格式无效".into()); }
    verify_file(bytes, public_key, signature, &format!("Ayase Studio_{version}_x64-setup.exe"))
}

#[cfg(test)]
mod tests {
    use super::*;
    // Public test vector from minisign-verify 0.2.5 (ISC license), not a release signing key.
    fn fixture() -> (String, String) {
        (STANDARD.encode("untrusted comment: test public key\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3"),
         STANDARD.encode("untrusted comment: signature from minisign secret key\nRUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\ntrusted comment: timestamp:1633700835\tfile:test\tprehashed\nwLMDjy9FLAuxZ3q4NlEvkgtyhrr0gtTu6KC4KBJdITbbOeAi1zBIYo0v4iTgt8jJpIidRJnp94ABQkJAgAooBQ=="))
    }
    #[test]
    fn rejects_tampering_and_missing_or_malformed_signatures() {
        let (key, sig) = fixture();
        assert!(validate_public_key(&key).is_ok());
        assert!(verify_file(b"test", &key, &sig, "test").is_ok());
        assert!(verify_file(b"tampered", &key, &sig, "test").is_err());
        assert!(verify_file(b"test", "", &sig, "test").is_err());
        assert!(verify_file(b"test", &key, "", "test").is_err());
        assert!(verify_file(b"test", &key, "malformed", "test").is_err());
        assert!(verify_file(b"test", &key, &sig, "Ayase Studio_99.0.0_x64-setup.exe").is_err());
        assert!(verify_release(b"test", &key, &sig, "99.0.0").is_err());
        let swapped = text(&sig).unwrap().replace("file:test", "file:Ayase Studio_99.0.0_x64-setup.exe");
        assert!(verify_release(b"test", &key, &STANDARD.encode(swapped), "99.0.0").is_err());
    }
}
