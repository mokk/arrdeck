"""Write the OpenAPI spec to openapi.json at the repo root.

The spec is committed so clients can be generated without a running backend.
The PWA's gen:api used to read a live URL, which meant a backend change could
not be typed until it was deployed — a chicken-and-egg that bit twice while
building the diagnosis endpoint, and that the iOS repo would have inherited.

Keys are sorted and the output ends in a newline so regeneration produces
byte-identical files and diffs stay reviewable. tests/test_openapi_spec.py
fails the build when the committed file drifts from the mounted routes.
"""

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.main import app

TARGET = pathlib.Path(__file__).resolve().parents[2] / "openapi.json"


def render() -> str:
    return json.dumps(app.openapi(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    TARGET.write_text(render())
    spec = app.openapi()
    print(f"wrote {TARGET} ({len(spec['paths'])} paths, version {spec['info']['version']})")
