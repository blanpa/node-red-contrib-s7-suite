#!/usr/bin/env node
/**
 * Test: S7-300 auslesen über ACCON-NetLink-PRO compact
 *
 * NetLink IP: 192.168.1.101
 * CPU: S7-300, CPU 314 (MPI-Busadresse 2 → Rack=0, Slot=2)
 */

const { Snap7Backend } = require('./dist/backend/snap7-backend');
const { NodeS7Backend } = require('./dist/backend/nodes7-backend');

const CONFIG = {
  host: '192.168.1.101',
  port: 102,
  rack: 0,
  slot: 2,
  plcType: 'S7-300',
  backend: 'snap7',
  connectionTimeout: 5000,
  requestTimeout: 3000,
};

async function testSnap7() {
  console.log('=== Test mit snap7 Backend ===\n');
  const backend = new Snap7Backend();

  try {
    console.log(`Verbinde zu ${CONFIG.host}:${CONFIG.port} (Rack=${CONFIG.rack}, Slot=${CONFIG.slot})...`);
    await backend.connect(CONFIG);
    console.log('✓ Verbunden!\n');

    // Merker lesen (MB0-MB9)
    console.log('--- Merker (MB0-MB9) ---');
    try {
      const merkerBuf = await backend.readRawArea(0x83, 0, 0, 10);
      for (let i = 0; i < merkerBuf.length; i++) {
        console.log(`  MB${i} = ${merkerBuf[i]} (0x${merkerBuf[i].toString(16).padStart(2, '0')})`);
      }
    } catch (e) {
      console.log(`  Fehler: ${e.message}`);
    }

    // Eingänge lesen (EB0-EB3)
    console.log('\n--- Eingänge (EB0-EB3) ---');
    try {
      const inputBuf = await backend.readRawArea(0x81, 0, 0, 4);
      for (let i = 0; i < inputBuf.length; i++) {
        const bits = inputBuf[i].toString(2).padStart(8, '0');
        console.log(`  EB${i} = ${inputBuf[i]} (0b${bits})`);
      }
    } catch (e) {
      console.log(`  Fehler: ${e.message}`);
    }

    // Ausgänge lesen (AB0-AB3)
    console.log('\n--- Ausgänge (AB0-AB3) ---');
    try {
      const outputBuf = await backend.readRawArea(0x82, 0, 0, 4);
      for (let i = 0; i < outputBuf.length; i++) {
        const bits = outputBuf[i].toString(2).padStart(8, '0');
        console.log(`  AB${i} = ${outputBuf[i]} (0b${bits})`);
      }
    } catch (e) {
      console.log(`  Fehler: ${e.message}`);
    }

    // DB1 versuchen
    console.log('\n--- DB1 (20 Bytes) ---');
    try {
      const db1Buf = await backend.readRawArea(0x84, 1, 0, 20);
      console.log(`  DB1: ${db1Buf.toString('hex')}`);
    } catch (e) {
      console.log(`  DB1 nicht vorhanden: ${e.message}`);
    }

    // Block-Liste (snap7-spezifisch)
    console.log('\n--- Block-Liste ---');
    try {
      const blocks = await backend.listBlocks();
      console.log('  Blocks:', JSON.stringify(blocks));
    } catch (e) {
      console.log(`  Fehler: ${e.message}`);
    }

    // CPU-Info über SZL
    console.log('\n--- CPU-Info (SZL 0x001C) ---');
    try {
      const szl = await backend.readSZL(0x001C, 0);
      // Parse module identification
      let text = '';
      for (let i = 0; i < szl.length; i++) {
        if (szl[i] >= 0x20 && szl[i] <= 0x7e) text += String.fromCharCode(szl[i]);
        else if (text.trim()) { text += ' | '; }
      }
      console.log(`  SZL: ${text.trim()}`);
      console.log(`  Raw (first 64 bytes): ${szl.slice(0, 64).toString('hex')}`);
    } catch (e) {
      console.log(`  Fehler: ${e.message}`);
    }

  } catch (e) {
    console.error(`Verbindungsfehler (snap7): ${e.message}`);
  } finally {
    await backend.disconnect();
    console.log('\n✓ snap7 disconnected');
  }
}

async function testNodes7() {
  console.log('\n\n=== Test mit nodes7 Backend ===\n');
  const backend = new NodeS7Backend();

  try {
    console.log(`Verbinde zu ${CONFIG.host}:${CONFIG.port} (Rack=${CONFIG.rack}, Slot=${CONFIG.slot})...`);
    await backend.connect({ ...CONFIG, backend: 'nodes7' });
    console.log('✓ Verbunden!\n');

    // Merker lesen
    console.log('--- Merker (MB0-MB9) ---');
    try {
      const merkerBuf = await backend.readRawArea(0x83, 0, 0, 10);
      for (let i = 0; i < merkerBuf.length; i++) {
        console.log(`  MB${i} = ${merkerBuf[i]} (0x${merkerBuf[i].toString(16).padStart(2, '0')})`);
      }
    } catch (e) {
      console.log(`  Fehler: ${e.message}`);
    }

    // Eingänge
    console.log('\n--- Eingänge (EB0-EB3) ---');
    try {
      const inputBuf = await backend.readRawArea(0x81, 0, 0, 4);
      for (let i = 0; i < inputBuf.length; i++) {
        const bits = inputBuf[i].toString(2).padStart(8, '0');
        console.log(`  EB${i} = ${inputBuf[i]} (0b${bits})`);
      }
    } catch (e) {
      console.log(`  Fehler: ${e.message}`);
    }

    // Ausgänge
    console.log('\n--- Ausgänge (AB0-AB3) ---');
    try {
      const outputBuf = await backend.readRawArea(0x82, 0, 0, 4);
      for (let i = 0; i < outputBuf.length; i++) {
        const bits = outputBuf[i].toString(2).padStart(8, '0');
        console.log(`  AB${i} = ${outputBuf[i]} (0b${bits})`);
      }
    } catch (e) {
      console.log(`  Fehler: ${e.message}`);
    }

    // Typed read über die read()-Methode
    console.log('\n--- Typed Read (MW0 als INT) ---');
    try {
      const results = await backend.read([
        { name: 'MW0', address: { area: 'M', dataType: 'INT', offset: 0, bitOffset: 0, dbNumber: 0 } },
        { name: 'MW2', address: { area: 'M', dataType: 'INT', offset: 2, bitOffset: 0, dbNumber: 0 } },
        { name: 'M0.0', address: { area: 'M', dataType: 'BOOL', offset: 0, bitOffset: 0, dbNumber: 0 } },
        { name: 'M0.1', address: { area: 'M', dataType: 'BOOL', offset: 0, bitOffset: 1, dbNumber: 0 } },
      ]);
      for (const r of results) {
        console.log(`  ${r.name} = ${r.value} (${r.quality})`);
      }
    } catch (e) {
      console.log(`  Fehler: ${e.message}`);
    }

  } catch (e) {
    console.error(`Verbindungsfehler (nodes7): ${e.message}`);
  } finally {
    await backend.disconnect();
    console.log('\n✓ nodes7 disconnected');
  }
}

(async () => {
  await testSnap7();
  await testNodes7();
  console.log('\n=== Fertig ===');
})();
