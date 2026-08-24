"""The committed spec must match the app that claims to serve it.

openapi.json is committed so the TS and Swift clients can be generated without a
running backend. A committed copy of a generated artefact is exactly the drift
class the version check exists for — main.py and package.json each carried an
independent "0.1.0" for months — so drift here fails the build rather than
surfacing as a client typed against routes that no longer exist.
"""

import pathlib

from scripts.export_openapi import TARGET, render


def test_the_committed_spec_matches_the_mounted_routes():
    committed = pathlib.Path(TARGET)
    assert committed.exists(), (
        "openapi.json is missing — run: python backend/scripts/export_openapi.py"
    )
    assert committed.read_text() == render(), (
        "openapi.json has drifted from the app — "
        "regenerate with: python backend/scripts/export_openapi.py"
    )
