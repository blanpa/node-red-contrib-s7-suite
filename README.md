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
- **s7-read** — Read multiple addresses at once, output as single messages or combined object
- **s7-write** — Write data to PLC memory areas with dynamic address via `msg.topic`
- **s7-trigger** — Polling with edge detection and deadband filtering
- **s7-browse** — Discover PLC data blocks with category filtering and search

### Supported PLCs

S7-200, S7-300, S7-400, S7-1200, S7-1500, LOGO!

### Backends

| Backend | Package | Description |
|---------|---------|-------------|
| nodes7 | `nodes7` | Pure JavaScript, no native compilation needed |
| snap7 | `node-snap7` | Native library via Snap7, optional |
| sim | built-in | Simulation backend for development and testing |

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

Node-RED is then available at [http://localhost:1880](http://localhost:1880) with the S7 nodes pre-installed.

## Development Setup

### Prerequisites

- Node.js >= 18
- npm

### Getting Started

```bash
git clone https://github.com/<your-org>/node-red-contrib-s7-suite.git
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
│   └── s7-browse/
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
