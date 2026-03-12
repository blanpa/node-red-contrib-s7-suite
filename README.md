# node-red-contrib-s7-suite

Node-RED nodes for Siemens S7 PLC communication with dual backend support.

## Why s7-suite?

Existing Node-RED packages for S7 communication each lock you into a single communication library and come with trade-offs:

| | s7-suite | node-red-contrib-s7 | node-red-contrib-s7comm | node-red-contrib-snap7 |
|---|---|---|---|---|
| Backend | nodes7 + snap7 + sim | nodes7 only | nodes7 only | snap7 only |
| Native compilation required | No (optional) | No | No | Yes |
| Built-in simulator | Yes | No | No | No |
| PLC block browsing | Yes | No | No | No |
| Edge detection & deadband | Yes | Diff mode | No | No |
| Auto-reconnect with backoff | Yes | Basic | Basic | No |
| Request queue & rate limiting | Yes | No | No | No |
| Multiple address formats | nodes7, IEC, area | nodes7 only | Custom | snap7 only |
| Array reads | Yes | Partial | No | Yes |
| TypeScript | Yes | No | No | No |
| License | MIT | GPL-3.0 | MIT | MIT |

### Key Advantages

**Flexible backend selection** — Choose between `nodes7` (pure JavaScript, zero native dependencies), `node-snap7` (native Snap7 library for advanced features like block listing and SZL reads), or `sim` (built-in simulator). Switch backends per connection without changing your flows.

**Development without hardware** — The simulation backend generates dynamic values (sine waves, counters, sawtooth signals) so you can build and test flows without a physical PLC.

**Smart polling** — The trigger node supports edge detection (`rising`, `falling`, `any`) for booleans and configurable deadband for numeric values, reducing unnecessary messages in your flows.

**PLC browsing** — Discover available data blocks directly from Node-RED. With snap7 this uses native block listing; with nodes7 a probe-based approach with rate limiting automatically explores the PLC address space without overloading it.

**Robust connections** — A connection manager with request queuing (max 100), automatic reconnection with exponential backoff, and structured error codes (`S7Error` with error code and cause chain) keeps your flows running reliably.

**Multiple address formats** — Write addresses in whatever style you prefer: nodes7-style (`DB1,REAL0`), IEC-style (`DB1.DBD0`), or area-style (`MW4`, `I0.1`, `QD8`). The address parser handles conversion transparently.

## Features

- **s7-config** — Connection configuration with backend selection and auto-reconnect
- **s7-read** — Read PLC data in multiple output modes: single value, combined object, raw buffer, struct, or bit array
- **s7-write** — Write data to PLC memory areas with dynamic address via `msg.topic`
- **s7-trigger** — Polling with edge detection and deadband filtering
- **s7-browse** — Discover PLC data blocks with category filtering and search
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

## License

[MIT](LICENSE)
