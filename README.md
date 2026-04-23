# node-red-contrib-s7-suite

Node-RED nodes for Siemens S7 PLC communication with dual backend support.

## Overview

s7-suite is a TypeScript-based Node-RED package for communicating with Siemens S7 PLCs. It supports multiple communication backends and is designed for both production deployments and hardware-free development.

### Highlights

**Multiple backends** — Pick the backend that fits your environment per connection:
- `nodes7` — pure JavaScript, no native compilation required
- `node-snap7` — native Snap7 library, enables advanced features like block listing, SZL reads, and CPU control
- `sim` — built-in simulator generating dynamic values (sine waves, counters, sawtooth signals) for development without a physical PLC

**Flexible address formats** — Write addresses in the style you prefer: nodes7-style (`DB1,REAL0`), IEC-style (`DB1.DBD0`), or area-style (`MW4`, `I0.1`, `QD8`). The address parser handles conversion transparently.

**Smart polling** — The trigger node supports edge detection (`rising`, `falling`, `any`) for booleans and configurable deadband for numeric values, reducing unnecessary messages in flows.

**PLC browsing** — Discover data blocks directly from Node-RED. With snap7 this uses native block listing; with nodes7 a probe-based approach with rate limiting explores the PLC address space safely.

**Robust connections** — Connection manager with request queuing (max 100), automatic reconnection with exponential backoff, and structured error codes (`S7Error` with error code and cause chain).

**Flexible read/write modes** — Single values, combined objects, raw buffers, structured schemas, or unpacked bit arrays.

**Bulk tag import** — Import full PLC tag lists from TIA Portal (`.xlsx`) or Step 7 symbol exports (`.csv`/`.tsv`) into the read node with one click. Auto-detects column names (`name`/`symbol`/`tag` and `address`) and separators (tab/semicolon/comma). Imported tags get human-readable labels used as object keys in the output.

**Offline CFG import** — Upload a STEP 7 `.cfg` file (or embedded TIA Portal XML) to discover tags and pick addresses **without a live PLC connection**. Useful for engineering offline, reviewing code, or demoing flows. The browse dialog can switch between `live` and `cfg` source on the fly.

## Features

- **s7-config** — Connection configuration with backend selection and auto-reconnect
- **s7-read** — Read PLC data in multiple output modes: single value, combined object, raw buffer, struct, or bit array
- **s7-write** — Write data to PLC memory areas with dynamic address via `msg.topic`
- **s7-trigger** — Polling with edge detection and deadband filtering
- **s7-browse** — Discover PLC data blocks with category filtering and search; supports both live PLC and offline `.cfg` import
- **s7-control** — CPU control actions: Start, Stop, Cold Start (snap7 backend only)

### Supported PLCs

S7-200, S7-300, S7-400, S7-1200, S7-1500, LOGO!

### Backends

| Backend | Package | Description |
|---------|---------|-------------|
| nodes7 | `nodes7` | Pure JavaScript, no native compilation needed |
| snap7 | `node-snap7` | Native library via Snap7, optional |
| sim | built-in | Simulation backend for development and testing |

### Node API

#### s7-read

| Property | Type | Description |
|----------|------|-------------|
| `msg.topic` | string | Overrides configured address |
| `msg.outputMode` | string | Overrides output mode (`single`, `object`, `buffer`, `struct`, `bits`) |
| `msg.schema` | object[] | Overrides struct schema (struct mode only) |
| `msg.payload` | any | Output: read value(s) |

**Output modes:**
- **single** — `msg.payload` = single value (or object if multiple addresses)
- **object** — `msg.payload` = `{ "DB1,REAL0": 23.5, "DB1,INT4": 100 }`
- **buffer** — `msg.payload` = raw `Buffer` of the requested memory area
- **struct** — `msg.payload` = `{ fieldName: value, ... }` based on schema definition
- **bits** — `msg.payload` = `boolean[]` with each bit unpacked (LSB first per byte)

#### s7-write

| Property | Type | Description |
|----------|------|-------------|
| `msg.topic` | string | Overrides configured address |
| `msg.mode` | string | Overrides write mode (`single`, `multi`, `struct`) |
| `msg.schema` | object[] | Overrides struct schema (struct mode only) |
| `msg.payload` | any | Value to write (type must match address data type) |

On success, the input message is passed through to the output.

#### s7-trigger

| Property | Type | Description |
|----------|------|-------------|
| `msg.interval` | number | Input: override polling interval (ms) |
| `msg.edgeMode` | string | Input: override edge mode (`any`, `rising`, `falling`) |
| `msg.deadband` | number | Input: override deadband threshold |
| `msg.payload` | any | Output: new value |
| `msg.topic` | string | Output: address that changed |
| `msg.oldValue` | any | Output: previous value |

#### s7-browse

Send any message to trigger. Output `msg.payload` contains `{ blocks, areas, addresses, cpuInfo? }`.

#### s7-control

| Property | Type | Description |
|----------|------|-------------|
| `msg.payload` | string | Input: action override (`start`, `stop`, `coldstart`, `reset`) |
| `msg.payload` | object | Output: `{ action, success: true }` |

Requires the **snap7** backend. Send a message to execute the configured action, or override via `msg.payload`.

## Troubleshooting

**node-snap7 not installed** — The snap7 backend requires the native `node-snap7` package. Install it with `npm install node-snap7`. If compilation fails, ensure build tools are installed (`build-essential` on Debian/Ubuntu, Xcode CLI tools on macOS).

**Connection timeout** — Verify the PLC IP is reachable (`ping <ip>`). Check that rack/slot values match your hardware. For S7-1200/1500, ensure "Permit access with PUT/GET" is enabled in the PLC settings.

**LOGO connection** — LOGO PLCs require TSAP-based connections. Set PLC Type to "LOGO" and configure Local TSAP (e.g. `0x0100`) and Remote TSAP (e.g. `0x0200`).

**Address parse errors** — Verify address format. Examples: `DB1,REAL0`, `DB1.DBD0`, `MW4`, `I0.1`, `QB0`. See the address format table above.

**Excel import does nothing** — XLSX parsing requires the SheetJS library, which is loaded on demand from a public CDN. If your Node-RED editor runs in an air-gapped environment, export your tag list as `.csv` from Excel/TIA Portal instead.

**Remote I/O via Profibus/Profinet not browsable** — The browse node scans local rack I/O (areas I/Q, M, DB, C, T) and PLC blocks. Distributed I/O addresses on remote stations (Profibus DP couplers, Profinet IO) are reachable for read/write using the standard `IB`/`IW`/`ID`/`QB`/`QW`/`QD` syntax with the absolute peripheral address, but they will not appear in the browse results since they are not enumerable through the standard S7 protocol.

**Offline browsing without a PLC** — Switch the browse dialog source from `live` to `cfg` and upload a STEP 7 `.cfg` export of your hardware configuration. Tags from the cfg are then available in the address picker just like live blocks. Sample file: [`test-assets/prod.cfg`](test-assets/prod.cfg).

## Test Assets

The [`test-assets/`](test-assets/) folder in the repo contains shared test material for contributors and bug reproductions:

- `tag-lists/` — sample CSV/Excel tag exports for the bulk-import feature
- `flows/` — reproducible Node-RED flows that exercise specific scenarios
- `plc-programs/` — STEP 7 / TIA Portal source code that produced the test data
- `captures/` — Wireshark `.pcap`s with the S7Comm dissector
- `docs/` — datasheets, screenshots, vendor manuals

This folder is **not shipped** with the npm package or Docker image. See [`test-assets/README.md`](test-assets/README.md) for conventions when contributing files.

## Installation

### Node-RED Palette

Search for `node-red-contrib-s7-suite` in the Node-RED palette manager.

### npm

```bash
cd ~/.node-red
npm install node-red-contrib-s7-suite
```

### Docker

```bash
docker compose up -d
```

Node-RED is then available at [http://localhost:1885](http://localhost:1885) with the S7 nodes pre-installed.

## Development Setup

### Prerequisites

- Node.js >= 18
- npm

### Getting Started

```bash
git clone https://github.com/lagramm/node-red-contrib-s7-suite.git
cd node-red-contrib-s7-suite
npm install
npm run build
```

### Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript and copy HTML/icons to `dist/` |
| `npm test` | Run tests with coverage (threshold: 80%) |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Run ESLint with auto-fix |
| `npm run format` | Format code with Prettier |

### Project Structure

```
src/
├── backend/        # PLC communication backends (nodes7, snap7, sim)
├── core/           # Address parser, connection manager, poller, rate limiter
├── nodes/          # Node-RED node definitions (HTML + TypeScript)
│   ├── s7-config/
│   ├── s7-read/
│   ├── s7-write/
│   ├── s7-trigger/
│   ├── s7-browse/
│   ├── s7-control/
│   └── shared/      # Shared helpers (status updater)
├── types/          # TypeScript type definitions
├── utils/          # Error codes and helpers
└── icons/          # Node icons
test/
├── helpers/        # Test utilities and mocks
└── unit/           # Unit tests (backend + core)
```

## Contributing

Contributions are welcome! Please follow these steps:

### 1. Fork & Branch

```bash
git checkout -b feature/my-feature
```

Use a descriptive branch name with a prefix:
- `feature/` for new features
- `fix/` for bug fixes
- `docs/` for documentation changes
- `refactor/` for code refactoring

### 2. Code Style

This project uses ESLint and Prettier. Make sure your code passes linting before committing:

```bash
npm run lint
npm run format
```

### 3. Tests

All new features and bug fixes must include tests. The project enforces a minimum coverage threshold of **80%** on branches, functions, lines, and statements.

```bash
npm test
```

### 4. Commit Messages

Use clear, concise commit messages:

```
feat: add support for S7-1500 optimized blocks
fix: handle connection timeout on slow networks
docs: add Docker deployment instructions
```

### 5. Pull Request

- Make sure all tests pass and linting is clean
- Provide a clear description of what your PR does and why
- Reference any related issues

### Development Tips

- Use the **sim backend** for development — no physical PLC required
- Import `examples/test-flows.json` into Node-RED for a ready-made test setup
- Run the project in Docker for a quick local environment: `docker compose up -d`

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release notes.

## License

[MIT](LICENSE)
