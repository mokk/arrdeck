"""Guard against the failure mode that shipped in phase J.

Splitting dashboard.py moved `_averaged_totals` into torrents.py but left the
module-level state it reads behind. Nothing caught it: the import succeeded, the
route registered, and `guarded()` turned the NameError into a 200 response with
ok=false — so the endpoint looked healthy and the UI just said "offline".
"""

import pathlib
import subprocess
import sys

BACKEND = pathlib.Path(__file__).resolve().parent.parent


def test_no_module_has_an_undefined_name():
    files = sorted(str(p) for p in (BACKEND / "app").rglob("*.py"))
    result = subprocess.run(
        [sys.executable, "-m", "pyflakes", *files], capture_output=True, text=True
    )
    undefined = [
        line
        for line in (result.stdout + result.stderr).splitlines()
        # "undefined name 'x'" is the real finding; pyflakes also emits
        # "unable to detect undefined names" for a star-import, which is just a
        # notice that it cannot analyse the barrel
        if "undefined name '" in line
    ]
    assert not undefined, "undefined names:\n" + "\n".join(undefined)
