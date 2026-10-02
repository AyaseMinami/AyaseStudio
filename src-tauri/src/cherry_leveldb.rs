//! A live snapshot reader, not forensic recovery: CURRENT/MANIFEST select files,
//! and tombstones win before any Chromium values are decoded.
use leveldb_core::Record;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

fn bad<T>() -> Result<T, String> {
    Err("cherry-damaged-storage".into())
}
pub(crate) fn varint(bytes: &[u8], pos: &mut usize) -> Result<u64, String> {
    let mut value = 0;
    for shift in (0..70).step_by(7) {
        let b = *bytes.get(*pos).ok_or("cherry-damaged-storage")?;
        *pos += 1;
        if shift == 63 && b > 1 {
            return bad();
        }
        value |= u64::from(b & 127) << shift;
        if b & 128 == 0 {
            return Ok(value);
        }
    }
    bad()
}
fn field<'a>(bytes: &'a [u8], pos: &mut usize) -> Result<&'a [u8], String> {
    let len = usize::try_from(varint(bytes, pos)?).map_err(|_| "cherry-damaged-storage")?;
    let end = pos.checked_add(len).ok_or("cherry-damaged-storage")?;
    let out = bytes.get(*pos..end).ok_or("cherry-damaged-storage")?;
    *pos = end;
    Ok(out)
}
/// Strict CRC and fragment validation, unlike the forensic reader's lenient WAL mode.
fn log_payloads(bytes: &[u8]) -> Result<Vec<Vec<u8>>, String> {
    let mut out = Vec::new();
    let mut partial: Option<Vec<u8>> = None;
    for block in bytes.chunks(32768) {
        let mut pos = 0;
        while pos < block.len() {
            if block[pos..].iter().all(|b| *b == 0) {
                break;
            }
            let header = block.get(pos..pos + 7).ok_or("cherry-damaged-storage")?;
            let size = u16::from_le_bytes([header[4], header[5]]) as usize;
            let kind = header[6];
            let data = block
                .get(pos + 7..pos + 7 + size)
                .ok_or("cherry-damaged-storage")?;
            let mut crc_input = Vec::with_capacity(size + 1);
            crc_input.push(kind);
            crc_input.extend_from_slice(data);
            let crc = crc32c::crc32c(&crc_input)
                .rotate_left(17)
                .wrapping_add(0xa282ead8);
            if crc.to_le_bytes() != header[..4] {
                return bad();
            }
            match kind {
                1 if partial.is_none() => out.push(data.to_vec()),
                2 if partial.is_none() => partial = Some(data.to_vec()),
                3 | 4 if partial.is_some() => {
                    let buffer = partial.as_mut().unwrap();
                    if buffer.len() + data.len() > 128 * 1024 * 1024 {
                        return bad();
                    }
                    buffer.extend_from_slice(data);
                    if kind == 4 {
                        out.push(partial.take().unwrap());
                    }
                }
                _ => return bad(),
            }
            pos += 7 + size;
            if out.len() > 500000 {
                return Err("cherry-limit".into());
            }
        }
    }
    if partial.is_some() {
        return bad();
    }
    Ok(out)
}
fn live_files(manifest: &[u8]) -> Result<(BTreeSet<u64>, u64, u64), String> {
    let mut tables = BTreeSet::new();
    let mut log = None;
    let mut previous = 0;
    for edit in log_payloads(manifest)? {
        let mut pos = 0;
        while pos < edit.len() {
            match varint(&edit, &mut pos)? {
                1 => {
                    let _ = field(&edit, &mut pos)?;
                }
                2 => log = Some(varint(&edit, &mut pos)?),
                3 | 4 => {
                    let _ = varint(&edit, &mut pos)?;
                }
                5 => {
                    let _ = varint(&edit, &mut pos)?;
                    let _ = field(&edit, &mut pos)?;
                }
                6 => {
                    let _ = varint(&edit, &mut pos)?;
                    tables.remove(&varint(&edit, &mut pos)?);
                }
                7 => {
                    let _ = varint(&edit, &mut pos)?;
                    let number = varint(&edit, &mut pos)?;
                    let _ = varint(&edit, &mut pos)?;
                    let _ = field(&edit, &mut pos)?;
                    let _ = field(&edit, &mut pos)?;
                    tables.insert(number);
                }
                9 => previous = varint(&edit, &mut pos)?,
                _ => return bad(),
            }
        }
    }
    Ok((tables, log.ok_or("cherry-damaged-storage")?, previous))
}
fn wal_records(bytes: &[u8], path: &Path) -> Result<Vec<Record>, String> {
    // Reject malformed batch counts and fields before the lenient core parser.
    let mut allocated = 0usize;
    let mut operations = 0usize;
    for batch in log_payloads(bytes)? {
        if batch.len() < 12 {
            return bad();
        }
        let count = u32::from_le_bytes(batch[8..12].try_into().unwrap());
        operations += count as usize;
        let sequence = u64::from_le_bytes(batch[..8].try_into().unwrap());
        if operations > 500000 || sequence > ((1u64 << 56) - 1).saturating_sub(u64::from(count)) {
            return bad();
        }
        let mut pos = 12;
        for _ in 0..count {
            let kind = *batch.get(pos).ok_or("cherry-damaged-storage")?;
            pos += 1;
            let key = field(&batch, &mut pos)?;
            allocated = allocated
                .checked_add(key.len() + 128)
                .ok_or("cherry-limit")?;
            if kind == 1 {
                allocated = allocated
                    .checked_add(field(&batch, &mut pos)?.len())
                    .ok_or("cherry-limit")?;
            } else if kind != 0 {
                return bad();
            }
            if allocated > 128 * 1024 * 1024 {
                return Err("cherry-limit".into());
            }
        }
        if pos != batch.len() {
            return bad();
        }
    }
    leveldb_core::parse_log_bytes(bytes, path).map_err(|_| "cherry-damaged-storage".into())
}
fn block(bytes: &[u8], offset: usize, size: usize, budget: &mut usize) -> Result<Vec<u8>, String> {
    let end = offset.checked_add(size).ok_or("cherry-limit")?;
    let compressed = bytes.get(offset..end).ok_or("cherry-damaged-storage")?;
    let kind = *bytes.get(end).ok_or("cherry-damaged-storage")?;
    let length = match kind {
        0 => size,
        1 => snap::raw::decompress_len(compressed).map_err(|_| "cherry-damaged-storage")?,
        _ => return bad(),
    };
    *budget = budget.checked_add(length).ok_or("cherry-limit")?;
    if length > 64 * 1024 * 1024 || *budget > 128 * 1024 * 1024 {
        return Err("cherry-limit".into());
    }
    match kind {
        0 => Ok(compressed.to_vec()),
        1 => snap::raw::Decoder::new()
            .decompress_vec(compressed)
            .map_err(|_| "cherry-damaged-storage".into()),
        _ => bad(),
    }
}
fn entries(bytes: &[u8], allocated: &mut usize) -> Result<Vec<Vec<u8>>, String> {
    if bytes.len() < 4 {
        return bad();
    }
    let restarts = u32::from_le_bytes(bytes[bytes.len() - 4..].try_into().unwrap()) as usize;
    let end = bytes
        .len()
        .checked_sub(4 + restarts.checked_mul(4).ok_or("cherry-limit")?)
        .ok_or("cherry-damaged-storage")?;
    let mut pos = 0;
    let mut key_len = 0usize;
    let mut values = Vec::new();
    while pos < end {
        let shared = usize::try_from(varint(bytes, &mut pos)?).map_err(|_| "cherry-limit")?;
        let added = usize::try_from(varint(bytes, &mut pos)?).map_err(|_| "cherry-limit")?;
        let length = usize::try_from(varint(bytes, &mut pos)?).map_err(|_| "cherry-limit")?;
        if shared > key_len {
            return bad();
        }
        key_len = shared.checked_add(added).ok_or("cherry-limit")?;
        *allocated = allocated
            .checked_add(key_len + length + 128)
            .ok_or("cherry-limit")?;
        if key_len > 1024 * 1024 || *allocated > 128 * 1024 * 1024 || values.len() > 500000 {
            return Err("cherry-limit".into());
        }
        pos = pos.checked_add(added).ok_or("cherry-limit")?;
        let tail = pos.checked_add(length).ok_or("cherry-limit")?;
        if tail > end {
            return bad();
        }
        values.push(bytes[pos..tail].to_vec());
        pos = tail;
    }
    Ok(values)
}
fn preflight_table(bytes: &[u8], budget: &mut usize, allocated: &mut usize) -> Result<(), String> {
    if bytes.len() < 48 {
        return bad();
    }
    let footer = &bytes[bytes.len() - 48..];
    let mut pos = 0;
    let _ = varint(footer, &mut pos)?;
    let _ = varint(footer, &mut pos)?;
    let offset = usize::try_from(varint(footer, &mut pos)?).map_err(|_| "cherry-limit")?;
    let size = usize::try_from(varint(footer, &mut pos)?).map_err(|_| "cherry-limit")?;
    let index = block(bytes, offset, size, budget)?;
    let mut spans = Vec::new();
    for value in entries(&index, allocated)? {
        let mut pos = 0;
        let offset = usize::try_from(varint(&value, &mut pos)?).map_err(|_| "cherry-limit")?;
        let size = usize::try_from(varint(&value, &mut pos)?).map_err(|_| "cherry-limit")?;
        if pos != value.len() {
            return bad();
        }
        let end = offset
            .checked_add(size)
            .and_then(|n| n.checked_add(5))
            .ok_or("cherry-limit")?;
        spans.push((offset, end));
        let data = block(bytes, offset, size, budget)?;
        let _ = entries(&data, allocated)?;
    }
    spans.sort_unstable();
    if spans.windows(2).any(|w| w[0].1 > w[1].0) {
        return bad();
    }
    Ok(())
}
pub(crate) fn read_live(directory: &Path) -> Result<Vec<Record>, String> {
    let current =
        std::fs::read_to_string(directory.join("CURRENT")).map_err(|_| "cherry-damaged-storage")?;
    let manifest = current.trim();
    if !manifest
        .strip_prefix("MANIFEST-")
        .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
    {
        return bad();
    }
    let (tables, log, previous) = live_files(
        &std::fs::read(directory.join(manifest)).map_err(|_| "cherry-damaged-storage")?,
    )?;
    let mut records: BTreeMap<Vec<u8>, Record> = BTreeMap::new();
    let mut budget = 0usize;
    let mut expanded = 0;
    let mut allocated = 0;
    let mut current_log_found = log == 0;
    let paths = std::fs::read_dir(directory).map_err(|_| "cherry-damaged-storage")?;
    let mut found = BTreeSet::new();
    for item in paths {
        let path = item.map_err(|_| "cherry-damaged-storage")?.path();
        let number = path
            .file_stem()
            .and_then(|s| s.to_str())
            .and_then(|s| s.parse::<u64>().ok());
        let ext = path.extension().and_then(|s| s.to_str());
        let Some(number) = number else { continue };
        let table = matches!(ext, Some("ldb" | "sst")) && tables.contains(&number);
        let wal = ext == Some("log") && (number >= log || (previous != 0 && number == previous));
        if !table && !wal {
            continue;
        }
        let bytes = std::fs::read(&path).map_err(|_| "cherry-damaged-storage")?;
        budget = budget.checked_add(bytes.len()).ok_or("cherry-limit")?;
        if budget > 128 * 1024 * 1024 {
            return Err("cherry-limit".into());
        }
        let parsed = if table {
            found.insert(number);
            preflight_table(&bytes, &mut expanded, &mut allocated)?;
            leveldb_core::parse_table_bytes(&bytes, &path).map_err(|_| "cherry-damaged-storage")?
        } else {
            if number == log {
                current_log_found = true
            }
            wal_records(&bytes, &path)?
        };
        for record in parsed {
            if record.key.len() > 1024 * 1024 || record.value.len() > 64 * 1024 * 1024 {
                return Err("cherry-limit".into());
            }
            match records.get(&record.key) {
                Some(old)
                    if old.seq == record.seq
                        && (old.value != record.value || old.deleted != record.deleted) =>
                {
                    return bad()
                }
                Some(old) if old.seq >= record.seq => (),
                _ => {
                    records.insert(record.key.clone(), record);
                }
            }
        }
        if records.len() > 500000 {
            return Err("cherry-limit".into());
        }
    }
    if found != tables || !current_log_found {
        return bad();
    }
    Ok(records.into_values().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn full(data: &[u8]) -> Vec<u8> {
        let mut crc = vec![1];
        crc.extend_from_slice(data);
        let crc = crc32c::crc32c(&crc)
            .rotate_left(17)
            .wrapping_add(0xa282ead8);
        let mut out = crc.to_le_bytes().to_vec();
        out.extend_from_slice(&(data.len() as u16).to_le_bytes());
        out.push(1);
        out.extend_from_slice(data);
        out
    }
    #[test]
    fn manifest_removes_obsolete_table() {
        let edit = [2, 4, 7, 0, 8, 1, 0, 0, 6, 0, 8];
        let (tables, log, _) = live_files(&full(&edit)).unwrap();
        assert!(tables.is_empty());
        assert_eq!(log, 4);
    }
    #[test]
    fn damaged_crc_is_not_silently_skipped() {
        let mut bytes = full(&[2, 4]);
        bytes[0] ^= 1;
        assert!(live_files(&bytes).is_err());
    }
    #[test]
    fn incomplete_fragments_reject() {
        let mut bytes = full(&[2, 4]);
        bytes[6] = 2;
        assert!(log_payloads(&bytes).is_err());
    }
    #[test]
    fn malformed_batch_reject() {
        assert!(wal_records(&full(&[0; 11]), Path::new("x")).is_err());
    }
    #[test]
    fn current_wal_is_required() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("CURRENT"), "MANIFEST-000001\n").unwrap();
        std::fs::write(temp.path().join("MANIFEST-000001"), full(&[2, 4])).unwrap();
        assert!(read_live(temp.path()).is_err())
    }
    #[test]
    fn oversized_batch_count_rejected_before_records_allocation() {
        let mut data = vec![0; 12];
        data[8..12].copy_from_slice(&500001u32.to_le_bytes());
        assert!(wal_records(&full(&data), Path::new("x")).is_err())
    }
    #[test]
    fn compressed_block_budget_precedes_decompression() {
        let bytes = [0xff, 0xff, 0xff, 0xff, 15, 1];
        let mut budget = 0;
        assert!(block(&bytes, 0, 5, &mut budget).is_err())
    }
    fn put_varint(mut value: usize, out: &mut Vec<u8>) {
        while value >= 128 {
            out.push((value as u8 & 127) | 128);
            value >>= 7;
        }
        out.push(value as u8);
    }
    #[test]
    fn shared_key_prefix_is_charged_before_reconstruction() {
        let mut bytes = Vec::new();
        for index in 0..130 {
            put_varint(if index == 0 { 0 } else { 1024 * 1024 }, &mut bytes);
            put_varint(if index == 0 { 1024 * 1024 } else { 0 }, &mut bytes);
            put_varint(0, &mut bytes);
            if index == 0 {
                bytes.resize(bytes.len() + 1024 * 1024, b'a');
            }
        }
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(&1u32.to_le_bytes());
        assert_eq!(entries(&bytes, &mut 0).unwrap_err(), "cherry-limit");
    }
    #[test]
    fn repeated_table_handles_are_rejected() {
        let data = vec![0, 1, 1, b'a', b'x', 0, 0, 0, 0, 1, 0, 0, 0];
        let mut table = data.clone();
        table.extend_from_slice(&[0; 5]);
        let offset = table.len();
        let mut index = vec![
            0,
            1,
            2,
            b'a',
            0,
            data.len() as u8,
            0,
            1,
            2,
            b'b',
            0,
            data.len() as u8,
        ];
        index.extend_from_slice(&[0, 0, 0, 0, 1, 0, 0, 0]);
        table.extend_from_slice(&index);
        table.extend_from_slice(&[0; 5]);
        let mut footer = vec![0, 0];
        put_varint(offset, &mut footer);
        put_varint(index.len(), &mut footer);
        footer.resize(48, 0);
        table.extend_from_slice(&footer);
        assert_eq!(
            preflight_table(&table, &mut 0, &mut 0).unwrap_err(),
            "cherry-damaged-storage"
        );
    }
    #[test]
    fn zero_previous_log_does_not_select_obsolete_zero_wal() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("CURRENT"), "MANIFEST-000001\n").unwrap();
        std::fs::write(temp.path().join("MANIFEST-000001"), full(&[2, 4, 9, 0])).unwrap();
        std::fs::write(temp.path().join("000004.log"), full(&[0; 12])).unwrap();
        std::fs::write(temp.path().join("000000.log"), b"obsolete corrupt log").unwrap();
        assert!(read_live(temp.path()).unwrap().is_empty());
    }
}
