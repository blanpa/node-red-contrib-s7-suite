# Changelog

All notable changes to this project will be documented in this file.

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
