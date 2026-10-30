use pyo3::prelude::*;
use pyo3::types::PyModule;

mod offtargets;
mod sites;
mod index;

#[pymodule]
fn _core(py: Python<'_>, m: &Bound<'_, PyModule>) -> PyResult<()> {
    // Off-target search functions
    let offtargets_module = PyModule::new(py, "guidr._core.offtargets")?;
    offtargets::register(&offtargets_module)?;
    m.add_submodule(&offtargets_module)?;
    py.import("sys")?.getattr("modules")?.set_item("guidr._core.offtargets", &offtargets_module)?;

    let sites_module = PyModule::new(py, "guidr._core.sites")?;
    sites::register(&sites_module)?;
    m.add_submodule(&sites_module)?;
    py.import("sys")?.getattr("modules")?.set_item("guidr._core.sites", &sites_module)?;

    let index_module = PyModule::new(py, "guidr._core.index")?;
    index::register(&index_module)?;
    m.add_submodule(&index_module)?;
    py.import("sys")?.getattr("modules")?.set_item("guidr._core.index", &index_module)?;

    Ok(())
}