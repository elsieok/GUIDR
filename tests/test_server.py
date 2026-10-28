"""The production server: API under /api, viewer files at /."""
import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")
from fastapi.testclient import TestClient  # noqa: E402

from guidr.annotations import Gene  # noqa: E402
from guidr.server import create_server  # noqa: E402

P = "GATTACAGATTACAGATTAC"
GENOME = {"c": "TTTT" + P + "TGG" + "TTTT" + "T" * 200}
GENES = [Gene("geneA", "c", 0, 60, "+")]


@pytest.fixture
def static_dir(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<!doctype html><title>GUIDR</title><div id=root></div>")
    (tmp_path / "assets" / "app.js").write_text("console.log('viewer')")
    return tmp_path


def test_the_api_lives_under_api(static_dir):
    c = TestClient(create_server(GENOME, GENES, static_dir))
    assert c.get("/api/info").json()["max_mismatches"] == 3
    assert c.get("/api/genes/geneA").json()["name"] == "geneA"


def test_api_errors_keep_their_json_shape_under_the_prefix(static_dir):
    c = TestClient(create_server(GENOME, GENES, static_dir))
    r = c.get("/api/genes/nope")
    assert r.status_code == 404 and r.json()["error"] == "gene not found"


def test_the_viewer_is_served_at_the_root(static_dir):
    c = TestClient(create_server(GENOME, GENES, static_dir))
    r = c.get("/")
    assert r.status_code == 200 and "text/html" in r.headers["content-type"] and "GUIDR" in r.text
    assert c.get("/assets/app.js").text == "console.log('viewer')"


def test_the_api_is_not_shadowed_by_the_static_files(static_dir):
    c = TestClient(create_server(GENOME, GENES, static_dir))
    assert c.get("/info").status_code == 404           # only /api/info exists, the viewer folder has no info file
    assert c.get("/api/info").status_code == 200


def test_without_a_viewer_folder_only_the_api_is_served(tmp_path):
    c = TestClient(create_server(GENOME, GENES, tmp_path / "missing"))
    assert c.get("/").status_code == 404
    assert c.get("/api/info").status_code == 200
    assert TestClient(create_server(GENOME, GENES)).get("/api/info").status_code == 200


def test_settings_are_passed_through(static_dir):
    c = TestClient(create_server(GENOME, GENES, static_dir, max_mismatches=2))
    assert c.get("/api/info").json()["max_mismatches"] == 2
