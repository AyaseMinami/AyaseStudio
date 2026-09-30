use crate::cherry_leveldb;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

fn bad<T>() -> Result<T, String> {
    Err("cherry-invalid-chat".into())
}
fn text<'a>(v: &'a Value, key: &str) -> Result<&'a str, String> {
    let s = v
        .get(key)
        .and_then(Value::as_str)
        .ok_or("cherry-invalid-chat")?;
    if s.len() > 8 * 1024 * 1024 {
        return Err("cherry-limit".into());
    }
    Ok(s)
}
fn id<'a>(v: &'a Value, key: &str) -> Result<&'a str, String> {
    let s = text(v, key)?;
    if s.is_empty() || s.len() > 512 {
        return bad();
    }
    Ok(s)
}
fn array<'a>(v: &'a Value, key: &str) -> Result<&'a Vec<Value>, String> {
    v.get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| "cherry-invalid-chat".into())
}
fn time(v: &Value, key: &str) -> Result<i64, String> {
    let t = text(v, key)?;
    let n = chrono::DateTime::parse_from_rfc3339(t)
        .map_err(|_| "cherry-invalid-time")?
        .timestamp_millis();
    if n < 0 {
        return bad();
    }
    Ok(n)
}
fn utf16be(bytes: &[u8]) -> Result<String, String> {
    if bytes.len() % 2 != 0 {
        return bad();
    }
    let units: Vec<_> = bytes
        .chunks_exact(2)
        .map(|p| u16::from_be_bytes([p[0], p[1]]))
        .collect();
    String::from_utf16(&units).map_err(|_| "cherry-invalid-chat".into())
}
fn string_with_length(bytes: &[u8], pos: &mut usize) -> Result<String, String> {
    let len = usize::try_from(cherry_leveldb::varint(bytes, pos)?).map_err(|_| "cherry-limit")?;
    let end = pos
        .checked_add(len.checked_mul(2).ok_or("cherry-limit")?)
        .ok_or("cherry-limit")?;
    let s = utf16be(bytes.get(*pos..end).ok_or("cherry-invalid-chat")?)?;
    *pos = end;
    Ok(s)
}
fn le(bytes: &[u8]) -> Result<u64, String> {
    if bytes.len() > 8 {
        return bad();
    }
    Ok(bytes
        .iter()
        .enumerate()
        .fold(0, |value, (i, b)| value | (u64::from(*b) << (8 * i))))
}
fn prefix(bytes: &[u8]) -> Result<(u64, u64, u64, usize), String> {
    let descriptor = *bytes.first().ok_or("cherry-invalid-chat")?;
    let db = (descriptor >> 5) as usize + 1;
    let os = ((descriptor >> 2) & 7) as usize + 1;
    let ix = (descriptor & 3) as usize + 1;
    let end = 1 + db + os + ix;
    if bytes.len() < end {
        return bad();
    }
    Ok((
        le(&bytes[1..1 + db])?,
        le(&bytes[1 + db..1 + db + os])?,
        le(&bytes[1 + db + os..end])?,
        end,
    ))
}
fn storage_string(bytes: &[u8]) -> Result<String, String> {
    match bytes.first() {
        Some(1) => Ok(bytes[1..].iter().map(|b| char::from(*b)).collect()),
        Some(0) => {
            if (bytes.len() - 1) % 2 != 0 {
                return bad();
            }
            let units: Vec<_> = bytes[1..]
                .chunks_exact(2)
                .map(|p| u16::from_le_bytes([p[0], p[1]]))
                .collect();
            String::from_utf16(&units).map_err(|_| "cherry-invalid-chat".into())
        }
        _ => bad(),
    }
}
fn persisted_assistants(root: &Value) -> Result<Vec<Value>, String> {
    let raw = root
        .get("persist:cherry-studio")
        .or_else(|| root.get("cherry-studio"))
        .ok_or("cherry-missing-assistants")?;
    let persisted: Value = if let Some(s) = raw.as_str() {
        serde_json::from_str(s).map_err(|_| "cherry-invalid-chat")?
    } else {
        raw.clone()
    };
    let raw = persisted
        .get("assistants")
        .ok_or("cherry-missing-assistants")?;
    let state: Value = if let Some(s) = raw.as_str() {
        serde_json::from_str(s).map_err(|_| "cherry-invalid-chat")?
    } else {
        raw.clone()
    };
    Ok(array(&state, "assistants")?.clone())
}
fn file(block: &Value, files: &mut serde_json::Map<String, Value>) -> Value {
    let Some(f) = block.get("file") else {
        return json!({"type":"unsupported"});
    };
    let Some(file_id) = f.get("id").and_then(Value::as_str) else {
        return json!({"type":"unsupported"});
    };
    let name = f
        .get("origin_name")
        .or_else(|| f.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let ext = f
        .get("ext")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim_start_matches('.');
    if file_id.is_empty()
        || !file_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
        || ext.len() > 16
        || !ext.bytes().all(|c| c.is_ascii_alphanumeric())
        || name.is_empty()
        || name.len() > 4096
        || name
            .chars()
            .any(|c| c == '/' || c == '\\' || c.is_control())
    {
        return json!({"type":"unsupported"});
    }
    let key = if ext.is_empty() {
        format!("Data/Files/{file_id}")
    } else {
        format!("Data/Files/{file_id}.{ext}")
    };
    files.insert(
        key.clone(),
        json!({"name":name,"size":f.get("size").and_then(Value::as_u64).unwrap_or(0)}),
    );
    json!({"type":"file","fileKey":key,"name":name})
}
pub(crate) fn normalize(
    assistants: Vec<Value>,
    topics: Vec<Value>,
    blocks: Vec<Value>,
) -> Result<Value, String> {
    if assistants.len() > 5000 || topics.len() > 10000 || blocks.len() > 200000 {
        return Err("cherry-limit".into());
    }
    let mut block_map = BTreeMap::new();
    for b in &blocks {
        if block_map.insert(id(b, "id")?, b).is_some() {
            return bad();
        }
    }
    let mut owners = BTreeMap::new();
    let mut meta = BTreeMap::new();
    let mut output_assistants = Vec::new();
    let mut warnings = Vec::new();
    let mut assistant_ids = BTreeSet::new();
    let mut emitted = 0usize;
    let mut references = 0;
    for a in &assistants {
        let aid = id(a, "id")?;
        if !assistant_ids.insert(aid) {
            return bad();
        }
        let name = text(a, "name")?;
        if name.len() > 4096 {
            return bad();
        }
        emitted += aid.len() + name.len() + 64;
        if emitted > 64 * 1024 * 1024 {
            return Err("cherry-limit".into());
        }
        output_assistants.push(json!({"id":aid,"name":name}));
        for t in array(a, "topics")? {
            let tid = id(t, "id")?;
            if owners.insert(tid, aid).is_some() {
                return Err("cherry-conflicting-owner".into());
            }
            meta.insert(tid, t);
        }
    }
    let mut output_topics = Vec::new();
    let mut count = 0;
    let mut used = BTreeSet::new();
    let mut topic_ids = BTreeSet::new();
    let mut files = serde_json::Map::new();
    for t in &topics {
        let tid = id(t, "id")?;
        if !topic_ids.insert(tid) {
            return bad();
        }
        let Some(owner) = owners.get(tid) else {
            return Err("cherry-conflicting-owner".into());
        };
        let metadata = meta[tid];
        let declared = metadata
            .get("assistantId")
            .and_then(Value::as_str)
            .unwrap_or(owner);
        let messages = array(t, "messages")?;
        if declared != *owner {
            // Empty topics have no message ownership to contradict their unique
            // assistant-list membership. Their stored assistantId may be stale.
            if (!messages.is_empty() && assistant_ids.contains(declared))
                || !messages
                    .iter()
                    .all(|m| m.get("assistantId").and_then(Value::as_str) == Some(owner))
            {
                return Err("cherry-conflicting-owner".into());
            }
            warnings.push(if messages.is_empty() {
                "已按助手列表中的唯一归属修复空对话的过期助手引用。".to_string()
            } else {
                "已按助手列表与消息共同确认的归属修复过期的助手引用。".to_string()
            });
        }
        let mut out = Vec::new();
        for m in messages {
            count += 1;
            if count > 100000 {
                return Err("cherry-limit".into());
            }
            if m.get("topicId")
                .and_then(Value::as_str)
                .is_some_and(|v| v != tid)
                || m.get("assistantId")
                    .and_then(Value::as_str)
                    .is_some_and(|v| v != *owner)
            {
                return Err("cherry-conflicting-owner".into());
            }
            let mid = id(m, "id")?;
            let role = text(m, "role")?;
            if !["user", "assistant", "system"].contains(&role) {
                return bad();
            }
            emitted += mid.len() + m.get("askId").and_then(Value::as_str).map_or(0, str::len) + 256;
            if emitted > 64 * 1024 * 1024 {
                return Err("cherry-limit".into());
            }
            let mut parts = Vec::new();
            if let Some(refs) = m.get("blocks").and_then(Value::as_array) {
                for reference in refs {
                    references += 1;
                    if references > 200000 {
                        return Err("cherry-limit".into());
                    }
                    let bid = reference.as_str().ok_or("cherry-invalid-chat")?;
                    let Some(block) = block_map.get(bid) else {
                        return Err("cherry-missing-block".into());
                    };
                    used.insert(bid);
                    let kind = block.get("type").and_then(Value::as_str).unwrap_or("");
                    if ["main_text", "thinking", "code"].contains(&kind) {
                        emitted += text(block, "content")?.len() + 64;
                        if emitted > 64 * 1024 * 1024 {
                            return Err("cherry-limit".into());
                        }
                    }
                    let part = match kind {
                        "main_text" => json!({"type":"text","text":text(block,"content")?}),
                        "thinking" => json!({"type":"thinking","text":text(block,"content")?}),
                        "code" => {
                            json!({"type":"text","text":format!("\n```\n{}\n```\n",text(block,"content")?)})
                        }
                        "image" | "file" => file(block, &mut files),
                        _ => json!({"type":"unsupported"}),
                    };
                    if kind == "image" || kind == "file" {
                        emitted += part["name"].as_str().map_or(0, str::len)
                            + part["fileKey"].as_str().map_or(0, str::len)
                            + 128;
                        if emitted > 64 * 1024 * 1024 {
                            return Err("cherry-limit".into());
                        }
                    }
                    parts.push(part);
                }
            } else {
                return bad();
            }
            let status = match m.get("status").and_then(Value::as_str) {
                Some("success" | "complete") => "complete",
                Some("error" | "failed") => "failed",
                Some("paused") => "paused",
                _ => "incomplete",
            };
            let mut message = json!({"id":mid,"role":role,"createdAt":time(m,"createdAt")?,"status":status,"parts":parts});
            if let Some(ask) = m.get("askId").and_then(Value::as_str) {
                message["askId"] = json!(ask)
            }
            out.push(message);
        }
        let title = text(metadata, "name")?;
        if title.len() > 4096 {
            return bad();
        }
        emitted += title.len() + tid.len() + owner.len() + 256;
        if emitted > 64 * 1024 * 1024 {
            return Err("cherry-limit".into());
        }
        output_topics.push(json!({"id":tid,"assistantId":owner,"title":title,"createdAt":time(metadata,"createdAt")?,"updatedAt":time(metadata,"updatedAt")?,"messages":out}));
    }
    // Keep metadata-only empty topics too; reject missing message tables for nonempty refs.
    for (tid, metadata) in &meta {
        if topic_ids.contains(tid) {
            continue;
        }
        return Err(if metadata
            .get("messages")
            .and_then(Value::as_array)
            .is_some_and(|v| !v.is_empty())
        {
            "cherry-missing-topic"
        } else {
            "cherry-missing-topic"
        }
        .into());
    }
    if used.len() != blocks.len() {
        warnings.push("未被消息引用的内容块未导入。".into())
    }
    warnings.sort();
    warnings.dedup();
    Ok(
        json!({"assistants":output_assistants,"topics":output_topics,"warnings":warnings,"files":files}),
    )
}
pub(crate) fn read_json(root: &Value) -> Result<Value, String> {
    if root.get("version").and_then(Value::as_u64) != Some(5) {
        return Err("cherry-unsupported-format".into());
    }
    let indexed = root.get("indexedDB").ok_or("cherry-unsupported-format")?;
    normalize(
        persisted_assistants(
            root.get("localStorage")
                .ok_or("cherry-missing-assistants")?,
        )?,
        array(indexed, "topics")?.clone(),
        array(indexed, "message_blocks")?.clone(),
    )
}
pub(crate) fn read_chromium(root: &Path) -> Result<Value, String> {
    let mut persisted = None;
    for record in cherry_leveldb::read_live(&root.join("Local Storage/leveldb"))? {
        if !record.deleted && record.key.first() == Some(&b'_') {
            let Some(separator) = record.key.iter().position(|b| *b == 0) else {
                continue;
            };
            if storage_string(&record.key[separator + 1..])? == "persist:cherry-studio" {
                if persisted.is_some() {
                    return bad();
                }
                let p: Value = serde_json::from_str(&storage_string(&record.value)?)
                    .map_err(|_| "cherry-invalid-chat")?;
                persisted = Some(json!({"persist:cherry-studio":p}));
            }
        }
    }
    let assistants = persisted_assistants(&persisted.ok_or("cherry-missing-assistants")?)?;
    let mut topics = Vec::new();
    let mut blocks = Vec::new();
    let mut databases = BTreeSet::new();
    let mut expanded = 0usize;
    for directory in std::fs::read_dir(root.join("IndexedDB")).map_err(|_| "cherry-missing-chat")? {
        let directory = directory.map_err(|_| "cherry-missing-chat")?.path();
        if !directory
            .file_name()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s.ends_with(".indexeddb.leveldb"))
        {
            continue;
        }
        let records = cherry_leveldb::read_live(&directory)?;
        let mut names = BTreeMap::new();
        let mut known_db = BTreeSet::new();
        for r in &records {
            if r.deleted {
                continue;
            }
            let (db, os, ix, start) = prefix(&r.key)?;
            let tail = &r.key[start..];
            if db == 0 && os == 0 && ix == 0 && tail.first() == Some(&201) {
                let mut pos = 1;
                let _origin = string_with_length(tail, &mut pos)?;
                let name = string_with_length(tail, &mut pos)?;
                if name == "CherryStudio" {
                    known_db.insert(le(&r.value)?);
                }
            }
            if os == 0 && ix == 0 && tail.first() == Some(&50) {
                let mut pos = 1;
                let store = cherry_leveldb::varint(tail, &mut pos)?;
                if tail.get(pos) == Some(&0) {
                    names.insert((db, store), utf16be(&r.value)?);
                }
            }
        }
        for db in &known_db {
            databases.insert((directory.clone(), *db));
            if databases.len() > 1 {
                return Err("cherry-ambiguous-chat-source".into());
            }
        }
        for record in records {
            if record.deleted {
                continue;
            }
            let (db, os, ix, _) = prefix(&record.key)?;
            if !known_db.contains(&db) || ix != 1 {
                continue;
            }
            let destination = match names.get(&(db, os)).map(String::as_str) {
                Some("topics") => &mut topics,
                Some("message_blocks") => &mut blocks,
                _ => continue,
            };
            let mut offset = 0;
            let _version = cherry_leveldb::varint(&record.value, &mut offset)?;
            let value = crate::cherry_v8::decode(&record.value[offset..])?;
            expanded = expanded
                .checked_add(
                    serde_json::to_vec(&value)
                        .map_err(|_| "cherry-invalid-chat")?
                        .len(),
                )
                .ok_or("cherry-limit")?;
            if expanded > 128 * 1024 * 1024 || destination.len() > 200000 {
                return Err("cherry-limit".into());
            }
            destination.push(value);
        }
    }
    if databases.len() != 1 {
        return Err("cherry-ambiguous-chat-source".into());
    }
    normalize(assistants, topics, blocks)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn data() -> (Vec<Value>, Vec<Value>, Vec<Value>) {
        (
            vec![
                json!({"id":"a","name":"Example","topics":[{"id":"t","name":"Topic","assistantId":"a","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}]}),
            ],
            vec![
                json!({"id":"t","messages":[{"id":"m","role":"user","topicId":"t","assistantId":"a","createdAt":"2026-01-01T00:00:00Z","status":"success","blocks":["b"]}]}),
            ],
            vec![json!({"id":"b","type":"main_text","content":"Example"})],
        )
    }
    #[test]
    fn whitelist_projection_joins_blocks_and_ignores_credentials() {
        let (a, t, mut b) = data();
        b[0]["apiKey"] = json!("synthetic-not-imported");
        let out = normalize(a, t, b).unwrap();
        assert!(out["topics"][0]["messages"][0]["parts"][0]["text"] == "Example");
        assert!(!out.to_string().contains("synthetic-not-imported"))
    }
    #[test]
    fn empty_topic_uses_unique_assistant_list_owner_despite_stale_reference() {
        let (mut a, mut t, _) = data();
        a[0]["topics"][0]["assistantId"] = json!("previous");
        a.push(json!({"id":"previous","name":"Previous","topics":[]}));
        t[0]["messages"] = json!([]);
        let out = normalize(a, t, vec![]).unwrap();
        assert_eq!(out["topics"].as_array().unwrap().len(), 1);
        assert_eq!(out["topics"][0]["assistantId"], "a");
        assert_eq!(out["topics"][0]["title"], "Topic");
        assert_eq!(out["topics"][0]["messages"], json!([]));
        assert_eq!(out["warnings"].as_array().unwrap().len(), 1);
    }
    #[test]
    fn empty_topic_with_multiple_list_owners_still_rejects() {
        let (mut a, mut t, _) = data();
        let mut other = a[0].clone();
        other["id"] = json!("other");
        a.push(other);
        t[0]["messages"] = json!([]);
        assert_eq!(
            normalize(a, t, vec![]).unwrap_err(),
            "cherry-conflicting-owner"
        );
    }
    #[test]
    fn nonempty_topic_with_conflicting_existing_owner_still_rejects() {
        let (mut a, t, b) = data();
        a[0]["topics"][0]["assistantId"] = json!("previous");
        a.push(json!({"id":"previous","name":"Previous","topics":[]}));
        assert_eq!(normalize(a, t, b).unwrap_err(), "cherry-conflicting-owner");
    }
    #[test]
    fn message_owner_conflicts_still_reject() {
        for field in ["assistantId", "topicId"] {
            let (a, mut t, b) = data();
            t[0]["messages"][0][field] = json!("other");
            assert_eq!(normalize(a, t, b).unwrap_err(), "cherry-conflicting-owner");
        }
    }
    #[test]
    fn missing_blocks_and_conflicting_owners_reject() {
        let (a, t, _) = data();
        assert!(normalize(a, t, vec![]).is_err());
        let (mut a, t, b) = data();
        a.push(a[0].clone());
        assert!(normalize(a, t, b).is_err())
    }
    #[test]
    fn unreferenced_blocks_do_not_create_chats() {
        let (a, t, mut b) = data();
        b.push(json!({"id":"unused","type":"main_text","content":"unused"}));
        let out = normalize(a, t, b).unwrap();
        assert!(out["topics"].as_array().unwrap().len() == 1);
        assert!(!out.to_string().contains("unused"))
    }
    #[test]
    fn extensionless_descriptor_is_safe_and_degraded() {
        let mut files = serde_json::Map::new();
        let out = file(
            &json!({"file":{"id":"f","origin_name":"note","ext":""}}),
            &mut files,
        );
        assert!(out["fileKey"] == "Data/Files/f");
    }
    #[test]
    fn repeated_large_block_is_rejected_before_full_expansion() {
        let (a, mut t, mut b) = data();
        b[0]["content"] = json!("x".repeat(8 * 1024 * 1024));
        let m = t[0]["messages"][0].clone();
        t[0]["messages"] = json!((0..9)
            .map(|i| {
                let mut m = m.clone();
                m["id"] = json!(format!("m{i}"));
                m
            })
            .collect::<Vec<_>>());
        assert!(normalize(a, t, b).is_err())
    }
    #[test]
    fn variable_prefix_ids_are_little_endian() {
        assert!(prefix(&[0x24, 1, 2, 3, 4, 1]).unwrap() == (513, 1027, 1, 6))
    }
}
