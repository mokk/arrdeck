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


def test_no_module_redefines_a_top_level_name():
    """Another split artefact, and one no linter flags: reassigning a name at
    module level is legal Python.

    Four API modules ended up with two `router = APIRouter(...)` lines, so every
    decorator bound to the second one and the first — carrying the intended tag —
    was thrown away. Harmless here (tags only group the OpenAPI docs), but the
    same shape would silently discard a real object.
    """
    import ast

    offenders = []
    for path in sorted((BACKEND / "app").rglob("*.py")):
        tree = ast.parse(path.read_text())
        seen: dict[str, int] = {}
        for node in tree.body:
            if not isinstance(node, ast.Assign):
                continue
            for target in node.targets:
                if not isinstance(target, ast.Name):
                    continue
                if target.id in seen:
                    offenders.append(
                        f"{path.name}:{node.lineno} redefines "
                        f"{target.id} (first at line {seen[target.id]})"
                    )
                seen[target.id] = node.lineno
    assert not offenders, "top-level names assigned twice:\n" + "\n".join(offenders)
