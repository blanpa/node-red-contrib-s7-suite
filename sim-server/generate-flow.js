/**
 * Generates examples/sim-deployment.json — a Node-RED flow with one config + test
 * group per simulated PLC variant. Run from repo root: node sim-server/generate-flow.js
 */
const fs = require('fs');
const path = require('path');

const variants = [
  { id: 's7-1200', host: 's7-1200-sim', plcType: 'S7-1200', rack: 0, slot: 1, backend: 'snap7', label: 'S7-1200' },
  { id: 's7-1500', host: 's7-1500-sim', plcType: 'S7-1500', rack: 0, slot: 1, backend: 'snap7', label: 'S7-1500' },
  { id: 's7-300',  host: 's7-300-sim',  plcType: 'S7-300',  rack: 0, slot: 2, backend: 'snap7', label: 'S7-300'  },
  { id: 's7-400',  host: 's7-400-sim',  plcType: 'S7-400',  rack: 0, slot: 3, backend: 'snap7', label: 'S7-400'  },
  { id: 's7-200',  host: 's7-200-sim',  plcType: 'S7-200',  rack: 0, slot: 1, backend: 'nodes7', label: 'S7-200 (TSAP)', localTSAP: '1000', remoteTSAP: '1000' },
  { id: 'logo',    host: 's7-logo-sim', plcType: 'LOGO',    rack: 0, slot: 2, backend: 'nodes7', label: 'LOGO (TSAP)',  localTSAP: '0100', remoteTSAP: '0200' },
];

const flows = [];

flows.push({
  id: 'tab-sim',
  type: 'tab',
  label: 'S7 Sim Deployment',
  disabled: false,
  info: '# S7 Simulation Deployment\n\nOne group per simulated PLC variant. Each container runs a node-snap7 server seeded with DB1.\n\n## Live signals in DB1 (per simulator)\n- `DB1,REAL0` — temperature (drifts around 23.5)\n- `DB1,INT4` — counter (increments per second)\n- `DB1,BOOL6.0` — heartbeat (toggles every 5s)\n- `DB1,DINT8` — 123456 (static)\n- `DB1,STRING12` — "S7-SIM" (static)\n\n## Hosts (from inside Docker network)\n- s7-1200-sim:102, s7-1500-sim:102, s7-300-sim:102, s7-400-sim:102, s7-200-sim:102, s7-logo-sim:102\n\n## From host machine\n- localhost:1102..1107 — same mapping order\n',
});

// One config node per variant.
for (const v of variants) {
  flows.push({
    id: `cfg-${v.id}`,
    type: 's7-config',
    name: `${v.label} Simulator`,
    host: v.host,
    port: 102,
    rack: v.rack,
    slot: v.slot,
    plcType: v.plcType,
    backend: v.backend,
    localTSAP: v.localTSAP || '',
    remoteTSAP: v.remoteTSAP || '',
    connectionTimeout: 5000,
    requestTimeout: 3000,
    reconnectInterval: 2000,
    maxReconnectInterval: 30000,
  });
}

// Global header comment.
flows.push({
  id: 'cmt-header',
  type: 'comment',
  z: 'tab-sim',
  name: '=== S7 Simulation Deployment — 6 PLC variants ===',
  info: 'Each simulator container runs node-snap7 S7Server seeded with DB1.\nUse the inject nodes to read live signals, write a REAL, and browse DBs.',
  x: 280,
  y: 30,
});

const X_BASE = 160;
const X_NODE = 410;
const X_DEBUG = 700;
const Y_GROUP_HEIGHT = 280;
let yCursor = 80;

for (const v of variants) {
  const yHeader = yCursor;
  const yRead = yCursor + 40;
  const yWrite = yCursor + 100;
  const yBrowse = yCursor + 160;
  const yStatus = yCursor + 220;

  // Group header
  flows.push({
    id: `cmt-${v.id}`,
    type: 'comment',
    z: 'tab-sim',
    name: `--- ${v.label}  (${v.host}:102 · rack=${v.rack} · slot=${v.slot} · backend=${v.backend}) ---`,
    info: '',
    x: 280,
    y: yHeader,
  });

  // 1. Read (auto every 2s)
  flows.push({
    id: `inj-read-${v.id}`,
    type: 'inject',
    z: 'tab-sim',
    name: 'Read DB1,REAL0 (2s)',
    props: [{ p: 'topic', vt: 'str', v: 'DB1,REAL0' }],
    repeat: '2',
    crontab: '',
    once: true,
    onceDelay: 1,
    topic: 'DB1,REAL0',
    x: X_BASE,
    y: yRead,
    wires: [[`read-${v.id}`]],
  });
  flows.push({
    id: `read-${v.id}`,
    type: 's7-read',
    z: 'tab-sim',
    name: 'Read REAL0',
    server: `cfg-${v.id}`,
    address: '',
    outputMode: 'single',
    topic: '',
    x: X_NODE,
    y: yRead,
    wires: [[`dbg-read-${v.id}`]],
  });
  flows.push({
    id: `dbg-read-${v.id}`,
    type: 'debug',
    z: 'tab-sim',
    name: `${v.label}: REAL0`,
    active: true,
    tosidebar: true,
    console: false,
    complete: 'payload',
    targetType: 'msg',
    x: X_DEBUG,
    y: yRead,
    wires: [],
  });

  // 2. Write
  flows.push({
    id: `inj-write-${v.id}`,
    type: 'inject',
    z: 'tab-sim',
    name: 'Write DB1,REAL100 = 99.9',
    props: [
      { p: 'topic', vt: 'str', v: 'DB1,REAL100' },
      { p: 'payload' },
    ],
    repeat: '',
    crontab: '',
    once: false,
    onceDelay: 0.1,
    topic: 'DB1,REAL100',
    payload: '99.9',
    payloadType: 'num',
    x: X_BASE,
    y: yWrite,
    wires: [[`write-${v.id}`]],
  });
  flows.push({
    id: `write-${v.id}`,
    type: 's7-write',
    z: 'tab-sim',
    name: 'Write REAL100',
    server: `cfg-${v.id}`,
    address: '',
    x: X_NODE,
    y: yWrite,
    wires: [[`dbg-write-${v.id}`]],
  });
  flows.push({
    id: `dbg-write-${v.id}`,
    type: 'debug',
    z: 'tab-sim',
    name: `${v.label}: Write ack`,
    active: true,
    tosidebar: true,
    console: false,
    complete: 'true',
    targetType: 'full',
    x: X_DEBUG,
    y: yWrite,
    wires: [],
  });

  // 3. Browse
  flows.push({
    id: `inj-browse-${v.id}`,
    type: 'inject',
    z: 'tab-sim',
    name: 'Browse DBs',
    props: [],
    repeat: '',
    crontab: '',
    once: false,
    onceDelay: 0.1,
    topic: '',
    x: X_BASE,
    y: yBrowse,
    wires: [[`browse-${v.id}`]],
  });
  flows.push({
    id: `browse-${v.id}`,
    type: 's7-browse',
    z: 'tab-sim',
    name: 'Browse',
    server: `cfg-${v.id}`,
    scopeDB: true,
    scopeM: true,
    scopeI: true,
    scopeQ: true,
    maxDbNumber: 50,
    x: X_NODE,
    y: yBrowse,
    wires: [[`dbg-browse-${v.id}`]],
  });
  flows.push({
    id: `dbg-browse-${v.id}`,
    type: 'debug',
    z: 'tab-sim',
    name: `${v.label}: Browse result`,
    active: true,
    tosidebar: true,
    console: false,
    complete: 'payload',
    targetType: 'msg',
    x: X_DEBUG,
    y: yBrowse,
    wires: [],
  });

  // 4. Trigger (poll INT4 counter, fire on change)
  flows.push({
    id: `trig-${v.id}`,
    type: 's7-trigger',
    z: 'tab-sim',
    name: 'Poll DB1,INT4 (on change)',
    server: `cfg-${v.id}`,
    address: 'DB1,INT4',
    interval: 1000,
    edgeMode: 'any',
    deadband: 0,
    x: X_NODE,
    y: yStatus,
    wires: [[`dbg-trig-${v.id}`]],
  });
  flows.push({
    id: `dbg-trig-${v.id}`,
    type: 'debug',
    z: 'tab-sim',
    name: `${v.label}: Counter`,
    active: false,
    tosidebar: true,
    console: false,
    complete: 'payload',
    targetType: 'msg',
    x: X_DEBUG,
    y: yStatus,
    wires: [],
  });

  yCursor += Y_GROUP_HEIGHT;
}

const outFile = path.join(__dirname, '..', 'examples', 'sim-deployment.json');
fs.writeFileSync(outFile, JSON.stringify(flows, null, 2) + '\n');
console.log(`Wrote ${flows.length} nodes to ${outFile}`);
