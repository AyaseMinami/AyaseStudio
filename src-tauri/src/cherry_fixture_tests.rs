//! End-to-end synthetic Chromium backup fixtures. No user data or credentials.
use super::Session;
use serde_json::{json, Value};
use std::io::Write;

const IDB: &str = "IndexedDB/file__0.indexeddb.leveldb";
const LOCAL: &str = "Local Storage/leveldb";
const FILE: &str = "Data/Files/f.txt";
const SECRET: &str = "SYNTHETIC_PROVIDER_SECRET_MUST_NOT_CROSS_IPC";

fn varint(mut value: u64, output: &mut Vec<u8>) {
    while value >= 128 {
        output.push((value as u8 & 127) | 128);
        value >>= 7;
    }
    output.push(value as u8);
}
fn field(value: &[u8], output: &mut Vec<u8>) {
    varint(value.len() as u64, output);
    output.extend_from_slice(value);
}
fn utf16(value: &str, little_endian: bool) -> Vec<u8> {
    value
        .encode_utf16()
        .flat_map(|v| {
            if little_endian {
                v.to_le_bytes()
            } else {
                v.to_be_bytes()
            }
        })
        .collect()
}
fn indexed_string(value: &str, output: &mut Vec<u8>) {
    varint(value.encode_utf16().count() as u64, output);
    output.extend_from_slice(&utf16(value, false));
}

fn structured_value(value: &Value, output: &mut Vec<u8>) {
    match value {
        Value::Null => output.push(b'0'),
        Value::Bool(v) => output.push(if *v { b'T' } else { b'F' }),
        Value::Number(v) => {
            if let Some(n) = v.as_i64().and_then(|v| i32::try_from(v).ok()) {
                output.push(b'I');
                varint(((n << 1) ^ (n >> 31)) as u32 as u64, output);
            } else {
                output.push(b'N');
                output.extend_from_slice(&v.as_f64().unwrap().to_le_bytes());
            }
        }
        Value::String(v) => {
            if v.is_ascii() {
                output.push(b'"');
                field(v.as_bytes(), output);
            } else {
                output.push(0); // Blink/V8 padding before a two-byte string.
                output.push(b'c');
                field(&utf16(v, true), output);
            }
        }
        Value::Array(values) => {
            output.push(b'A');
            varint(values.len() as u64, output);
            for value in values {
                structured_value(value, output);
            }
            output.push(b'$');
            varint(0, output);
            varint(values.len() as u64, output);
        }
        Value::Object(values) => {
            output.push(b'o');
            for (key, value) in values {
                structured_value(&json!(key), output);
                structured_value(value, output);
            }
            output.push(b'{');
            varint(values.len() as u64, output);
        }
    }
}
fn indexed_record(store: u8, id: &str, value: &Value) -> (Vec<u8>, Vec<u8>) {
    let mut key = vec![0, 1, store, 1, 1];
    indexed_string(id, &mut key);
    let mut data = vec![1, 255, 17, 255, 15]; // record version, Blink version, V8 version
    structured_value(value, &mut data);
    (key, data)
}
fn full_record(payload: &[u8]) -> Vec<u8> {
    assert!(payload.len() < 32761);
    let mut checksum = vec![1];
    checksum.extend_from_slice(payload);
    let checksum = crc32c::crc32c(&checksum)
        .rotate_left(17)
        .wrapping_add(0xa282ead8);
    let mut record = checksum.to_le_bytes().to_vec();
    record.extend_from_slice(&(payload.len() as u16).to_le_bytes());
    record.push(1);
    record.extend_from_slice(payload);
    record
}
fn batch(sequence: u64, records: &[(Vec<u8>, Option<Vec<u8>>)]) -> Vec<u8> {
    let mut payload = sequence.to_le_bytes().to_vec();
    payload.extend_from_slice(&(records.len() as u32).to_le_bytes());
    for (key, value) in records {
        payload.push(u8::from(value.is_some()));
        field(key, &mut payload);
        if let Some(value) = value {
            field(value, &mut payload);
        }
    }
    full_record(&payload)
}

fn data() -> (Vec<Value>, Value, Vec<Value>, String) {
    let assistants = vec![json!({"id":"a","name":"合成助手","topics":[{
        "id":"t","name":"合成对话","assistantId":"a",
        "createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:01Z"
    }]})];
    let topic = json!({"id":"t","messages":[
        {"id":"u","role":"user","topicId":"t","assistantId":"a","createdAt":"2026-01-01T00:00:00Z","status":"success","blocks":["user-text"]},
        {"id":"m","role":"assistant","topicId":"t","assistantId":"a","askId":"u","createdAt":"2026-01-01T00:00:01Z","status":"success","blocks":["answer-text","thinking","attachment"]}
    ]});
    let blocks = vec![
        json!({"id":"user-text","type":"main_text","content":"合成提问"}),
        json!({"id":"answer-text","type":"main_text","content":"合成回答"}),
        json!({"id":"thinking","type":"thinking","content":"合成思考"}),
        json!({"id":"attachment","type":"file","file":{"id":"f","origin_name":"note.txt","ext":".txt","size":4}}),
    ];
    let persisted = json!({"assistants":json!({"assistants":assistants}).to_string(),"providers":json!({"apiKey":SECRET}).to_string()}).to_string();
    (assistants, topic, blocks, persisted)
}

fn leveldb_entries(directory: &str, wal: Vec<u8>) -> Vec<(String, Vec<u8>)> {
    vec![
        (
            format!("{directory}/CURRENT"),
            b"MANIFEST-000001\n".to_vec(),
        ),
        (format!("{directory}/MANIFEST-000001"), full_record(&[2, 2])),
        (format!("{directory}/000002.log"), wal),
    ]
}
fn storage_record(key: &str, value: &str) -> (Vec<u8>, Option<Vec<u8>>) {
    let mut encoded_key = b"_file://\0\x01".to_vec();
    encoded_key.extend_from_slice(key.as_bytes());
    let mut encoded_value = vec![0];
    encoded_value.extend_from_slice(&utf16(value, true));
    (encoded_key, Some(encoded_value))
}
fn format6_entries() -> Vec<(String, Vec<u8>)> {
    let (_, topic, blocks, persisted) = data();
    let mut metadata_key = vec![0, 0, 0, 0, 201];
    indexed_string("file://", &mut metadata_key);
    indexed_string("CherryStudio", &mut metadata_key);
    let mut records = vec![
        (metadata_key, Some(vec![1])),
        (vec![0, 1, 0, 0, 50, 1, 0], Some(utf16("topics", false))),
        (
            vec![0, 1, 0, 0, 50, 2, 0],
            Some(utf16("message_blocks", false)),
        ),
    ];
    let (key, value) = indexed_record(1, "t", &topic);
    records.push((key, Some(value)));
    for block in blocks {
        let (key, value) = indexed_record(2, block["id"].as_str().unwrap(), &block);
        records.push((key, Some(value)));
    }
    let mut entries = vec![
        (
            "metadata.json".to_owned(),
            serde_json::to_vec(
                &json!({"appName":"Cherry Studio","version":6,"appVersion":"1.9.13"}),
            )
            .unwrap(),
        ),
        (FILE.to_owned(), b"note".to_vec()),
    ];
    entries.extend(leveldb_entries(IDB, batch(100, &records)));
    entries.extend(leveldb_entries(
        LOCAL,
        batch(
            100,
            &[
                storage_record("persist:cherry-studio", &persisted),
                storage_record(
                    "persist:synthetic-provider",
                    &json!({"apiKey":SECRET}).to_string(),
                ),
            ],
        ),
    ));
    entries
}
fn zip(entries: Vec<(String, Vec<u8>)>) -> tempfile::NamedTempFile {
    let file = tempfile::NamedTempFile::new().unwrap();
    let mut writer = zip::ZipWriter::new(file.reopen().unwrap());
    for (key, bytes) in entries {
        writer
            .start_file(key, zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(&bytes).unwrap();
    }
    writer.finish().unwrap();
    file
}
fn semantics(mut value: Value) -> Value {
    for key in ["source", "token", "format", "appVersion"] {
        value.as_object_mut().unwrap().remove(key);
    }
    value
}

#[test]
fn format6_chromium_snapshot_matches_format5_and_restores_internal_file() {
    let mut entries = format6_entries();
    // v6 SQLite may be stale; its presence must never change the authoritative source.
    let database = crate::cherry_sqlite::synthetic_database();
    entries.push((
        "Data/cherrystudio.sqlite".to_owned(),
        std::fs::read(database.path()).unwrap(),
    ));
    let archive = zip(entries);
    let mut session = Session::open(archive.path()).unwrap();
    let preview = session.preview().unwrap();
    assert_eq!(preview["format"], 6);
    assert_eq!(preview["source"], "legacy-chromium");
    assert_eq!(preview["appVersion"], "1.9.13");
    assert_eq!(preview["topics"].as_array().unwrap().len(), 1);
    assert_eq!(
        preview["topics"][0]["messages"].as_array().unwrap().len(),
        2
    );
    let parts = &preview["topics"][0]["messages"][1]["parts"];
    assert_eq!(parts[0], json!({"type":"text","text":"合成回答"}));
    assert_eq!(parts[1], json!({"type":"thinking","text":"合成思考"}));
    assert_eq!(parts[2]["available"], true);
    assert!(!preview.to_string().contains(SECRET));
    let attachment = session.file(FILE).unwrap().unwrap();
    assert_eq!(
        attachment,
        json!({"name":"note.txt","mimeType":"text/plain","size":4,"data":"bm90ZQ=="})
    );
    let (_, topic, blocks, persisted) = data();
    let legacy = json!({"version":5,"localStorage":{"persist:cherry-studio":persisted,"persist:synthetic-provider":SECRET},"indexedDB":{"topics":[topic],"message_blocks":blocks}});
    let legacy_zip = zip(vec![
        ("data.json".to_owned(), serde_json::to_vec(&legacy).unwrap()),
        (FILE.to_owned(), b"note".to_vec()),
    ]);
    let legacy_preview = Session::open(legacy_zip.path()).unwrap().preview().unwrap();
    assert_eq!(semantics(preview), semantics(legacy_preview));
}

#[test]
fn format6_missing_current_wal_or_corrupt_checksum_rejects() {
    for directory in [IDB, LOCAL] {
        let mut entries = format6_entries();
        entries.retain(|(key, _)| key != &format!("{directory}/000002.log"));
        let archive = zip(entries);
        assert!(Session::open(archive.path()).unwrap().preview().is_err());
        let mut entries = format6_entries();
        entries
            .iter_mut()
            .find(|(key, _)| key == &format!("{directory}/000002.log"))
            .unwrap()
            .1[0] ^= 1;
        let archive = zip(entries);
        assert!(Session::open(archive.path()).unwrap().preview().is_err());
    }
}

#[test]
fn format6_latest_tombstone_never_resurrects_old_content_block() {
    let mut entries = format6_entries();
    let (key, _) = indexed_record(2, "answer-text", &Value::Null);
    let tombstone = batch(1000, &[(key, None)]);
    entries
        .iter_mut()
        .find(|(key, _)| key == &format!("{IDB}/000002.log"))
        .unwrap()
        .1
        .extend_from_slice(&tombstone);
    let archive = zip(entries);
    let error = Session::open(archive.path())
        .unwrap()
        .preview()
        .unwrap_err();
    assert_eq!(error, "cherry-missing-block");
}

#[test]
fn format6_manifest_excludes_obsolete_wal_and_current_values_override_previous() {
    for previous_selected in [false, true] {
        let mut entries = format6_entries();
        let stale =
            json!({"id":"answer-text","type":"main_text","content":"STALE_TEXT_MUST_NOT_IMPORT"});
        let (key, value) = indexed_record(2, "answer-text", &stale);
        // A selected previous WAL has an older sequence. An obsolete WAL is
        // excluded even when its sequence is greater than the live snapshot.
        let sequence = if previous_selected { 1 } else { 9999 };
        entries.push((
            format!("{IDB}/000001.log"),
            batch(sequence, &[(key, Some(value))]),
        ));
        if previous_selected {
            entries
                .iter_mut()
                .find(|(key, _)| key == &format!("{IDB}/MANIFEST-000001"))
                .unwrap()
                .1 = full_record(&[2, 2, 9, 1]);
        }
        let archive = zip(entries);
        let preview = Session::open(archive.path()).unwrap().preview().unwrap();
        assert_eq!(
            preview["topics"][0]["messages"][1]["parts"][0]["text"],
            "合成回答"
        );
        assert!(!preview.to_string().contains("STALE_TEXT_MUST_NOT_IMPORT"));
    }
}
