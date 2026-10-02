//! Chat-only projection of the pinned Cherry Studio 2.1.3 SQLite format.
//! Never executes SQL from the backup or reads configuration/provider tables.
use rusqlite::{Connection, OpenFlags, Row};
use serde_json::{Map, Value, json};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

const INVALID: &str = "Cherry Studio 数据库损坏或聊天数据格式不受支持。";
const LIMIT: &str = "Cherry Studio 聊天数据超过导入限制。";
const MAX_FIELD: i64 = 8 * 1024 * 1024;
const MAX_TOTAL: i64 = 256 * 1024 * 1024;
const MAX_PARTS: usize = 200_000;
const MAX_PROJECTED: usize = 64 * 1024 * 1024;
const RECOVERED: &str = "ayase-cherry-recovered-assistant";
// SHA-256 of official migration SQL bytes at source commit
// 3b397393b129558dcfadfaf4141e2a2395ac5eeb (Cherry Studio v2.1.3).
// These are recognition data only; the SQL is neither included nor executed.
const MIGRATIONS: &[(i64, &str)] = &[
    (
        1785247785125,
        "a387701b5218337d62e27cb772d2ef180475b9a73515cb12063141340c7e8b86",
    ),
    (
        1785308910164,
        "10f7c16c14012ad3f65368b57dbe898105e63e941523b0e6aafdeba9c6bfbe5f",
    ),
    (
        1785476603915,
        "154f5ccae0549e2dade4c4a63807d717e2cabf524062a98a09f041111518208d",
    ),
    (
        1785514531244,
        "914b1309403cdf89d22e8fe8909c80d23f0898da49fc1c6bd2c43244b71284fe",
    ),
    (
        1785735707223,
        "567ac679aa54ae7da0aedc3bb5ce20c188acfcc00487a263962b8054c5efa69b",
    ),
    (
        1785848624191,
        "841ad622d6347c1cbd4c6f674c8a6db1006e1e723a194c5d211dbaeb53d43358",
    ),
    (
        1786013632736,
        "161f94c84d82b06bf1977dfb7a6309e4ab1c633a950209a0cca05302c0350f2b",
    ),
    (
        1786425204352,
        "8906e2ad912ef43b4cf0cc2e501b029842157941368dcaff0975d5feb65f49b1",
    ),
    (
        1786608214102,
        "be497d968327b36376b404ec0b6b235228f34f6679ab9224f8acb73e4cd8c05a",
    ),
    (
        1787037314810,
        "d5c90a1dc9202afc97ae8f47c46b1b739c984336b11d45210778104c636ac90b",
    ),
    (
        1787057424225,
        "5f0dae30b0df3bcb6c2df0cafa7b9490d838e924ec23eb5ac6fe4c48d663b5c0",
    ),
    (
        1787109711737,
        "d9517b8dee805247150ec7ca523af85a951ecdaf55f834ec83e6457044a2314d",
    ),
    (
        1787286408660,
        "0c52bae6f9c49d948280bb50f9465bd36a55d0d7667dd36c7ee17c10b18d07b7",
    ),
    (
        1787345194710,
        "15228f965dc59124a656c17f50aba4a2678551e840fb5fda3b7f90ca9a6cb8b8",
    ),
    (
        1787384459769,
        "70b26724581d824f4584d297bb0e4d29dec43ffef4a0f57329241933337b885f",
    ),
    (
        1787387094750,
        "1868e1058d8d42b0b4cd8ad4431edd0eeefc956dd4945bdff8ee74ee2d509433",
    ),
    (
        1787514273959,
        "6553338a5a46fddf19a15c6b0dddf9574e98fa94ad675b936931746e3c40701d",
    ),
    (
        1787715649955,
        "99ea57b4f42767bea1e125b3e19d952a84b3c133e8500ed90b9b2c5a1a71b7f8",
    ),
    (
        1787913871613,
        "4cf43366f37abc8f7bc50ae0f4edfe6cd3477611d27ea5294499f9e2371ef0df",
    ),
    (
        1788241355850,
        "e579340501eb351106590e8baa184835f28eac760958b99d37643dbc5785d104",
    ),
    (
        1788247231321,
        "2210a32a8593f6280829502e5fa1baaf1ad4d5fdf04b4251c108610706aed51c",
    ),
    (
        1788332276777,
        "8ad4ea9be87df34972cb68d6086c3c1edd682d7f2de9a27cd70a09739ec2fe3d",
    ),
    (
        1789544579690,
        "7dd25d28b5f105ba6c15d5013ef6971c9e5dc635435ee2f20a97fa5c08944950",
    ),
    (
        1789565251208,
        "74c16e0849439560ed4a0972cedf8c2a01359afc5dde02d4c4266ff9e6750a6a",
    ),
    (
        1789636472109,
        "bd0fe2163f13ac460785bac5a93623401c6e62abed2d3c7081a8fceded76f8db",
    ),
    (
        1790186132435,
        "bcc50f3331f370330bd8110c1896a3d3732401b9e4eb28b55ee790d291718a93",
    ),
];

fn db<T>(result: rusqlite::Result<T>) -> Result<T, String> {
    result.map_err(|_| INVALID.to_owned())
}

pub(crate) fn read_sqlite(path: &Path) -> Result<Value, String> {
    let absolute = path.canonicalize().map_err(|_| INVALID.to_owned())?;
    let text = absolute
        .to_str()
        .ok_or(INVALID)?
        .trim_start_matches(r"\\?\")
        .replace('\\', "/");
    // Encode URI metacharacters so even a '?' in the temporary filename cannot
    // override mode/immutable. Windows drive paths need the leading slash.
    let mut uri = if text.starts_with('/') {
        "file:".to_owned()
    } else {
        "file:/".to_owned()
    };
    for b in text.bytes() {
        if b.is_ascii_alphanumeric() || b"/-_.:".contains(&b) {
            uri.push(b as char);
        } else {
            uri.push_str(&format!("%{b:02X}"));
        }
    }
    uri.push_str("?mode=ro&immutable=1");
    let connection = db(Connection::open_with_flags(
        uri,
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_URI,
    ))?;
    db(connection.execute_batch("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;"))?;
    read_connection(&connection)
}

fn schema(connection: &Connection, table: &str, required: &[(&str, &str)]) -> Result<(), String> {
    let ordinary: i64 = db(connection.query_row(
        "SELECT count(*) FROM pragma_table_list() WHERE schema='main' AND name=?1 AND type='table'",
        [table],
        |r| r.get(0),
    ))?;
    if ordinary != 1 {
        return Err(INVALID.to_owned());
    }
    let mut stmt =
        db(connection.prepare("SELECT name, type, hidden FROM pragma_table_xinfo(?1) LIMIT 201"))?;
    let rows = db(stmt.query_map([table], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, i64>(2)?,
        ))
    }))?;
    let mut columns = HashMap::new();
    for row in rows {
        let (name, ty, hidden) = db(row)?;
        if hidden != 0 {
            return Err(INVALID.to_owned());
        }
        columns.insert(name, ty.to_ascii_uppercase());
    }
    if columns.len() > 200
        || required
            .iter()
            .any(|(n, t)| columns.get(*n).map(String::as_str) != Some(*t))
    {
        return Err(INVALID.to_owned());
    }
    Ok(())
}

fn preflight(
    connection: &Connection,
    table: &str,
    fields: &[&str],
    limit: i64,
    total: &mut i64,
) -> Result<(), String> {
    // All identifiers come from this module's fixed whitelist, never the DB.
    let count: i64 = db(connection.query_row(
        &format!("SELECT count(*) FROM {table} WHERE deleted_at IS NULL"),
        [],
        |r| r.get(0),
    ))?;
    if count > limit {
        return Err(LIMIT.to_owned());
    }
    let lengths: Vec<_> = fields
        .iter()
        .map(|f| format!("coalesce(length(CAST({f} AS BLOB)),0)"))
        .collect();
    let oversized: i64 = db(connection.query_row(
        &format!(
            "SELECT count(*) FROM {table} WHERE deleted_at IS NULL AND ({})",
            lengths
                .iter()
                .map(|s| format!("{s}>{MAX_FIELD}"))
                .collect::<Vec<_>>()
                .join(" OR ")
        ),
        [],
        |r| r.get(0),
    ))?;
    if oversized != 0 {
        return Err(LIMIT.to_owned());
    }
    let bytes: i64 = db(connection.query_row(
        &format!(
            "SELECT coalesce(sum({}),0) FROM {table} WHERE deleted_at IS NULL",
            lengths.join("+")
        ),
        [],
        |r| r.get(0),
    ))?;
    *total = total.checked_add(bytes).ok_or(LIMIT)?;
    if *total > MAX_TOTAL {
        return Err(LIMIT.to_owned());
    }
    Ok(())
}

fn identity(value: String, seen: &mut HashSet<String>) -> Result<String, String> {
    if value.is_empty()
        || value.len() > 256
        || value.chars().any(char::is_control)
        || !seen.insert(value.clone())
    {
        return Err(INVALID.to_owned());
    }
    Ok(value)
}
fn timestamp(row: &Row<'_>, index: usize) -> Result<i64, String> {
    let value: i64 = db(row.get(index))?;
    if !(0..=9_007_199_254_740_991).contains(&value) {
        return Err(INVALID.to_owned());
    }
    Ok(value)
}
fn warning(warnings: &mut Vec<&'static str>, text: &'static str) {
    if !warnings.contains(&text) {
        warnings.push(text);
    }
}

#[derive(Default)]
struct ProjectionBudget {
    parts: usize,
    bytes: usize,
}
impl ProjectionBudget {
    fn parts(&mut self, count: usize) -> Result<(), String> {
        let total = self.parts.checked_add(count).ok_or(LIMIT)?;
        if total > MAX_PARTS {
            return Err(LIMIT.to_owned());
        }
        self.parts = total;
        Ok(())
    }
    fn bytes(&mut self, count: usize) -> Result<(), String> {
        let total = self.bytes.checked_add(count).ok_or(LIMIT)?;
        if total > MAX_PROJECTED {
            return Err(LIMIT.to_owned());
        }
        self.bytes = total;
        Ok(())
    }
    fn text(&mut self, count: usize) -> Result<(), String> {
        if count > MAX_FIELD as usize {
            return Err(LIMIT.to_owned());
        }
        self.bytes(count)
    }
}

fn read_connection(c: &Connection) -> Result<Value, String> {
    schema(
        c,
        "assistant",
        &[("id", "TEXT"), ("name", "TEXT"), ("deleted_at", "INTEGER")],
    )?;
    schema(
        c,
        "topic",
        &[
            ("id", "TEXT"),
            ("name", "TEXT"),
            ("assistant_id", "TEXT"),
            ("active_node_id", "TEXT"),
            ("created_at", "INTEGER"),
            ("updated_at", "INTEGER"),
            ("deleted_at", "INTEGER"),
        ],
    )?;
    schema(
        c,
        "message",
        &[
            ("id", "TEXT"),
            ("topic_id", "TEXT"),
            ("parent_id", "TEXT"),
            ("role", "TEXT"),
            ("status", "TEXT"),
            ("data", "TEXT"),
            ("created_at", "INTEGER"),
            ("deleted_at", "INTEGER"),
        ],
    )?;
    schema(
        c,
        "file_entry",
        &[
            ("id", "TEXT"),
            ("name", "TEXT"),
            ("origin", "TEXT"),
            ("ext", "TEXT"),
            ("size", "INTEGER"),
            ("deleted_at", "INTEGER"),
        ],
    )?;
    schema(
        c,
        "__drizzle_migrations",
        &[("hash", "TEXT"), ("created_at", "NUMERIC")],
    )?;
    let history_count: i64 = db(c.query_row(
        "SELECT count(*) FROM __drizzle_migrations",
        [],
        |r| r.get(0),
    ))?;
    let invalid_history: i64 = db(c.query_row(
        "SELECT count(*) FROM __drizzle_migrations WHERE typeof(hash)!='text' OR length(CAST(hash AS BLOB))!=64 OR typeof(created_at)!='integer'",
        [],
        |r| r.get(0),
    ))?;
    if history_count != MIGRATIONS.len() as i64 || invalid_history != 0 {
        return Err(INVALID.to_owned());
    }
    let mut migrations = db(c.prepare(
        "SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at LIMIT 27",
    ))?;
    let rows = db(migrations.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))))?;
    let mut index = 0;
    for row in rows {
        let (hash, time) = db(row)?;
        if MIGRATIONS.get(index).copied() != Some((time, hash.as_str())) {
            return Err(INVALID.to_owned());
        }
        index += 1;
    }
    if index != MIGRATIONS.len() {
        return Err(INVALID.to_owned());
    }
    let mut total = 0;
    preflight(c, "assistant", &["id", "name"], 5000, &mut total)?;
    preflight(
        c,
        "topic",
        &[
            "id",
            "name",
            "assistant_id",
            "active_node_id",
            "created_at",
            "updated_at",
        ],
        10000,
        &mut total,
    )?;
    preflight(
        c,
        "message",
        &[
            "id",
            "topic_id",
            "parent_id",
            "role",
            "status",
            "data",
            "created_at",
        ],
        100000,
        &mut total,
    )?;
    preflight(
        c,
        "file_entry",
        &["id", "name", "origin", "ext", "size"],
        100000,
        &mut total,
    )?;
    let mut warnings = Vec::new();
    let mut assistants = Vec::new();
    let mut assistant_ids = HashSet::new();
    let mut stmt =
        db(c.prepare("SELECT id,name FROM assistant WHERE deleted_at IS NULL ORDER BY id"))?;
    let mut rows = db(stmt.query([]))?;
    while let Some(r) = db(rows.next())? {
        let id = identity(db(r.get(0))?, &mut assistant_ids)?;
        assistants.push(json!({"id":id,"name":db(r.get::<_,String>(1))?}));
    }
    // A source cannot impersonate the recovery identity.
    let mut recovered_id = RECOVERED.to_owned();
    while assistant_ids.contains(&recovered_id) {
        recovered_id.push('_');
    }
    let mut topics = Vec::new();
    let mut topic_indices = HashMap::new();
    let mut topic_ids = HashSet::new();
    let mut recovered = false;
    let mut stmt = db(c.prepare("SELECT id,assistant_id,name,created_at,updated_at,active_node_id FROM topic WHERE deleted_at IS NULL ORDER BY created_at,id"))?;
    let mut rows = db(stmt.query([]))?;
    while let Some(r) = db(rows.next())? {
        let id = identity(db(r.get(0))?, &mut topic_ids)?;
        let owner: Option<String> = db(r.get(1))?;
        let owner = match owner {
            Some(v) if assistant_ids.contains(&v) => v,
            _ => {
                recovered = true;
                warning(
                    &mut warnings,
                    "部分对话的助手已缺失，已归入恢复的对话分组。",
                );
                recovered_id.clone()
            }
        };
        topic_indices.insert(id.clone(), topics.len());
        topics.push(json!({"id":id,"assistantId":owner,"title":db(r.get::<_,String>(2))?,"createdAt":timestamp(r,3)?,"updatedAt":timestamp(r,4)?,"activeNodeId":db(r.get::<_,Option<String>>(5))?,"messages":[]}));
    }
    if recovered {
        if assistants.len() >= 5000 {
            return Err(LIMIT.to_owned());
        }
        assistants.push(json!({"id":recovered_id,"name":"Cherry Studio 恢复的对话"}));
    }
    let mut file_ids = HashSet::new();
    let mut file_entries = HashMap::new();
    let mut stmt = db(c.prepare(
        "SELECT id,name,ext,size,origin FROM file_entry WHERE deleted_at IS NULL ORDER BY id",
    ))?;
    let mut rows = db(stmt.query([]))?;
    while let Some(r) = db(rows.next())? {
        let id = identity(db(r.get(0))?, &mut file_ids)?;
        let name: String = db(r.get(1))?;
        let ext: Option<String> = db(r.get(2))?;
        let size: Option<i64> = db(r.get(3))?;
        let origin: String = db(r.get(4))?;
        if !["internal", "external"].contains(&origin.as_str())
            || uuid::Uuid::parse_str(&id).is_err()
            || id.len() != 36
            || !safe_name(&name)
            || ext.as_deref().is_some_and(|v| {
                v.len() > 32
                    || !v
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            })
        {
            return Err(INVALID.to_owned());
        }
        let recoverable = origin == "internal";
        let size = if recoverable {
            size
        } else {
            Some(size.unwrap_or(0))
        }
        .filter(|v| *v >= 0 && *v <= 9_007_199_254_740_991)
        .ok_or(INVALID)?;
        let suffix = ext
            .filter(|v| !v.is_empty())
            .map(|v| format!(".{v}"))
            .unwrap_or_default();
        file_entries.insert(
            id.clone(),
            (
                format!("Data/Files/{id}{suffix}"),
                format!("{name}{suffix}"),
                size,
                recoverable,
            ),
        );
    }
    let mut files = Map::new();
    let mut projection_budget = ProjectionBudget::default();
    let mut message_ids = HashSet::new();
    let mut stmt = db(c.prepare("SELECT id,topic_id,parent_id,role,status,data,created_at FROM message WHERE deleted_at IS NULL AND topic_id NOT IN (SELECT id FROM topic WHERE deleted_at IS NOT NULL) ORDER BY created_at,id"))?;
    let mut rows = db(stmt.query([]))?;
    while let Some(r) = db(rows.next())? {
        let id = identity(db(r.get(0))?, &mut message_ids)?;
        let topic: String = db(r.get(1))?;
        let index = *topic_indices.get(&topic).ok_or(INVALID)?;
        let role: String = db(r.get(3))?;
        if !["user", "assistant", "system", "root"].contains(&role.as_str()) {
            return Err(INVALID.to_owned());
        }
        let status: String = db(r.get(4))?;
        let status = match status.as_str() {
            "success" => "complete",
            "pending" => "incomplete",
            "paused" => "paused",
            "error" => "failed",
            _ => return Err(INVALID.to_owned()),
        };
        let raw: String = db(r.get(5))?;
        let data: Value = serde_json::from_str(&raw).map_err(|_| INVALID.to_owned())?;
        let parts = project_parts(
            &data,
            &file_entries,
            &mut files,
            &mut warnings,
            &mut projection_budget,
        )?;
        let message = json!({"id":id,"parentId":db(r.get::<_,Option<String>>(2))?,"role":role,"status":status,"createdAt":timestamp(r,6)?,"parts":parts});
        topics[index]["messages"]
            .as_array_mut()
            .ok_or(INVALID)?
            .push(message);
    }
    Ok(json!({"assistants":assistants,"topics":topics,"warnings":warnings,"files":files}))
}

fn safe_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 1024
        && !value.chars().any(|c| c.is_control() || "/\\:".contains(c))
        && value != "."
        && value != ".."
}

fn project_parts(
    data: &Value,
    entries: &HashMap<String, (String, String, i64, bool)>,
    files: &mut Map<String, Value>,
    warnings: &mut Vec<&'static str>,
    budget: &mut ProjectionBudget,
) -> Result<Vec<Value>, String> {
    let object = data.as_object().ok_or(INVALID)?;
    let empty = Vec::new();
    let parts = match object.get("parts") {
        None => &empty,
        Some(v) => v.as_array().ok_or(INVALID)?,
    };
    budget.parts(parts.len())?;
    let mut out = Vec::new();
    for part in parts {
        let kind = part.get("type").and_then(Value::as_str).ok_or(INVALID)?;
        match kind {
            "text" | "reasoning" => {
                let text = part.get("text").and_then(Value::as_str).ok_or(INVALID)?;
                budget.text(text.len())?;
                out.push(json!({"type":if kind=="text" {"text"} else {"thinking"},"text":text}));
            }
            "data-code" => {
                let text = part
                    .pointer("/data/content")
                    .and_then(Value::as_str)
                    .ok_or(INVALID)?;
                let language = part
                    .pointer("/data/language")
                    .and_then(Value::as_str)
                    .ok_or(INVALID)?;
                if language.len() > 64
                    || !language
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || b"_+-#.".contains(&c))
                {
                    return Err(INVALID.to_owned());
                }
                // A longer fence prevents source content from closing the block.
                let longest = text.split(|c| c != '`').map(str::len).max().unwrap_or(0);
                let fence_len = 3.max(longest.checked_add(1).ok_or(LIMIT)?);
                let emitted_len = fence_len
                    .checked_mul(2)
                    .and_then(|v| v.checked_add(text.len()))
                    .and_then(|v| v.checked_add(language.len()))
                    .and_then(|v| v.checked_add(2))
                    .ok_or(LIMIT)?;
                budget.text(emitted_len)?;
                let fence = "`".repeat(fence_len);
                out.push(
                    json!({"type":"text","text":format!("{fence}{language}\n{text}\n{fence}")}),
                );
            }
            "file" => {
                let entry = part
                    .pointer("/providerMetadata/cherry/fileEntryId")
                    .and_then(Value::as_str)
                    .and_then(|id| entries.get(id));
                if let Some((key, name, size, recoverable)) = entry {
                    let mut metadata_len = key.len().checked_add(name.len()).ok_or(LIMIT)?;
                    if !files.contains_key(key) {
                        metadata_len = metadata_len.checked_mul(2).ok_or(LIMIT)?;
                    }
                    budget.bytes(metadata_len)?;
                    let mut descriptor = json!({"name":name,"size":size});
                    if !recoverable {
                        descriptor["recoverable"] = json!(false);
                        warning(
                            warnings,
                            "部分附件为外部文件，仅保留文件名，未导入附件内容。",
                        );
                    }
                    files.insert(key.clone(), descriptor);
                    out.push(json!({"type":"file","fileKey":key,"name":name}));
                } else {
                    warning(warnings, "部分附件缺失，已跳过附件内容。");
                    out.push(json!({"type":"unsupported"}));
                }
            }
            _ => {
                warning(
                    warnings,
                    "部分消息包含不支持的工具、引用或其他内容，已跳过这些部分。",
                );
                out.push(json!({"type":"unsupported"}));
            }
        }
    }
    Ok(out)
}

/// Chat-only synthetic database for the native archive/session integration tests.
#[cfg(test)]
pub(crate) fn synthetic_database() -> tempfile::NamedTempFile {
    let file = tempfile::NamedTempFile::new().unwrap();
    let c = tests::fixture();
    c.execute_batch("INSERT INTO message VALUES('u','t','root','user','success','{\"parts\":[{\"type\":\"text\",\"text\":\"合成提问\"}]}',1,NULL);").unwrap();
    c.execute(
        "INSERT INTO file_entry VALUES(?1,'note','internal','txt',4,NULL,NULL)",
        [tests::FILE_ID],
    )
    .unwrap();
    tests::message(
        &c,
        json!({"parts":[
            {"type":"text","text":"合成聊天正文"},
            {"type":"file","providerMetadata":{"cherry":{"fileEntryId":tests::FILE_ID}}}
        ]}),
    );
    c.execute_batch("UPDATE message SET parent_id='u',created_at=2 WHERE id='m';")
        .unwrap();
    let quoted = file.path().to_str().unwrap().replace('\'', "''");
    c.execute_batch(&format!("VACUUM INTO '{quoted}'")).unwrap();
    file
}

#[cfg(test)]
mod tests {
    use super::*;
    pub(super) const FILE_ID: &str = "11111111-1111-4111-8111-111111111111";

    pub(super) fn fixture() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE assistant(id TEXT,name TEXT,deleted_at INTEGER,settings TEXT);
            CREATE TABLE topic(id TEXT,name TEXT,assistant_id TEXT,active_node_id TEXT,created_at INTEGER,updated_at INTEGER,deleted_at INTEGER);
            CREATE TABLE message(id TEXT,topic_id TEXT,parent_id TEXT,role TEXT,status TEXT,data TEXT,created_at INTEGER,deleted_at INTEGER);
            CREATE TABLE file_entry(id TEXT,name TEXT,origin TEXT,ext TEXT,size INTEGER,deleted_at INTEGER,external_path TEXT);
            CREATE TABLE __drizzle_migrations(id INTEGER PRIMARY KEY,hash TEXT,created_at NUMERIC);
            CREATE TABLE user_provider(id TEXT,api_key TEXT);
            INSERT INTO user_provider VALUES('provider','FAKE_PRIVATE_CREDENTIAL');
            INSERT INTO assistant VALUES('a','助手',NULL,'FAKE_PRIVATE_SETTINGS');
            INSERT INTO topic VALUES('t','对话','a','m',1,2,NULL);
            INSERT INTO message VALUES('root','t',NULL,'root','success','{}',0,NULL);") .unwrap();
        for (time, hash) in MIGRATIONS {
            c.execute(
                "INSERT INTO __drizzle_migrations(hash,created_at) VALUES(?1,?2)",
                rusqlite::params![hash, time],
            )
            .unwrap();
        }
        c
    }
    pub(super) fn message(c: &Connection, data: Value) {
        c.execute(
            "INSERT INTO message VALUES('m','t','root','assistant','success',?1,1,NULL)",
            [data.to_string()],
        )
        .unwrap();
    }

    #[test]
    fn projects_only_chat_fields_and_internal_files() {
        let c = fixture();
        c.execute(
            "INSERT INTO file_entry VALUES(?1,'note','internal','txt',4,NULL,NULL)",
            [FILE_ID],
        )
        .unwrap();
        message(
            &c,
            json!({"parts":[{"type":"text","text":"正文","providerMetadata":{"secret":"FAKE_PRIVATE_METADATA"}}, {"type":"reasoning","text":"思考"}, {"type":"data-code","data":{"content":"```\ncode","language":"rust"}}, {"type":"file","url":"https://never-read.invalid/secret","providerMetadata":{"cherry":{"fileEntryId":FILE_ID}}}, {"type":"tool-secret","input":"FAKE_TOOL_PAYLOAD"}],"turnOptions":{"secret":"FAKE_PRIVATE_TURN"}}),
        );
        let result = read_connection(&c).unwrap();
        let out = result.to_string();
        for private in [
            "FAKE_PRIVATE_CREDENTIAL",
            "FAKE_PRIVATE_SETTINGS",
            "FAKE_PRIVATE_METADATA",
            "FAKE_TOOL_PAYLOAD",
            "FAKE_PRIVATE_TURN",
            "never-read",
        ] {
            assert!(!out.contains(private));
        }
        let parts = &result["topics"][0]["messages"][1]["parts"];
        assert_eq!(parts[0], json!({"type":"text","text":"正文"}));
        assert_eq!(parts[1], json!({"type":"thinking","text":"思考"}));
        assert_eq!(parts[2]["text"], "````rust\n```\ncode\n````");
        assert_eq!(parts[3]["fileKey"], format!("Data/Files/{FILE_ID}.txt"));
        assert_eq!(
            result["files"][format!("Data/Files/{FILE_ID}.txt")],
            json!({"name":"note.txt","size":4})
        );
        assert_eq!(result["warnings"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn immutable_reader_does_not_change_database_or_create_sidecars() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("chat # % ?.sqlite");
        // '?' is not permitted in Windows filenames.
        let path = if cfg!(windows) {
            dir.path().join("chat # %.sqlite")
        } else {
            path
        };
        let c = fixture();
        let quoted = path.to_str().unwrap().replace('\'', "''");
        c.execute_batch(&format!("VACUUM INTO '{quoted}'")).unwrap();
        let before = std::fs::read(&path).unwrap();
        assert_eq!(
            read_sqlite(&path).unwrap()["topics"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(std::fs::read(&path).unwrap(), before);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn synthetic_archive_fixture_is_readable() {
        let file = synthetic_database();
        let result = read_sqlite(file.path()).unwrap();
        assert_eq!(
            result["topics"][0]["messages"][2]["parts"][0]["text"],
            "合成聊天正文"
        );
        assert_eq!(
            result["files"][format!("Data/Files/{FILE_ID}.txt")],
            json!({"name":"note.txt","size":4})
        );
    }

    #[test]
    fn rejects_unknown_missing_or_mismatched_migration_history() {
        for change in [
            "DELETE FROM __drizzle_migrations WHERE id=26",
            "UPDATE __drizzle_migrations SET hash='unknown' WHERE id=1",
            "INSERT INTO __drizzle_migrations(hash,created_at) VALUES('unknown',9999999999999)",
            "UPDATE __drizzle_migrations SET created_at=0 WHERE id=1",
        ] {
            let c = fixture();
            c.execute_batch(change).unwrap();
            assert_eq!(read_connection(&c).unwrap_err(), INVALID);
        }
    }

    #[test]
    fn rejects_missing_schema_views_and_generated_columns() {
        for change in [
            "DROP TABLE topic",
            "ALTER TABLE assistant RENAME TO old_assistant; CREATE VIEW assistant AS SELECT * FROM old_assistant",
            "ALTER TABLE assistant RENAME TO old_assistant; CREATE VIEW assistant AS SELECT * FROM old_assistant; CREATE TABLE pragma_table_list(schema TEXT,name TEXT,type TEXT); INSERT INTO pragma_table_list VALUES('main','assistant','table')",
            "ALTER TABLE assistant ADD COLUMN malicious TEXT GENERATED ALWAYS AS (name) VIRTUAL",
            "DROP TABLE file_entry; CREATE TABLE file_entry(id TEXT,name TEXT,origin TEXT,ext TEXT,size TEXT,deleted_at INTEGER)",
        ] {
            let c = fixture();
            c.execute_batch(change).unwrap();
            assert_eq!(read_connection(&c).unwrap_err(), INVALID);
        }
    }

    #[test]
    fn rejects_malformed_parts_and_unknown_roles_or_statuses() {
        for data in [
            json!([]),
            json!({"parts":null}),
            json!({"parts":[{}]}),
            json!({"parts":[{"type":"text","text":7}]}),
            json!({"parts":[{"type":"data-code","data":{"content":"code","language":"\nurl"}}]}),
        ] {
            let c = fixture();
            message(&c, data);
            assert_eq!(read_connection(&c).unwrap_err(), INVALID);
        }
        for change in [
            "UPDATE message SET role='agent'",
            "UPDATE message SET status='other'",
            "UPDATE message SET data='{not-json'",
            "UPDATE message SET created_at=-1",
        ] {
            let c = fixture();
            c.execute_batch(change).unwrap();
            assert_eq!(read_connection(&c).unwrap_err(), INVALID);
        }
    }

    #[test]
    fn ignores_deleted_records_and_recovers_orphan_assistant_topics() {
        let c = fixture();
        message(&c, json!({"parts":[{"type":"text","text":"keep"}]}));
        c.execute_batch("UPDATE assistant SET deleted_at=3; INSERT INTO topic VALUES('deleted','gone',NULL,NULL,1,2,3);
          INSERT INTO message VALUES('deleted-message','deleted',NULL,'agent','other','invalid',-1,NULL);
          INSERT INTO message VALUES('removed-message','t',NULL,'agent','other','invalid',-1,3);").unwrap();
        let out = read_connection(&c).unwrap();
        assert_eq!(out["assistants"][0]["id"], RECOVERED);
        assert_eq!(out["topics"][0]["assistantId"], RECOVERED);
        assert_eq!(out["topics"].as_array().unwrap().len(), 1);
        assert_eq!(out["topics"][0]["messages"].as_array().unwrap().len(), 2);
        assert_eq!(out["warnings"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn rejects_duplicate_ids_and_orphan_messages() {
        for change in [
            "INSERT INTO assistant SELECT * FROM assistant",
            "INSERT INTO topic SELECT * FROM topic",
            "INSERT INTO message SELECT * FROM message",
            "UPDATE message SET topic_id='missing'",
        ] {
            let c = fixture();
            c.execute_batch(change).unwrap();
            assert_eq!(read_connection(&c).unwrap_err(), INVALID);
        }
    }

    #[test]
    fn enforces_counts_and_byte_limits_before_json_parsing() {
        let c = fixture();
        c.execute_batch("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<5000) INSERT INTO assistant SELECT 'a'||x,'name',NULL,NULL FROM n").unwrap();
        assert_eq!(read_connection(&c).unwrap_err(), LIMIT);
        for (table, limit, insertion) in [
            (
                "topic",
                10000,
                "INSERT INTO topic SELECT 't'||x,'name','a',NULL,1,2,NULL FROM n",
            ),
            (
                "message",
                100000,
                "INSERT INTO message SELECT 'm'||x,'t','root','user','success','{}',1,NULL FROM n",
            ),
            (
                "file_entry",
                100000,
                "INSERT INTO file_entry SELECT 'f'||x,'name','internal',NULL,0,NULL,NULL FROM n",
            ),
        ] {
            let c = fixture();
            c.execute_batch(&format!(
                "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<{}) {}",
                limit + 1,
                insertion
            ))
            .unwrap();
            let mut total = 0;
            assert_eq!(
                preflight(&c, table, &["id"], limit, &mut total).unwrap_err(),
                LIMIT
            );
        }
        let c = fixture();
        c.execute(
            "UPDATE message SET data=?1",
            ["x".repeat(MAX_FIELD as usize + 1)],
        )
        .unwrap();
        assert_eq!(read_connection(&c).unwrap_err(), LIMIT);
        let c = fixture();
        let mut total = MAX_TOTAL;
        assert_eq!(
            preflight(&c, "assistant", &["id", "name"], 5000, &mut total).unwrap_err(),
            LIMIT
        );
    }

    #[test]
    fn rejects_path_file_ids_extensions_and_names() {
        for (id, name, ext) in [
            ("../escape", "note", "txt"),
            (FILE_ID, "../note", "txt"),
            (FILE_ID, "note", "../txt"),
            (FILE_ID, "note", "txt/other"),
        ] {
            let c = fixture();
            c.execute(
                "INSERT INTO file_entry VALUES(?1,?2,'internal',?3,4,NULL,NULL)",
                rusqlite::params![id, name, ext],
            )
            .unwrap();
            assert_eq!(read_connection(&c).unwrap_err(), INVALID);
        }
    }

    #[test]
    fn preserves_external_file_descriptor_without_exposing_paths_or_urls() {
        let c = fixture();
        c.execute("INSERT INTO file_entry VALUES(?1,'private','external','txt',NULL,NULL,'C:/FAKE_PRIVATE_PATH')",[FILE_ID]).unwrap();
        message(
            &c,
            json!({"parts":[{"type":"file","url":"data:FAKE_PRIVATE_DATA","providerMetadata":{"cherry":{"fileEntryId":FILE_ID}}},{"type":"file","url":"file:///FAKE_PRIVATE_PATH","providerMetadata":{"cherry":{"fileEntryId":"missing"}}}]}),
        );
        let result = read_connection(&c).unwrap();
        let key = format!("Data/Files/{FILE_ID}.txt");
        assert_eq!(
            result["files"][&key],
            json!({"name":"private.txt","size":0,"recoverable":false})
        );
        assert!(!result.to_string().contains("FAKE_PRIVATE"));
        assert_eq!(
            result["topics"][0]["messages"][1]["parts"],
            json!([{"type":"file","fileKey":key,"name":"private.txt"},{"type":"unsupported"}])
        );
    }

    #[test]
    fn rejects_unsafe_external_descriptors_and_negative_sizes() {
        for (id, name, ext, size) in [
            ("../escape", "note", "txt", None),
            (FILE_ID, "../note", "txt", None),
            (FILE_ID, "https://private.invalid", "txt", None),
            (FILE_ID, "note", "../txt", None),
            (FILE_ID, "note", "txt", Some(-1)),
        ] {
            let c = fixture();
            c.execute(
                "INSERT INTO file_entry VALUES(?1,?2,'external',?3,?4,NULL,'C:/FAKE_PRIVATE_PATH')",
                rusqlite::params![id, name, ext, size],
            )
            .unwrap();
            assert_eq!(read_connection(&c).unwrap_err(), INVALID);
        }
    }

    #[test]
    fn external_extensionless_descriptor_has_safe_key_and_is_unrecoverable() {
        let c = fixture();
        c.execute("INSERT INTO file_entry VALUES(?1,'note','external',NULL,NULL,NULL,'C:/FAKE_PRIVATE_PATH')",[FILE_ID]).unwrap();
        message(
            &c,
            json!({"parts":[{"type":"file","providerMetadata":{"cherry":{"fileEntryId":FILE_ID}}}]}),
        );
        let result = read_connection(&c).unwrap();
        let key = format!("Data/Files/{FILE_ID}");
        assert_eq!(
            result["files"][&key],
            json!({"name":"note","size":0,"recoverable":false})
        );
        assert_eq!(
            result["topics"][0]["messages"][1]["parts"],
            json!([{"type":"file","fileKey":key,"name":"note"}])
        );
        assert!(!result.to_string().contains("FAKE_PRIVATE"));
    }

    #[test]
    fn preserves_statuses_and_extensionless_internal_files() {
        let c = fixture();
        c.execute(
            "INSERT INTO file_entry VALUES(?1,'note','internal',NULL,4,NULL,NULL)",
            [FILE_ID],
        )
        .unwrap();
        message(
            &c,
            json!({"parts":[{"type":"file","providerMetadata":{"cherry":{"fileEntryId":FILE_ID}}}]}),
        );
        for (source, target) in [
            ("pending", "incomplete"),
            ("paused", "paused"),
            ("error", "failed"),
            ("success", "complete"),
        ] {
            c.execute("UPDATE message SET status=?1 WHERE id='m'", [source])
                .unwrap();
            let result = read_connection(&c).unwrap();
            assert_eq!(result["topics"][0]["messages"][1]["status"], target);
            assert_eq!(
                result["topics"][0]["messages"][1]["parts"][0]["fileKey"],
                format!("Data/Files/{FILE_ID}")
            );
        }
    }

    fn project_for_budget(
        data: &Value,
        budget: &mut ProjectionBudget,
    ) -> Result<Vec<Value>, String> {
        project_parts(
            data,
            &HashMap::new(),
            &mut Map::new(),
            &mut Vec::new(),
            budget,
        )
    }

    #[test]
    fn repeated_tiny_unsupported_parts_reject_before_projection() {
        let data = json!({"parts":vec![json!({"type":"unsupported"}); MAX_PARTS+1]});
        let mut budget = ProjectionBudget::default();
        assert_eq!(project_for_budget(&data, &mut budget).unwrap_err(), LIMIT);
        assert_eq!(budget.parts, 0);
        assert_eq!(budget.bytes, 0);
    }

    #[test]
    fn part_and_text_budgets_accumulate_across_message_projections() {
        let unsupported = json!({"parts":[{"type":"unsupported"}]});
        let mut budget = ProjectionBudget {
            parts: MAX_PARTS - 1,
            bytes: 0,
        };
        assert!(project_for_budget(&unsupported, &mut budget).is_ok());
        assert_eq!(
            project_for_budget(&unsupported, &mut budget).unwrap_err(),
            LIMIT
        );

        let text = json!({"parts":[{"type":"text","text":"中"}]});
        let mut budget = ProjectionBudget {
            parts: 0,
            bytes: MAX_PROJECTED - 3,
        };
        assert!(project_for_budget(&text, &mut budget).is_ok());
        assert_eq!(budget.bytes, MAX_PROJECTED);
        assert_eq!(project_for_budget(&text, &mut budget).unwrap_err(), LIMIT);
        assert_eq!(budget.bytes, MAX_PROJECTED);
    }

    #[test]
    fn expanded_code_fence_rejects_before_allocating_emitted_text() {
        // The source field fits 8 MiB, but the two protective fences make the
        // emitted string exceed the limit. No projected bytes are reserved.
        let data = json!({"parts":[{"type":"data-code","data":{"content":"`".repeat(MAX_FIELD as usize/3),"language":"rust"}}]});
        let mut budget = ProjectionBudget::default();
        assert_eq!(project_for_budget(&data, &mut budget).unwrap_err(), LIMIT);
        assert_eq!(budget.bytes, 0);

        // Also check the full fence length against the cumulative budget,
        // rather than checking source content alone.
        let data =
            json!({"parts":[{"type":"data-code","data":{"content":"```","language":"rust"}}]});
        let mut budget = ProjectionBudget {
            parts: 0,
            bytes: MAX_PROJECTED - 16,
        };
        assert_eq!(project_for_budget(&data, &mut budget).unwrap_err(), LIMIT);
        assert_eq!(budget.bytes, MAX_PROJECTED - 16);
    }

    #[test]
    fn emitted_text_and_file_metadata_respect_projection_limits() {
        let data = json!({"parts":[{"type":"reasoning","text":"x".repeat(MAX_FIELD as usize+1)}]});
        let mut budget = ProjectionBudget::default();
        assert_eq!(project_for_budget(&data, &mut budget).unwrap_err(), LIMIT);
        assert_eq!(budget.bytes, 0);

        let key = format!("Data/Files/{FILE_ID}.txt");
        let name = "note.txt".to_owned();
        let metadata_len = 2 * (key.len() + name.len());
        let entries = HashMap::from([(FILE_ID.to_owned(), (key, name, 4, true))]);
        let data = json!({"parts":[{"type":"file","providerMetadata":{"cherry":{"fileEntryId":FILE_ID}}}]});
        let mut files = Map::new();
        let mut warnings = Vec::new();
        let mut budget = ProjectionBudget {
            parts: 0,
            bytes: MAX_PROJECTED - metadata_len + 1,
        };
        assert_eq!(
            project_parts(&data, &entries, &mut files, &mut warnings, &mut budget).unwrap_err(),
            LIMIT
        );
        assert!(files.is_empty());
        assert!(warnings.is_empty());
    }
}
