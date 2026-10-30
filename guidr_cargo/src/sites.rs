use pyo3::prelude::*;

pub const GUIDE_LEN: usize = 20;
pub const PAM_LEN: usize = 3;
pub const SITE_LEN: usize = GUIDE_LEN + PAM_LEN;

fn is_acgt(w: &[u8]) -> bool {
    w.iter().all(|&b| matches!(b, b'A' | b'C' | b'G' | b'T'))
}

fn revcomp(w: &[u8]) -> Vec<u8> {
    w.iter()
        .rev()
        .map(|&b| match b {
            b'A' => b'T',
            b'C' => b'G',
            b'G' => b'C',
            _ => b'A', // b'T'; callers only pass validated A/C/G/T
        })
        .collect()
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8(bytes.to_vec()).expect("ASCII") // only called on validated ACGT
}

/// Returns (start, strand, protospacer, pam), in the same order as the Python
/// generator: by window start, forward strand before reverse at the same start.
/// Python adds the chromosome and builds the `Site` objects.
#[pyfunction]
#[pyo3(signature = (seq, start=0, end=None))]
pub fn enumerate_sites(
    seq: &str,
    start: usize,
    end: Option<usize>,
) -> Vec<(usize, &'static str, String, String)> {
    let s = seq.as_bytes();
    let end = end.unwrap_or(s.len()).min(s.len());
    let mut out = Vec::new();
    if end < SITE_LEN || start > end - SITE_LEN {
        return out;
    }
    for i in start..=(end - SITE_LEN) {
        let w = &s[i..i + SITE_LEN];
        let fwd = w[21] == b'G' && w[22] == b'G';
        let rev = w[0] == b'C' && w[1] == b'C';
        if !(fwd || rev) || !is_acgt(w) {
            continue;
        }
        if fwd {
            out.push((i, "+", text(&w[..GUIDE_LEN]), text(&w[GUIDE_LEN..])));
        }
        if rev {
            let rc = revcomp(w);
            out.push((i, "-", text(&rc[..GUIDE_LEN]), text(&rc[GUIDE_LEN..])));
        }
    }
    out
}

pub fn register(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(enumerate_sites, m)?)?;
    Ok(())
}