"""The one place arrdeck's version is written down.

`main.py` and `frontend/package.json` each carried an independent "0.1.0" that
had never been bumped, which made version-based capability checks impossible for
any client that is not shipped alongside this backend.

Bump MINOR when an endpoint is added, MAJOR when one changes shape or goes away.
`scripts/check-version.mjs` fails the build if package.json drifts from this.
"""

VERSION = "0.2.0"
