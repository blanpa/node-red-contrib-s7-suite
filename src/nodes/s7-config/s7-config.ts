import { NodeAPI, Node, NodeDef } from 'node-red';
import { ConnectionManager } from '../../core/connection-manager';
import { createBackend, isSnap7Available } from '../../backend/backend-factory';
import { PlcType, BackendType, PLC_DEFAULT_SLOTS } from '../../types/s7-connection';
import { S7ConfigNode } from './s7-config-types';
import { readValue } from '../../core/data-converter';
import { parseAddress } from '../../core/address-parser';
import { AREA_CODE_MAP } from '../../types/s7-address';
import { parseCfg } from '../../core/cfg-parser';
import { parseTiaXml } from '../../core/tia-xml-parser';

interface S7ConfigNodeDef extends NodeDef {
  host: string;
  port: number;
  rack: number;
  slot: number;
  plcType: PlcType;
  backend: BackendType;
  localTSAP?: string;
  remoteTSAP?: string;
  connectionTimeout: number;
  requestTimeout: number;
  reconnectInterval: number;
  maxReconnectInterval: number;
}

export = function (RED: NodeAPI): void {
  function S7ConfigNodeConstructor(this: S7ConfigNode, config: S7ConfigNodeDef): void {
    RED.nodes.createNode(this, config);

    const childNodes = new Set<Node>();

    this.registerChildNode = (node: Node): void => {
      childNodes.add(node);
    };

    this.deregisterChildNode = (node: Node): void => {
      childNodes.delete(node);
    };

    const plcType = config.plcType || 'S7-1200';
    const slot = config.slot ?? PLC_DEFAULT_SLOTS[plcType];

    this.s7Config = {
      host: config.host || '192.168.0.1',
      port: config.port || 102,
      rack: config.rack ?? 0,
      slot,
      plcType,
      backend: config.backend || 'nodes7',
      localTSAP: config.localTSAP ? parseInt(config.localTSAP, 16) : undefined,
      remoteTSAP: config.remoteTSAP ? parseInt(config.remoteTSAP, 16) : undefined,
      password: (this as any).credentials?.password || undefined, // eslint-disable-line @typescript-eslint/no-explicit-any
      connectionTimeout: config.connectionTimeout || 5000,
      requestTimeout: config.requestTimeout || 3000,
      reconnectInterval: config.reconnectInterval || 1000,
      maxReconnectInterval: config.maxReconnectInterval || 30000,
    };

    const validationError = validateConfig(this.s7Config);
    if (validationError) {
      this.error(`Invalid S7 config: ${validationError}`);
    }

    const backend = createBackend(this.s7Config.backend);
    this.connectionManager = new ConnectionManager(backend, this.s7Config);

    this.connectionManager.on('stateChanged', ({ newState }) => {
      this.log(`Connection state: ${newState}`);
      if (newState === 'error' || newState === 'disconnected') {
        this.warn(`Connection ${newState}: ${this.s7Config.host}:${this.s7Config.port}`);
      } else if (newState === 'connected') {
        this.log(`Connected to PLC at ${this.s7Config.host}:${this.s7Config.port}`);
      }
    });

    if (!validationError) {
      this.connectionManager.connect().catch((err: Error) => {
        this.error(`Failed to connect to ${this.s7Config.host}:${this.s7Config.port}: ${err.message}`);
      });
    }

    this.on('close', (done: () => void) => {
      this.connectionManager.disconnect().then(done).catch(done);
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  RED.nodes.registerType('s7-config', S7ConfigNodeConstructor as any, {
    credentials: {
      password: { type: 'password' },
    },
  });

  RED.httpAdmin.get('/s7-suite/snap7-available', (_req, res) => {
    res.json({ available: isSnap7Available() });
  });

  RED.httpAdmin.get('/s7-suite/plc-defaults', (_req, res) => {
    res.json(PLC_DEFAULT_SLOTS);
  });

  RED.httpAdmin.post('/s7-suite/cfg-import', (req, res) => {
    const body = req.body as { content?: unknown } | undefined;
    const content = body && typeof body.content === 'string' ? body.content : null;
    if (!content) {
      res.status(400).json({ error: 'Expected JSON body with string "content" field' });
      return;
    }
    try {
      const parsed = parseCfg(content);
      res.json(parsed);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  RED.httpAdmin.post('/s7-suite/tia-xml-import', (req, res) => {
    const body = req.body as { content?: unknown } | undefined;
    const content = body && typeof body.content === 'string' ? body.content : null;
    if (!content) {
      res.status(400).json({ error: 'Expected JSON body with string "content" field' });
      return;
    }
    try {
      const parsed = parseTiaXml(content);
      res.json(parsed);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  RED.httpAdmin.get('/s7-suite/connection-state/:id', (req, res) => {
    const configNode = RED.nodes.getNode(req.params.id) as S7ConfigNode | null;
    if (!configNode) {
      res.json({ state: 'unknown' });
      return;
    }
    res.json({ state: configNode.connectionManager.getState() });
  });

  // Browse endpoint: returns address list from connected PLC
  RED.httpAdmin.get('/s7-suite/browse/:id', async (req, res) => {
    const configNode = RED.nodes.getNode(req.params.id) as S7ConfigNode | null;
    if (!configNode) {
      res.status(404).json({ error: 'Config node not found' });
      return;
    }

    if (configNode.connectionManager.getState() !== 'connected') {
      res.status(503).json({ error: 'Not connected to PLC' });
      return;
    }

    try {
      const backend = configNode.connectionManager.getBackend();
      const isSnap7Backend = configNode.s7Config.backend === 'snap7';
      const addresses: Array<{ address: string; type: string; size: number; info?: string; value?: unknown }> = [];

      // Track area buffers for value reading: key = "area:dbNumber", value = { areaCode, dbNumber, size }
      const areaBufferInfo: Array<{ areaCode: number; dbNumber: number; size: number }> = [];

      // Browse DBs
      if (isSnap7Backend) {
        try {
          const dbNumbers = await backend.listBlocksOfType('DB');
          for (const dbNum of dbNumbers) {
            try {
              const info = await backend.getBlockInfo('DB', dbNum);
              addDbAddresses(addresses, dbNum, info.sizeData);
              areaBufferInfo.push({ areaCode: 0x84, dbNumber: dbNum, size: info.sizeData });
            } catch { /* skip */ }
          }
        } catch { /* skip */ }
      } else {
        // Probe-based: test DB1..DB20
        const maxDb = 20;
        for (let db = 1; db <= maxDb; db++) {
          try {
            await configNode.connectionManager.readRawArea(0x84, db, 0, 1);
            // DB exists - find size
            let size = 1;
            for (const testSize of [1000, 500, 200, 100, 50, 20, 10, 4, 2]) {
              try {
                await configNode.connectionManager.readRawArea(0x84, db, testSize - 1, 1);
                size = testSize;
                break;
              } catch { /* too large */ }
            }
            addDbAddresses(addresses, db, size);
            areaBufferInfo.push({ areaCode: 0x84, dbNumber: db, size });
          } catch { /* DB doesn't exist */ }
        }
      }

      // Probe Merker
      let merkerSize = 0;
      try {
        await configNode.connectionManager.readRawArea(0x83, 0, 0, 1);
        merkerSize = 32;
        for (let i = 0; i < 32; i++) {
          addresses.push({ address: `MB${i}`, type: 'BYTE', size: 1, info: 'Merker' });
        }
        for (let i = 0; i < 16; i++) {
          addresses.push({ address: `MW${i * 2}`, type: 'WORD', size: 2, info: 'Merker' });
        }
        for (let i = 0; i < 256; i++) {
          addresses.push({ address: `M${Math.floor(i / 8)}.${i % 8}`, type: 'BOOL', size: 0, info: 'Merker' });
          if (i >= 63) break; // limit
        }
      } catch { /* no merker access */ }
      if (merkerSize > 0) {
        areaBufferInfo.push({ areaCode: 0x83, dbNumber: 0, size: merkerSize });
      }

      // Probe Inputs
      let inputSize = 0;
      try {
        await configNode.connectionManager.readRawArea(0x81, 0, 0, 1);
        inputSize = 8;
        for (let i = 0; i < 8; i++) {
          addresses.push({ address: `IB${i}`, type: 'BYTE', size: 1, info: 'Input' });
        }
        for (let i = 0; i < 64; i++) {
          addresses.push({ address: `I${Math.floor(i / 8)}.${i % 8}`, type: 'BOOL', size: 0, info: 'Input' });
        }
      } catch { /* no input access */ }
      if (inputSize > 0) {
        areaBufferInfo.push({ areaCode: 0x81, dbNumber: 0, size: inputSize });
      }

      // Probe Outputs
      let outputSize = 0;
      try {
        await configNode.connectionManager.readRawArea(0x82, 0, 0, 1);
        outputSize = 8;
        for (let i = 0; i < 8; i++) {
          addresses.push({ address: `QB${i}`, type: 'BYTE', size: 1, info: 'Output' });
        }
        for (let i = 0; i < 64; i++) {
          addresses.push({ address: `Q${Math.floor(i / 8)}.${i % 8}`, type: 'BOOL', size: 0, info: 'Output' });
        }
      } catch { /* no output access */ }
      if (outputSize > 0) {
        areaBufferInfo.push({ areaCode: 0x82, dbNumber: 0, size: outputSize });
      }

      // Read current values from PLC
      try {
        // Read all area buffers once
        const areaCodeToKey = (areaCode: number, dbNumber: number): string => `${areaCode}:${dbNumber}`;
        const bufferCache = new Map<string, Buffer>();

        for (const info of areaBufferInfo) {
          const key = areaCodeToKey(info.areaCode, info.dbNumber);
          try {
            const buf = await configNode.connectionManager.readRawArea(info.areaCode, info.dbNumber, 0, info.size);
            bufferCache.set(key, buf);
          } catch { /* skip - buffer won't be available for this area */ }
        }

        // Extract values for each address
        for (const entry of addresses) {
          try {
            const parsed = parseAddress(entry.address);
            const areaCode = AREA_CODE_MAP[parsed.area];
            if (areaCode === undefined) continue;
            const dbNum = parsed.area === 'DB' ? parsed.dbNumber : 0;
            const key = areaCodeToKey(areaCode, dbNum);
            const buf = bufferCache.get(key);
            if (!buf) continue;
            entry.value = readValue(buf, parsed.offset, parsed.dataType, parsed.bitOffset);
          } catch { /* skip individual address */ }
        }
      } catch { /* value reading failed - addresses still returned without values */ }

      res.json({ addresses });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
};

function validateConfig(cfg: {
  host: string;
  port: number;
  rack: number;
  slot: number;
  localTSAP?: number;
  remoteTSAP?: number;
}): string | null {
  if (!cfg.host || typeof cfg.host !== 'string' || cfg.host.trim() === '') {
    return 'host is required';
  }
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) {
    return `invalid port: ${cfg.port}`;
  }
  if (!Number.isInteger(cfg.rack) || cfg.rack < 0 || cfg.rack > 7) {
    return `invalid rack: ${cfg.rack} (expected 0-7)`;
  }
  if (!Number.isInteger(cfg.slot) || cfg.slot < 0 || cfg.slot > 31) {
    return `invalid slot: ${cfg.slot} (expected 0-31)`;
  }
  if (cfg.localTSAP !== undefined && (Number.isNaN(cfg.localTSAP) || cfg.localTSAP < 0 || cfg.localTSAP > 0xffff)) {
    return `invalid localTSAP`;
  }
  if (cfg.remoteTSAP !== undefined && (Number.isNaN(cfg.remoteTSAP) || cfg.remoteTSAP < 0 || cfg.remoteTSAP > 0xffff)) {
    return `invalid remoteTSAP`;
  }
  return null;
}

function addDbAddresses(
  addresses: Array<{ address: string; type: string; size: number; info?: string; value?: unknown }>,
  dbNum: number,
  dbSize: number,
): void {
  const info = `DB${dbNum} (${dbSize} bytes)`;

  // Generate common typed addresses for the DB
  for (let offset = 0; offset + 4 <= dbSize; offset += 4) {
    addresses.push({ address: `DB${dbNum},REAL${offset}`, type: 'REAL', size: 4, info });
  }
  for (let offset = 0; offset + 4 <= dbSize; offset += 4) {
    addresses.push({ address: `DB${dbNum},DINT${offset}`, type: 'DINT', size: 4, info });
  }
  for (let offset = 0; offset + 2 <= dbSize; offset += 2) {
    addresses.push({ address: `DB${dbNum},INT${offset}`, type: 'INT', size: 2, info });
  }
  for (let offset = 0; offset + 2 <= dbSize; offset += 2) {
    addresses.push({ address: `DB${dbNum},WORD${offset}`, type: 'WORD', size: 2, info });
  }
  for (let offset = 0; offset < dbSize; offset++) {
    addresses.push({ address: `DB${dbNum},BYTE${offset}`, type: 'BYTE', size: 1, info });
  }
  for (let offset = 0; offset < Math.min(dbSize, 32); offset++) {
    for (let bit = 0; bit < 8; bit++) {
      addresses.push({ address: `DB${dbNum},BOOL${offset}.${bit}`, type: 'BOOL', size: 0, info });
    }
  }
}
