# S7 Suite Memory

## Project
- Node-RED package for Siemens S7 PLC communication
- Dual backends: nodes7 (pure JS), snap7 (native C), sim (simulator)
- TypeScript, Jest, ESLint+Prettier

## Test PLC
- 192.168.1.100 (Siemens S7-1200)
- Simulator backend available (backend: "sim")

## Node-RED Test
- Port 1884 used for testing
- User dir: /home/la/.node-red
- Install: npm pack → cd ~/.node-red → npm install <tgz>

## Open Improvements (user approved all 5)
1. Browse-Dialog auch im Trigger-Node HTML hinzufuegen
2. splitAddresses ersetzen: editableList Widget fuer Multi-Adressen statt fragiles Leerzeichen-Splitting
3. Browse-Baum statt flache 762-Eintraege: Baumstruktur (DB1 → aufklappen → REAL/INT/BOOL)
4. Simulator mit dynamischen Werten: Sinus, Counter etc. damit Trigger sinnvoll testen
5. Connection-Status-Dot im Editor neben Server-Dropdown

## Key Files
- src/backend/sim-backend.ts - Simulator backend
- src/core/address-parser.ts - splitAddresses() needs rework
- src/nodes/s7-config/s7-config.ts - Browse API endpoint /s7-suite/browse/:id
- src/nodes/s7-read/s7-read.html - Has browse dialog
- src/nodes/s7-write/s7-write.html - Has browse dialog
- src/nodes/s7-trigger/s7-trigger.html - MISSING browse dialog
- examples/test-flows.json - Full test flows with sim backend

## Architecture Notes
- Address separator: space-separated (not comma, conflicts with DB1,REAL0)
- Browse API: GET /s7-suite/browse/:id returns {addresses: [{address, type, size, info}]}
- ConnectionManager has setMaxListeners(50) for many nodes
- S7ConfigNode interface in separate s7-config-types.ts (not in s7-config.ts due to export= conflict)
