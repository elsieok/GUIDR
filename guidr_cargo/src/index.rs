use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use rayon::prelude::*;

use crate::offtargets::{mismatches_packed, pack, GUIDE_LEN};

fn bounds_for(length: usize, pieces: usize) -> Vec<(usize, usize)> {
    let base = length / pieces;
    let extra = length % pieces;
    let mut out = Vec::with_capacity(pieces);
    let mut start = 0;
    for i in 0..pieces {
        let size = base + usize::from(i < extra);
        out.push((start, start + size));
        start += size;
    }
    out
}

#[pyfunction]
pub fn piece_bounds(length: i64, pieces: i64) -> PyResult<Vec<(usize, usize)>> {
    if pieces < 1 {
        return Err(PyValueError::new_err("Number of pieces must be at least 1"));
    }
    if pieces > length {
        return Err(PyValueError::new_err(
            "Number of pieces must be less than the length of the guide sequence being searched",
        ));
    }
    Ok(bounds_for(length as usize, pieces as usize))
}

/// Letters [start, end) of a packed 20-letter protospacer, as one integer.
#[inline]
fn piece(packed: u64, start: usize, end: usize) -> u64 {
    (packed >> (2 * (GUIDE_LEN - end))) & ((1u64 << (2 * (end - start))) - 1)
}

fn parse_protospacer(s: &str) -> Result<u64, String> {
    if s.len() != GUIDE_LEN {
        return Err(format!("protospacer must be {GUIDE_LEN} letters, got {}", s.len()));
    }
    pack(s.as_bytes()).ok_or_else(|| "protospacer may only contain A, C, G, T".to_string())
}

#[pyclass(module = "guidr._core.index")]
pub struct SeedIndex {
    packed: Vec<u64>,
    max_mismatches: usize,
    bounds: Vec<(usize, usize)>,
    /// One table per piece position: (piece_value, site_index), sorted. Sites
    /// sharing a piece value sit side by side, so a lookup is two binary searches.
    tables: Vec<Vec<(u64, u32)>>,
}

impl SeedIndex {
    fn candidates(&self, guide: u64) -> Vec<u32> {
        let mut out: Vec<u32> = Vec::new();
        for (table, &(start, end)) in self.tables.iter().zip(&self.bounds) {
            let key = piece(guide, start, end);
            let lo = table.partition_point(|e| e.0 < key);
            let hi = lo + table[lo..].partition_point(|e| e.0 == key);
            out.extend(table[lo..hi].iter().map(|e| e.1));
        }
        out.sort_unstable();
        out.dedup();
        out
    }

    fn query_packed(&self, guide: u64, exclude: Option<usize>) -> Vec<(usize, u32)> {
        self.candidates(guide)
            .into_iter()
            .map(|i| i as usize)
            .filter(|&i| Some(i) != exclude)
            .filter_map(|i| {
                let mm = mismatches_packed(guide, self.packed[i]);
                (mm as usize <= self.max_mismatches).then_some((i, mm))
            })
            .collect()
    }
}

#[pymethods]
impl SeedIndex {
    #[new]
    fn new(protospacers: Vec<String>, max_mismatches: i64) -> PyResult<Self> {
        if max_mismatches < 0 {
            return Err(PyValueError::new_err("max_mismatches cannot be negative."));
        }
        if max_mismatches as usize >= GUIDE_LEN {
            return Err(PyValueError::new_err(
                "max_mismatches must be less than the length of the guide sequence being searched",
            ));
        }
        let max_mismatches = max_mismatches as usize;

        let mut packed = Vec::with_capacity(protospacers.len());
        for (i, p) in protospacers.iter().enumerate() {
            let v = parse_protospacer(p)
                .map_err(|e| PyValueError::new_err(format!("site {i}: {e}")))?;
            packed.push(v);
        }

        let bounds = bounds_for(GUIDE_LEN, max_mismatches + 1);
        let tables = bounds
            .iter()
            .map(|&(start, end)| {
                let mut t: Vec<(u64, u32)> = packed
                    .iter()
                    .enumerate()
                    .map(|(i, &p)| (piece(p, start, end), i as u32))
                    .collect();
                t.sort_unstable();
                t
            })
            .collect();

        Ok(SeedIndex { packed, max_mismatches, bounds, tables })
    }

    #[getter]
    fn max_mismatches(&self) -> usize {
        self.max_mismatches
    }

    #[getter]
    fn bounds(&self) -> Vec<(usize, usize)> {
        self.bounds.clone()
    }

    fn __len__(&self) -> usize {
        self.packed.len()
    }

    fn candidate_count(&self, protospacer: &str) -> PyResult<usize> {
        let g = parse_protospacer(protospacer).map_err(PyValueError::new_err)?;
        Ok(self.candidates(g).len())
    }

    /// (site_index, mismatches) for every site within max_mismatches.
    /// `exclude` = index of the guide's own site, or None if it isn't in the index.
    #[pyo3(signature = (protospacer, exclude=None))]
    fn query(&self, protospacer: &str, exclude: Option<usize>) -> PyResult<Vec<(usize, u32)>> {
        let g = parse_protospacer(protospacer).map_err(PyValueError::new_err)?;
        Ok(self.query_packed(g, exclude))
    }

    /// Many guides at once: releases the GIL and uses every core.
    fn query_many(
        &self,
        py: Python<'_>,
        protospacers: Vec<String>,
        excludes: Vec<Option<usize>>,
    ) -> PyResult<Vec<Vec<(usize, u32)>>> {
        if protospacers.len() != excludes.len() {
            return Err(PyValueError::new_err(
                "protospacers and excludes must have the same length",
            ));
        }
        let guides = protospacers
            .iter()
            .map(|p| parse_protospacer(p).map_err(PyValueError::new_err))
            .collect::<PyResult<Vec<u64>>>()?;
        Ok(py.detach(|| {
            guides
                .par_iter()
                .zip(excludes.par_iter())
                .map(|(&g, &ex)| self.query_packed(g, ex))
                .collect()
        }))
    }
}

pub fn register(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<SeedIndex>()?;
    m.add_function(wrap_pyfunction!(piece_bounds, m)?)?;
    Ok(())
}