# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.0.5] - 2026-06-13

### Added
- **npm Trusted Publishing pipeline** (`.github/workflows/npm-publish.yml`): the package is now published to npm via GitHub Actions using OIDC Trusted Publishing — no `NPM_TOKEN` secret required. The workflow runs on a published GitHub Release (or manual dispatch), lints, builds and tests, then runs `npm publish` with automatically generated build provenance (the npm ✓ "Built and signed on GitHub Actions" badge). Requires the Trusted Publisher to be configured once on npmjs.com (org `blanpa`, repo `node-red-contrib-s7-suite`, workflow `npm-publish.yml`)
- **Sim-server dev environment** (`sim-server/`, `docker-compose.sim.yml`, `examples/sim-deployment.json`): a fully offline, multi-PLC simulation stack for development and CI — six S7-server simulators (S7-1200/1500/300/400 etc.) plus a Node-RED instance with the S7 nodes and a preloaded demo flow. One command (`docker compose -f docker-compose.sim.yml up --build`) brings up the whole environment; each simulator is reachable on the host at ports `1102..1107` for direct snap7 testing and via service name inside the Docker network. Dev-only — none of these files ship in the npm tarball

### Fixed
- **s7-config validation after redeploy** (#12): the Node-RED editor delivers numeric fields (rack, slot, port, timeouts) as strings after editing a config node, which made validation fail with `Invalid S7 config: invalid rack: 0 (expected 0-7)` and blocked the connection. All numeric config fields are now coerced before validation
- **s7-trigger no longer crashes on an invalid address**: a malformed address now sets a red `invalid address` node status instead of throwing during node construction; interval and deadband are coerced from editor strings as well
- **ConnectionManager request-timeout timer leak**: the per-request timeout timer is now cleared once a request settles instead of lingering for the full timeout duration
- **ConnectionManager reconnect race**: calling `disconnect()` while a reconnect attempt was pending or in flight could re-establish (and leak) a PLC connection afterwards; reconnects now stop cleanly after a manual disconnect

### Security
- All `/s7-suite/*` admin endpoints now require editor permissions via `RED.auth.needsPermission` (`s7.read` for status/browse, `s7.write` for cfg/TIA-XML imports) when Node-RED authentication is enabled
- **Dependency audit**: bumped the `node-red` devDependency from `^3.1.0` to `^4.1.11`, clearing 22 of the 25 reported advisories (all dev-only — the runtime dependencies `nodes7`/`node-snap7` had 0 vulnerabilities and the published tarball never bundled these packages). The remaining 3 advisories live inside the `npm` CLI that `@node-red/registry` bundles and cannot be overridden; they are dev-only and not exercised by the build or tests

### Changed
- `package.json` `main` now resolves to a real module (`dist/nodes/index.js` re-exporting the shared types) instead of a non-existent file

## [0.0.4] - 2026-04-22

### Added
- **Offline CFG import**: New `cfg-parser` and `tia-xml-parser` modules parse STEP 7 `.cfg` files (and embedded TIA Portal XML) for fully offline tag discovery — no live PLC connection required
- **s7-browse offline source**: Browse dialog now offers a `cfg` source next to `live`, with dynamic UI updates and label rendering for cached configurations
- **s7-config CFG upload endpoint**: New HTTP endpoint accepts `.cfg` uploads, with structured error handling and response payload
- **s7-read CFG-driven tag picker**: Select tags from an imported CFG without typing addresses manually
- **Repository metadata**: Added `repository`, `bugs` and `homepage` to `package.json` so npm shows the GitHub link, issue tracker and README
- **`test-assets/` folder**: Repository folder for external S7 test files (tag lists, flows, PLC sources, captures, datasheets); excluded from npm tarball and Docker image
- **Sample CFG**: `test-assets/prod.cfg` (4 436 lines) — real production STEP 7 configuration to exercise the offline CFG-import path

### Changed
- **`.dockerignore`**: Added `test-assets/` and `misc/` so heavy assets stay out of the Docker build context

### Tested
- New unit tests for `cfg-parser`, `tia-xml-parser`, and the CFG-import code paths in `s7-browse` and `s7-config`
- All 401+ existing tests still pass

## [0.0.3] - 2026-04-17

### Added
- **Excel/XLSX bulk import**: s7-read node now supports importing tag lists from `.xlsx`/`.xls`/`.xlsm`/`.xlsb`/`.ods` files (lazy-loaded SheetJS from CDN, no runtime npm dependency)
- **Import feedback**: User-visible notifications via `RED.notify` for import success, warnings (no tags found) and errors
- **Docker deployment**: New `Dockerfile`, `docker-compose.yml` and `.dockerignore` for one-command Node-RED setup with the S7 nodes pre-installed
- **MIT LICENSE file**: Added (the package was already declared MIT in `package.json`)
- **README**: Comprehensive rewrite with comparison table against existing S7 Node-RED packages, Why-section, troubleshooting, contribution guide, and bulk-import highlight

### Changed
- **Address list height**: Edit dialog address list grew from 80 px to 300 px minimum (~6× larger) and now follows the dialog size via `oneditresize`
- **Schema list height**: Struct schema list also grew from 80 px to 250 px minimum and resizes with the dialog
- **Import button label**: Renamed from "Import CSV" to "Import CSV/Excel"

### Fixed
- **`.gitignore`**: Extended with sensible defaults (`.env`, IDE files, OS files, Docker overrides, logs, `misc/` for vendor docs)

### Tested
- End-to-end Docker test: container build, all 6 nodes loaded, sim-backend single read, object read with labels, write + readback through HTTP endpoints
- Browser-verified UI: address list height confirmed at ~535 px (was ~80 px before)

## [0.0.2] - 2026-03-12

### Added
- **Multi-Write**: s7-write accepts object payload `{MB0: 255, MW2: 1234}` for batch writes
- **Struct-Write**: s7-write struct mode with schema (counterpart to s7-read struct mode)
- **CPU-Control node**: New s7-control node for Start/Stop/Cold Start (snap7 only)
- **S7 time types**: DATE, TIME, TIME_OF_DAY, DATE_AND_TIME, S5TIME
- **S7-1500 unsigned types**: USINT, UINT, UDINT, LINT, ULINT
- **WSTRING**: Unicode string support for S7-1500
- **Counter/Timer**: C and T area support in browse and address parser
- **Password protection**: Credentials-based session password for protected CPUs (snap7)
- **Browse live-refresh**: Refresh button in all browse dialogs
- **TSAP for all PLC types**: Local/Remote TSAP fields visible for all PLC types, not just LOGO

### Changed
- **Request-Timeout**: Queue enforces requestTimeout with automatic reconnect on timeout
- **Connection-Status**: s7-config warns child nodes on disconnect/error, logs on reconnect
- **Address parser**: Area addresses support array notation (e.g. MB0.10 for 10 bytes)
- **Counter/Timer default**: C/T addresses default to WORD (16-bit) instead of BYTE

### Tested
- Verified with real S7-300 CPU 314 via ACCON-NetLink-PRO compact adapter
- 314 unit tests passing

## [0.0.1] - 2026-03-08

### Added
- Initial release with 5 Node-RED nodes: s7-config, s7-read, s7-write, s7-trigger, s7-browse
- Dual backend support: nodes7 (pure JS) + node-snap7 (native, optional)
- Built-in simulator backend for development
- Multiple address formats: nodes7-style, IEC-style, area-style
- PLC block browsing with category filtering
- Connection manager with auto-reconnect and exponential backoff
- Request queue with rate limiting
- Edge detection (rising/falling/any) and deadband filtering
- s7-read output modes: single, object, buffer, struct, bits
- Docker Compose setup for quick testing
- 299 unit tests with 80%+ coverage

### Infrastructure
- GitHub Actions CI with Node.js 18, 20, 22 matrix
- ESLint + Prettier code formatting
- Jest test framework with coverage thresholds
