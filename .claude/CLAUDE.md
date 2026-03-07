# Project: node-red-contrib-s7-suite

Node-RED package for Siemens S7 PLC communication with dual backend support (nodes7 + node-snap7).

## Test PLC
- IP: 192.168.1.100 (Siemens PLC available for testing)

## Commands
- `npm run build` - TypeScript compile + copy HTML
- `npm test` - Jest with coverage
- `npm run lint` - ESLint

## Architecture
- src/types/ - Type definitions
- src/backend/ - IS7Backend interface + NodeS7Backend + Snap7Backend + BackendFactory
- src/core/ - ConnectionManager, AddressParser, DataConverter, RateLimiter, Poller
- src/nodes/ - 5 Node-RED nodes (s7-config, s7-read, s7-write, s7-trigger, s7-browse)
- test/ - Jest tests with MockBackend helper
