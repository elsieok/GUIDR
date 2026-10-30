use pyo3::prelude::*;

pub const GUIDE_LEN: usize = 20;

/// Pack A/C/G/T into 2 bits each (A=0, C=1, G=2, T=3). The FIRST letter ends up
/// in the highest bits. None for any other letter, or for more than 32 letters.
pub fn pack(s: &[u8]) -> Option<u64> {
    if s.len() > 32 {
        return None;
    }
    let mut x: u64 = 0;
    for &b in s {
        let code = match b {
            b'A' => 0,
            b'C' => 1,
            b'G' => 2,
            b'T' => 3,
            _ => return None,
        };
        x = (x << 2) | code;
    }
    Some(x)
}


#[inline]
pub fn mismatches_packed(a: u64, b: u64) -> u32 {
    let x = a ^ b;
    ((x | (x >> 1)) & 0x5555_5555_5555_5555).count_ones()
}

/// Same contract as the Python function. Like Python's zip, stops at the shorter string.
#[pyfunction]
pub fn count_mismatches(a: &str, b: &str, limit: usize) -> Option<usize> {
    let mut mm = 0usize;
    for (x, y) in a.bytes().zip(b.bytes()) {
        if x != y {
            mm += 1;
            if mm > limit {
                return None;
            }
        }
    }
    Some(mm)
}

pub fn register(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(count_mismatches, m)?)?;
    Ok(())
}