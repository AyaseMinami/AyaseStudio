//! Restricted, non-executing decoder for JSON-shaped structured clones.
//! Format facts: V8 src/objects/value-serializer.cc; Blink serialization_tag.h.
//! Padding is a tag (not a string byte); named array properties/host objects and
//! cyclic references are rejected rather than inventing recoverable chat data.
use crate::cherry_leveldb::varint;
use serde_json::{json, Map, Value};
const INVALID: &str = "cherry-unsupported-storage-value";
const LIMIT: usize = 64 * 1024 * 1024;
fn json_string_len(s: &str) -> Result<usize, String> {
    let mut len = 2usize;
    for &b in s.as_bytes() {
        let step = match b {
            b'"' | b'\\' | b'\x08' | b'\x0c' | b'\n' | b'\r' | b'\t' => 2,
            0x00..=0x1f => 6,
            _ => 1,
        };
        len = len.checked_add(step).ok_or(INVALID)?;
    }
    Ok(len)
}
fn json_number_len(value: &Value) -> Result<usize, String> {
    struct ByteCounter(usize);
    impl std::io::Write for ByteCounter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0 = self
                .0
                .checked_add(buf.len())
                .ok_or(std::io::ErrorKind::Other)?;
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut counter = ByteCounter(0);
    serde_json::to_writer(&mut counter, value).map_err(|_| INVALID)?;
    Ok(counter.0)
}
struct Reader<'a> {
    bytes: &'a [u8],
    pos: usize,
    nodes: usize,
    memo: Vec<Option<(Value, usize)>>,
    allocated: usize,
}
impl Reader<'_> {
    fn number(&mut self) -> Result<u64, String> {
        varint(self.bytes, &mut self.pos).map_err(|_| INVALID.into())
    }
    fn take(&mut self, len: usize) -> Result<&[u8], String> {
        let end = self.pos.checked_add(len).ok_or(INVALID)?;
        let bytes = self.bytes.get(self.pos..end).ok_or(INVALID)?;
        self.pos = end;
        Ok(bytes)
    }
    fn peek(&mut self) -> Result<u8, String> {
        while self.bytes.get(self.pos) == Some(&0) {
            self.pos += 1
        }
        self.bytes
            .get(self.pos)
            .copied()
            .ok_or_else(|| INVALID.into())
    }
    fn tag(&mut self) -> Result<u8, String> {
        let tag = self.peek()?;
        self.pos += 1;
        Ok(tag)
    }
    fn charge(&mut self, n: usize) -> Result<(), String> {
        self.allocated = self.allocated.checked_add(n).ok_or(INVALID)?;
        if self.allocated > LIMIT {
            return Err("cherry-limit".into());
        }
        Ok(())
    }
    fn store(&mut self, index: usize, value: &Value, byte_len: usize) -> Result<(), String> {
        self.charge(byte_len)?;
        self.memo[index] = Some((value.clone(), byte_len));
        Ok(())
    }
    fn value(&mut self, depth: usize) -> Result<(Value, usize), String> {
        self.nodes += 1;
        if depth > 100 || self.nodes > 500000 {
            return Err("cherry-limit".into());
        }
        let mut tag = self.tag()?;
        while tag == b'?' {
            self.number()?;
            tag = self.tag()?
        }
        Ok(match tag {
            b'_' | b'-' | b'0' => (Value::Null, 4),
            b'T' => (json!(true), 4),
            b'F' => (json!(false), 5),
            b'I' => {
                let n = self.number()?;
                if n > u32::MAX as u64 {
                    return Err(INVALID.into());
                }
                let value = json!((n >> 1) as i64 ^ -((n & 1) as i64));
                let len = json_number_len(&value)?;
                (value, len)
            }
            b'U' => {
                let n = self.number()?;
                if n > u32::MAX as u64 {
                    return Err(INVALID.into());
                }
                let value = json!(n);
                let len = json_number_len(&value)?;
                (value, len)
            }
            b'N' => {
                let raw: [u8; 8] = self.take(8)?.try_into().map_err(|_| INVALID)?;
                let n = f64::from_le_bytes(raw);
                if !n.is_finite() {
                    return Err(INVALID.into());
                }
                let value = json!(n);
                let len = json_number_len(&value)?;
                (value, len)
            }
            b'"' | b'S' | b'c' => {
                let len = usize::try_from(self.number()?).map_err(|_| INVALID)?;
                if len > 8 * 1024 * 1024 {
                    return Err("cherry-limit".into());
                }
                self.charge(len)?;
                let bytes = self.take(len)?;
                let s = match tag {
                    b'"' => bytes.iter().map(|b| char::from(*b)).collect(),
                    b'S' => std::str::from_utf8(bytes).map_err(|_| INVALID)?.to_owned(),
                    _ => {
                        if len % 2 != 0 {
                            return Err(INVALID.into());
                        }
                        let units: Vec<_> = bytes
                            .chunks_exact(2)
                            .map(|b| u16::from_le_bytes([b[0], b[1]]))
                            .collect();
                        String::from_utf16(&units).map_err(|_| INVALID)?
                    }
                };
                let byte_len = json_string_len(&s)?;
                (Value::String(s), byte_len)
            }
            b'^' => {
                let n = usize::try_from(self.number()?).map_err(|_| INVALID)?;
                let byte_len = self.memo.get(n).and_then(Option::as_ref).ok_or(INVALID)?.1;
                self.charge(byte_len)?;
                (self.memo[n].as_ref().unwrap().0.clone(), byte_len)
            }
            b'o' => {
                let slot = self.memo.len();
                self.memo.push(None);
                let mut out = Map::new();
                let mut count = 0u64;
                let mut byte_len = 2usize;
                while self.peek()? != b'{' {
                    let (key, key_len) = self.value(depth + 1)?;
                    let (key, key_json_len) = match key {
                        Value::String(s) => (s, key_len),
                        Value::Number(n) => {
                            let s = n.to_string();
                            let len = s.len().checked_add(2).ok_or(INVALID)?;
                            (s, len)
                        }
                        _ => return Err(INVALID.into()),
                    };
                    let (value, value_len) = self.value(depth + 1)?;
                    if out.insert(key, value).is_some() {
                        return Err(INVALID.into());
                    }
                    let entry_len = key_json_len
                        .checked_add(1)
                        .and_then(|n| n.checked_add(value_len))
                        .and_then(|n| n.checked_add(usize::from(count > 0)))
                        .ok_or(INVALID)?;
                    byte_len = byte_len.checked_add(entry_len).ok_or(INVALID)?;
                    count += 1;
                }
                self.tag()?;
                if self.number()? != count {
                    return Err(INVALID.into());
                }
                let value = Value::Object(out);
                self.store(slot, &value, byte_len)?;
                (value, byte_len)
            }
            b'A' | b'a' => {
                let len = usize::try_from(self.number()?).map_err(|_| INVALID)?;
                if len > 100000 {
                    return Err("cherry-limit".into());
                }
                self.charge(len * 32)?;
                let slot = self.memo.len();
                self.memo.push(None);
                let mut out = vec![Value::Null; len];
                let mut byte_len = 2usize
                    .checked_add(len.saturating_sub(1))
                    .ok_or(INVALID)?;
                let end = if tag == b'A' { b'$' } else { b'@' };
                if tag == b'A' {
                    for item in &mut out {
                        let (value, value_len) = self.value(depth + 1)?;
                        byte_len = byte_len.checked_add(value_len).ok_or(INVALID)?;
                        *item = value;
                    }
                } else {
                    byte_len = byte_len
                        .checked_add(len.checked_mul(4).ok_or(INVALID)?)
                        .ok_or(INVALID)?;
                }
                let mut count = 0u64;
                let mut seen = std::collections::BTreeSet::new();
                while self.peek()? != end {
                    let (key, _) = self.value(depth + 1)?;
                    let index = key
                        .as_u64()
                        .or_else(|| key.as_str().and_then(|s| s.parse().ok()))
                        .ok_or(INVALID)? as usize;
                    if tag == b'A' || index >= len || !seen.insert(index) {
                        return Err(INVALID.into());
                    }
                    let (value, value_len) = self.value(depth + 1)?;
                    byte_len = (byte_len - 4).checked_add(value_len).ok_or(INVALID)?;
                    out[index] = value;
                    count += 1;
                }
                self.tag()?;
                if self.number()? != count || self.number()? != len as u64 {
                    return Err(INVALID.into());
                }
                let value = Value::Array(out);
                self.store(slot, &value, byte_len)?;
                (value, byte_len)
            }
            _ => return Err(INVALID.into()),
        })
    }
}
pub(crate) fn decode(bytes: &[u8]) -> Result<Value, String> {
    if bytes.starts_with(&[255, 17, 2]) {
        let compressed = &bytes[3..];
        let len = snap::raw::decompress_len(compressed).map_err(|_| INVALID)?;
        if len > LIMIT {
            return Err("cherry-limit".into());
        }
        let value = snap::raw::Decoder::new()
            .decompress_vec(compressed)
            .map_err(|_| INVALID)?;
        if value.starts_with(&[255, 17, 2]) {
            return Err(INVALID.into());
        }
        return decode(&value);
    }
    let mut reader = Reader {
        bytes,
        pos: 0,
        nodes: 0,
        memo: Vec::new(),
        allocated: 0,
    };
    if reader.tag()? != 255 {
        return Err(INVALID.into());
    }
    let outer = reader.number()?;
    if reader.peek()? == 254 {
        reader.tag()?;
        reader.take(12)?;
    }
    let version = if reader.peek()? == 255 {
        reader.tag()?;
        reader.number()?
    } else {
        outer
    };
    if !(13..=16).contains(&version) {
        return Err(INVALID.into());
    }
    let (value, _) = reader.value(0)?;
    if reader.bytes[reader.pos..].iter().any(|b| *b != 0) {
        return Err(INVALID.into());
    }
    Ok(value)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn padding_before_chinese_string() {
        let bytes = [
            255, 15, b'o', b'"', 1, b'a', 0, b'c', 2, 0x2d, 0x4e, b'{', 1,
        ];
        assert!(decode(&bytes).unwrap()["a"] == "中")
    }
    #[test]
    fn dense_array_end_counts() {
        assert!(decode(&[255, 15, b'A', 1, b'I', 2, b'$', 0, 1]).unwrap() == json!([1]));
        assert!(decode(&[255, 15, b'A', 1, b'I', 2, b'$', 1, 1]).is_err())
    }
    #[test]
    fn host_and_cycles_rejected() {
        assert!(decode(&[255, 15, b'\\', b'f']).is_err());
        assert!(decode(&[255, 15, b'o', b'"', 1, b'a', b'^', 0, b'{', 1]).is_err())
    }
    #[test]
    fn sparse_length_budget() {
        assert!(decode(&[255, 15, b'a', 255, 255, 127]).is_err())
    }
    #[test]
    fn cached_json_lengths_match_serialized_sizes_across_nested_and_backref_values() {
        // Object {"k": [1, "a\"b\n"], "s": sparse[2]{1: true}, "r": ^1 (ref to dense array)}
        let mut bytes = vec![255, 15, b'o'];
        bytes.extend_from_slice(&[b'"', 1, b'k']);
        bytes.extend_from_slice(&[b'A', 2, b'I', 2, b'"', 4, b'a', b'"', b'b', b'\n', b'$', 0, 2]);
        bytes.extend_from_slice(&[b'"', 1, b's']);
        bytes.extend_from_slice(&[b'a', 2, b'I', 2, b'T', b'@', 1, 2]);
        bytes.extend_from_slice(&[b'"', 1, b'r', b'^', 1]);
        bytes.extend_from_slice(&[b'{', 3]);

        let mut reader = Reader {
            bytes: &bytes,
            pos: 2,
            nodes: 0,
            memo: Vec::new(),
            allocated: 0,
        };
        let (value, root_len) = reader.value(0).unwrap();
        assert_eq!(root_len, serde_json::to_vec(&value).unwrap().len());
        for slot in reader.memo.iter().flatten() {
            assert_eq!(slot.1, serde_json::to_vec(&slot.0).unwrap().len());
        }
        assert_eq!(
            value,
            json!({"k": [1, "a\"b\n"], "s": [null, true], "r": [1, "a\"b\n"]})
        );
        // Verify json_string_len matches serde_json byte-for-byte across all ASCII control/printable chars + UTF-8.
        let mut all_chars = String::new();
        for b in 0u8..=0x7f {
            all_chars.push(b as char);
        }
        all_chars.push_str("中文🚀");
        assert_eq!(
            json_string_len(&all_chars).unwrap(),
            serde_json::to_vec(&Value::String(all_chars)).unwrap().len()
        );
    }
}
