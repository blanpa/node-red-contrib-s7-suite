/**
 * Configurable S7 PLC server simulator using node-snap7.
 *
 * Configured via env vars:
 *   PLC_TYPE     S7-200 | S7-300 | S7-400 | S7-1200 | S7-1500 | LOGO   (label only, default: S7-1200)
 *   BIND_ADDR    bind address                                           (default: 0.0.0.0)
 *   BIND_PORT    bind port                                              (default: 102 — ISO-on-TCP)
 *   DB_LIST      comma-separated DB numbers and sizes, e.g. "1:1024,2:512"   (default: "1:1024")
 *   TICK_MS      how often to mutate live signals                       (default: 1000)
 *
 * Initial DB1 layout (matches examples/sim-deployment.json):
 *   DB1,REAL0  = 23.5      (live: drifts ±0.5 per tick — "temperature")
 *   DB1,INT4   = 42        (live: counts up per tick — "counter")
 *   DB1,BOOL6.0= true      (live: toggles every 5 ticks — "heartbeat")
 *   DB1,DINT8  = 123456    (static)
 *   DB1,STRING12 = "S7-SIM" (254-byte STRING, static)
 */

const snap7 = require('node-snap7');

const PLC_TYPE = process.env.PLC_TYPE || 'S7-1200';
const BIND_ADDR = process.env.BIND_ADDR || '0.0.0.0';
const BIND_PORT = parseInt(process.env.BIND_PORT || '102', 10);
const TICK_MS = parseInt(process.env.TICK_MS || '1000', 10);
const DB_LIST = (process.env.DB_LIST || '1:1024')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [num, size] = s.split(':').map((x) => parseInt(x, 10));
    return { num, size: size || 1024 };
  });

const server = new snap7.S7Server();

// Allocate DBs and seed DB1.
const dbs = new Map();
for (const { num, size } of DB_LIST) {
  const buf = Buffer.alloc(size);
  dbs.set(num, buf);
  server.RegisterArea(server.srvAreaDB, num, buf);
}

const db1 = dbs.get(1);
if (db1) {
  db1.writeFloatBE(23.5, 0);          // DB1,REAL0
  db1.writeInt16BE(42, 4);             // DB1,INT4
  db1.writeUInt8(0x01, 6);             // DB1,BOOL6.0 = true
  db1.writeInt32BE(123456, 8);         // DB1,DINT8
  // STRING at offset 12: byte[0] = max len (254), byte[1] = actual len, then chars
  const text = 'S7-SIM';
  db1.writeUInt8(254, 12);
  db1.writeUInt8(text.length, 13);
  db1.write(text, 14, 'ascii');
}

// Also seed M (marker) and I/Q areas with a small buffer so reads from M, I, Q work.
const mBuf = Buffer.alloc(256);
const iBuf = Buffer.alloc(256);
const qBuf = Buffer.alloc(256);
server.RegisterArea(server.srvAreaMK, 0, mBuf);
server.RegisterArea(server.srvAreaPE, 0, iBuf);
server.RegisterArea(server.srvAreaPA, 0, qBuf);

mBuf.writeUInt8(0xa5, 0);  // MB0 = 0xA5 (static marker)
iBuf.writeUInt8(0x0f, 0);  // IB0 = 0x0F (static input pattern)

// Optional: log connection events for visibility.
server.SetEventsCallback((event) => {
  const ts = new Date().toISOString();
  const text = server.EventText(event);
  console.log(`[${ts}] [${PLC_TYPE}] ${text}`);
});

// Start listening.
const startErr = server.StartTo(BIND_ADDR);
if (startErr === 0) {
  console.log(`[${PLC_TYPE}] S7 server listening on ${BIND_ADDR}:${BIND_PORT}`);
  console.log(`[${PLC_TYPE}] DBs registered: ${[...dbs.keys()].map((k) => `DB${k}`).join(', ')}`);
} else {
  console.error(`[${PLC_TYPE}] Failed to start server: code ${startErr}`);
  process.exit(1);
}

// Mutate live signals on a tick to make the simulator behave like a running PLC.
let tickCount = 0;
const tickHandle = setInterval(() => {
  if (!db1) return;
  tickCount++;

  // Temperature drifts in a sine-ish pattern around 23.5
  const temp = 23.5 + Math.sin(tickCount / 10) * 5 + (Math.random() - 0.5);
  db1.writeFloatBE(temp, 0);

  // Counter increments and wraps at INT16 max
  const next = ((db1.readInt16BE(4) + 1) | 0) & 0xffff;
  db1.writeInt16BE(next > 0x7fff ? next - 0x10000 : next, 4);

  // Heartbeat toggles every 5 ticks
  if (tickCount % 5 === 0) {
    const cur = db1.readUInt8(6);
    db1.writeUInt8(cur ? 0 : 1, 6);
  }
}, TICK_MS);

// Graceful shutdown.
function shutdown(signal) {
  console.log(`[${PLC_TYPE}] Received ${signal}, shutting down...`);
  clearInterval(tickHandle);
  server.Stop();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
