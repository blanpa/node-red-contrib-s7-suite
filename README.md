# node-red-contrib-s7-suite

[![Sponsor](https://img.shields.io/github/sponsors/blanpa?label=Sponsor&logo=githubsponsors&logoColor=white&color=EA4AAA)](https://github.com/sponsors/blanpa)

Node-RED nodes for Siemens S7 PLC communication with dual backend support.

## Overview

s7-suite is a TypeScript-based Node-RED package for communicating with Siemens S7 PLCs. It supports multiple communication backends and is designed for both production deployments and hardware-free development.

### Highlights

**Multiple backends** — Pick the backend that fits your environment per connection:
- `nodes7` — pure JavaScript, no native compilation required
- `node-snap7` — native Snap7 library, enables advanced features like block listing, SZL reads, and CPU control
- `sim` — built-in simulator generating dynamic values (sine waves, counters, sawtooth signals) for development without a physical PLC

**Flexible address formats** — Write addresses in the style you prefer: nodes7-style (`DB1,REAL0`), IEC-style (`DB1.DBD0`), or area-style (`MW4`, `I0.1`, `QD8`). The address parser handles conversion transparently. See [Addresses and data types](#addresses-and-data-types).

**Smart polling** — The trigger node supports edge detection (`rising`, `falling`, `any`) for booleans and configurable deadband for numeric values, reducing unnecessary messages in flows.

**PLC browsing** — Discover data blocks directly from Node-RED. With snap7 this uses native block listing; with nodes7 a probe-based approach with rate limiting explores the PLC address space safely.

**Robust connections** — Connection manager with request queuing (max 100), automatic reconnection with exponential backoff, a link check while idle so the node status follows the PLC, and structured error codes (`S7Error` with error code and cause chain).

**Flexible read/write modes** — Single values, combined objects, raw buffers, structured schemas, or unpacked bit arrays.

**Bulk tag import** — Import full PLC tag lists into the read node with one click. Supported files: a TIA Portal tag table Export (`.xlsx`, `.xml` or `.sdf`), SimaticML XML from TIA Portal Openness (`.xml`), Step 7 symbol exports (`.csv`/`.tsv`), and STEP 7 V5 hardware configuration exports (`.cfg`). For CSV and Excel it auto-detects column names (`name`/`symbol`/`tag` and `address`) and separators (tab/semicolon/comma). Imported tags get human-readable labels used as object keys in the output.

**Offline CFG import** — Upload a STEP 7 `.cfg` file to discover tags and pick addresses **without a live PLC connection**. Useful for engineering offline, reviewing code, or demoing flows. The browse dialog can switch between `live` and `cfg` source on the fly.

## Features

- **s7-config** — Connection configuration with backend selection and auto-reconnect. Host, port, rack, slot, TSAPs and timeouts can each come from an environment variable, so one flow can run against different PLCs
- **s7-read** — Read PLC data in multiple output modes: single value, combined object, raw buffer, struct, or bit array
- **s7-write** — Write single values, arrays, strings or whole structs to PLC memory areas, with dynamic address via `msg.topic`
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

### Addresses and data types

Three address styles are accepted and can be mixed freely:

| Style | Examples |
|-------|----------|
| nodes7 | `DB1,REAL0` · `DB1,X0.3` · `DB1,INT20.3` · `DB1,STRING50.20` |
| IEC | `DB1.DBX0.3` · `DB1.DBB4` · `DB1.DBW6` · `DB1.DBD8` |
| Area | `M0.1` · `MB4` · `MW6` · `MD8` · `I0.0` · `IB0` · `QW2` · `C1` · `T2` |

What the numbers after the offset mean depends on the type:

| Address | Meaning |
|---------|---------|
| `DB1,X10.3` · `M10.3` | bit 3 of byte 10 (`BOOL` can be written instead of `X`) |
| `DB1,X10.3.8` · `M10.3.8` | 8 consecutive bits starting at bit 3 of byte 10 — an `Array[0..7] of Bool` |
| `DB1,INT20.3` · `MB20.3` | array of 3 values. The longer form `DB1,INT20.0.3` means the same |
| `DB1,STRING50.20` | a `STRING[20]` at offset 50. The length can be left off when writing a string that is already declared in the PLC |

An address with a length reads as an array and is written from an array of exactly that many values; a byte array also accepts a `Buffer`.

| Type | Size | Value in Node-RED | nodes7 backend |
|------|------|-------------------|----------------|
| `BOOL` / `X` | 1 bit | boolean | ✓ |
| `BYTE`, `CHAR` | 1 byte | number, 1-character string | ✓ |
| `WORD`, `INT` | 2 bytes | number | ✓ |
| `DWORD`, `DINT` | 4 bytes | number | ✓ |
| `REAL`, `LREAL` | 4 / 8 bytes | number | ✓ |
| `STRING` | length + 2 bytes | string | ✓ (reads need the length in the address) |
| `DT`, `DTZ` | 8 bytes | `Date` — a PLC `DATE_AND_TIME`, as server-local time (`DT`) or UTC (`DTZ`) | ✓ |
| `DTL`, `DTLZ` | 12 bytes | `Date` — a PLC `DTL`, as server-local time (`DTL`) or UTC (`DTLZ`) | ✓ |
| `USINT`, `UINT`, `UDINT` | 1 / 2 / 4 bytes | number | snap7 only |
| `LINT`, `ULINT` | 8 bytes | number, BigInt or string (see below) | snap7 only |
| `WSTRING` | 2 × length + 4 bytes | string | writes only; reads need snap7 |
| `DATE` | 2 bytes | string `YYYY-MM-DD` | snap7 only |
| `TIME`, `TIME_OF_DAY` | 4 bytes | number (ms) | snap7 only |
| `S5TIME` | 2 bytes | number (ms) | snap7 only |
| `DATE_AND_TIME` | 8 bytes | ISO string (UTC) | snap7 only |

The `sim` backend supports every type. Counters and timers (`C1`, `T2`) also need the snap7 backend. On the nodes7 backend an unsupported type is reported as an error that names the address, never as a silent `null`.

**Dates** — Writes to `DT`, `DTZ`, `DTL` and `DTLZ` accept a `Date`, an ISO string or milliseconds since 1970. A PLC date has no time zone: use the `Z` form when the PLC keeps UTC, the plain form when it keeps local time.

**64-bit integers** — A JavaScript number is exact only up to 2^53. The **LINT/ULINT as** setting on `s7-config` chooses how `LINT` and `ULINT` are returned: *Number* (default), *BigInt* (exact, but cannot pass through `JSON.stringify`, so not through MQTT or HTTP) or *String* (exact and safe to send anywhere). Writes accept all three.

**Strings** — A write changes only the string's current length and characters, never its declared max length or anything after it. A value longer than the string is rejected.

### Environment variables

Host, port, rack, slot, the TSAPs, the timeouts and the reconnect intervals on `s7-config` each take either a value or the name of an environment variable (pick `env` in the field's type menu). Node-RED's flow and global environment variables work as well as the process environment, so the same flow can be deployed against different PLCs. A variable that is unset, or not a number where one is needed, is reported as a config error and the node does not connect — it never falls back to a default.

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
| `msg.interval` | number | Input: override polling interval (ms) — see note below |
| `msg.edgeMode` | string | Input: override edge mode (`any`, `rising`, `falling`) |
| `msg.deadband` | number | Input: override deadband threshold |
| `msg.payload` | any | Output: new value |
| `msg.topic` | string | Output: address that changed |
| `msg.oldValue` | any | Output: previous value |

> **Note:** the three input properties are not usable yet: the node currently has no input port ([#29](https://github.com/blanpa/node-red-contrib-s7-suite/issues/29)).

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

**LOGO connection** — LOGO PLCs require TSAP-based connections. Set PLC Type to "LOGO" and configure Local TSAP (e.g. `0x0100`) and Remote TSAP (e.g. `0x0200`). TSAPs are hex: `0x0100`, `0100` and `01.00` (as LOGO! Soft Comfort shows them) all mean the same, and a decimal number is read as hex too.

**Address parse errors** — Verify address format. Examples: `DB1,REAL0`, `DB1.DBD0`, `MW4`, `I0.1`, `QB0`. See [Addresses and data types](#addresses-and-data-types).

**"isn't supported by the nodes7 backend"** — nodes7 has no support for that data type (see the table in [Addresses and data types](#addresses-and-data-types)). Switch the connection's backend to `snap7`.

**"bad quality for …"** — The PLC rejected the address: the DB does not exist, or the address runs past the end of the DB or area.

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
git clone https://github.com/blanpa/node-red-contrib-s7-suite.git
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

## Contributors

Thanks to everyone who has contributed code, bug reports and test material:

| | Contributor | Contributions |
|---|---|---|
| <img src="https://github.com/blanpa.png?size=48" width="48" height="48" alt=""> | [@blanpa](https://github.com/blanpa) | Author and maintainer |
| <img src="https://github.com/Steve-Mcl.png?size=48" width="48" height="48" alt=""> | [@Steve-Mcl](https://github.com/Steve-Mcl) | Editor fixes and layout, environment variables for connection settings, `DT`/`DTL` and exact 64-bit types, string writes, connection-loss detection, error messages, TIA Portal `.xml`/`.sdf` import, and many backend fixes (0.1.0) |
| <img src="https://github.com/birosz.png?size=48" width="48" height="48" alt=""> | [@birosz](https://github.com/birosz) | Test material and bug reports |

Bug reports that led to fixes: [@BurgerMirco](https://github.com/BurgerMirco), [@robbin2109](https://github.com/robbin2109).

Want to be on this list? See [Contributing](#contributing).

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release notes.

## Sponsor this project

This package is developed and maintained in my own time.
If it saves you some, consider supporting it:

<a href="https://github.com/sponsors/blanpa">
  <img height="41" alt="Sponsor on GitHub" src="https://img.shields.io/badge/Sponsor%20on%20GitHub-EA4AAA?style=for-the-badge&logo=githubsponsors&logoColor=white">
</a>
<a href="https://buymeacoffee.com/blanpa">
  <img height="41" alt="Buy Me a Coffee" src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png">
</a>

## License

Apache License 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE).

Copyright 2026 blanpa

## Contributing and forks

Pull requests are welcome, including large ones. If you are planning a bigger
change — a dependency migration, a restructure, new nodes — please open an issue
first. We are happy to discuss it and to land substantial work here; that is
usually less effort than maintaining a parallel package, and it keeps a single
place for users to report bugs.

If you do publish a fork under its own package name, please also rename the
Node-RED node type IDs (for example `myprefix-s7-suite-*`) and use your own palette
category. Node-RED refuses to register a node type that is already claimed, so
identical type IDs make it impossible to install both packages side by side.

