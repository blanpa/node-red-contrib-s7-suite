import { NodeAPI, Node, NodeDef, NodeMessage } from 'node-red';
import { S7ConfigNode } from '../s7-config/s7-config-types';
import { RateLimiter } from '../../core/rate-limiter';
import { IS7Backend } from '../../backend/s7-backend.interface';
import { BrowseResult, BrowseScope, AreaInfo } from '../../types/s7-browse';
import { S7DataType } from '../../types/s7-address';
import { readValue } from '../../core/data-converter';
import { createStatusUpdater } from '../shared/status-helper';

interface S7BrowseNodeDef extends NodeDef {
  server: string;
  scopeDB: boolean;
  scopeM: boolean;
  scopeI: boolean;
  scopeQ: boolean;
  scopeC: boolean;
  scopeT: boolean;
  maxDbNumber: number;
}

export = function (RED: NodeAPI): void {
  function S7BrowseNodeConstructor(this: Node, config: S7BrowseNodeDef): void {
    RED.nodes.createNode(this, config);

    const serverNode = RED.nodes.getNode(config.server) as S7ConfigNode | null;
    if (!serverNode) {
      this.status({ fill: 'red', shape: 'ring', text: 'no config' });
      return;
    }

    let browsing = false;

    const baseStatusUpdater = createStatusUpdater(this);
    const updateStatus = ({ newState }: { newState: string }) => {
      if (browsing) return;
      if (newState === 'connected') {
        this.status({ fill: 'green', shape: 'dot', text: 'ready' });
      } else {
        baseStatusUpdater({ newState });
      }
    };

    serverNode.connectionManager.on('stateChanged', updateStatus);
    updateStatus({ newState: serverNode.connectionManager.getState() });

    this.on('input', async (msg: NodeMessage, _send, done) => {
      const send = _send || ((m: NodeMessage) => this.send(m));

      if (browsing) {
        done(new Error('Browse already in progress'));
        return;
      }

      browsing = true;

      const scope: BrowseScope[] = [];
      if (config.scopeDB !== false) scope.push('DB');
      if (config.scopeM) scope.push('M');
      if (config.scopeI) scope.push('I');
      if (config.scopeQ) scope.push('Q');
      if (config.scopeC) scope.push('C');
      if (config.scopeT) scope.push('T');

      try {
        const backend = serverNode.connectionManager.getBackend();
        const isSnap7 = serverNode.s7Config.backend === 'snap7';

        let result: BrowseResult;
        if (isSnap7) {
          result = await browseSnap7(backend, scope, (progress) => {
            this.status({
              fill: 'blue',
              shape: 'ring',
              text: `${progress.phase}: ${progress.percent}%`,
            });
          });
        } else {
          result = await browseProbe(
            serverNode.connectionManager,
            scope,
            config.maxDbNumber || 999,
            (progress) => {
              this.status({
                fill: 'blue',
                shape: 'ring',
                text: `${progress.phase}: ${progress.percent}%`,
              });
            },
          );
        }

        send({ ...msg, payload: result } as NodeMessage);
        done();
      } catch (err) {
        done(err instanceof Error ? err : new Error(String(err)));
      } finally {
        browsing = false;
        updateStatus({ newState: serverNode.connectionManager.getState() });
      }
    });

    this.on('close', () => {
      if (serverNode) {
        serverNode.connectionManager.removeListener('stateChanged', updateStatus);
      }
    });
  }

  RED.nodes.registerType('s7-browse', S7BrowseNodeConstructor);
};

async function browseSnap7(
  backend: IS7Backend,
  scope: BrowseScope[],
  onProgress: (p: { phase: string; current: number; total: number; percent: number }) => void,
): Promise<BrowseResult> {
  const result: BrowseResult = { blocks: [], areas: [] };

  if (scope.includes('DB')) {
    onProgress({ phase: 'Listing blocks', current: 0, total: 1, percent: 0 });
    result.addresses = result.addresses || [];

    try {
      const dbNumbers = await backend.listBlocksOfType('DB');
      const total = dbNumbers.length;

      for (let i = 0; i < dbNumbers.length; i++) {
        onProgress({
          phase: 'Reading DB info',
          current: i + 1,
          total,
          percent: Math.round(((i + 1) / total) * 100),
        });

        try {
          const info = await backend.getBlockInfo('DB', dbNumbers[i]);
          result.blocks.push(info);

          // Read raw data and extract values
          if (info.sizeData > 0) {
            try {
              const buffer = await backend.readRawArea(0x84, dbNumbers[i], 0, info.sizeData);
              const addrValues = extractDbAddressValues(dbNumbers[i], buffer, info.sizeData);
              result.addresses.push(...addrValues);
            } catch {
              // Skip if raw read fails
            }
          }
        } catch {
          // Skip inaccessible blocks
        }
      }
    } catch {
      // ListBlocksOfType not supported
    }
  }

  // Try to read SZL for CPU info
  try {
    const szlData = await backend.readSZL(0x001c, 0);
    result.cpuInfo = { rawSZL: szlData.toString('hex') };
  } catch {
    // SZL not available
  }

  onProgress({ phase: 'Done', current: 1, total: 1, percent: 100 });
  return result;
}

interface ReadableConnectionManager {
  readRawArea(area: number, dbNumber: number, start: number, length: number): Promise<Buffer>;
}

async function browseProbe(
  connMgr: ReadableConnectionManager,
  scope: BrowseScope[],
  maxDbNumber: number,
  onProgress: (p: { phase: string; current: number; total: number; percent: number }) => void,
): Promise<BrowseResult> {
  const result: BrowseResult = { blocks: [], areas: [] };
  const rateLimiter = new RateLimiter({ tokensPerInterval: 10, interval: 1000, minDelay: 50 });

  if (scope.includes('DB')) {
    result.addresses = result.addresses || [];

    for (let db = 1; db <= maxDbNumber; db++) {
      onProgress({
        phase: 'Probing DBs',
        current: db,
        total: maxDbNumber,
        percent: Math.round((db / maxDbNumber) * 100),
      });

      await rateLimiter.acquire();

      try {
        await connMgr.readRawArea(0x84, db, 0, 1);
        // DB exists, find its size via binary search
        const size = await findDbSize(connMgr, db, rateLimiter);
        result.blocks.push({
          blockType: 'DB',
          blockNumber: db,
          sizeData: size,
        });

        // Read raw data and extract values
        if (size > 0) {
          try {
            const buffer = await connMgr.readRawArea(0x84, db, 0, size);
            const addrValues = extractDbAddressValues(db, buffer, size);
            result.addresses!.push(...addrValues);
          } catch {
            // Skip if raw read fails
          }
        }
      } catch {
        // DB doesn't exist
      }
    }
  }

  const areaProbes: Array<{ scope: BrowseScope; areaCode: number; name: string; defaultSize: number }> = [
    { scope: 'M', areaCode: 0x83, name: 'Merker', defaultSize: 256 },
    { scope: 'I', areaCode: 0x81, name: 'Input', defaultSize: 128 },
    { scope: 'Q', areaCode: 0x82, name: 'Output', defaultSize: 128 },
    { scope: 'C' as BrowseScope, areaCode: 0x1c, name: 'Counter', defaultSize: 64 },
    { scope: 'T' as BrowseScope, areaCode: 0x1d, name: 'Timer', defaultSize: 64 },
  ];

  for (const probe of areaProbes) {
    if (!scope.includes(probe.scope)) continue;

    onProgress({ phase: `Probing ${probe.name}`, current: 0, total: 1, percent: 0 });
    await rateLimiter.acquire();

    try {
      // Try reading the default area size
      const size = await findAreaSize(connMgr, probe.areaCode, probe.defaultSize, rateLimiter);
      const info: AreaInfo = { area: probe.name, size };
      result.areas.push(info);

      // Read raw buffer and extract values
      if (size > 0) {
        result.addresses = result.addresses || [];
        try {
          const buffer = await connMgr.readRawArea(probe.areaCode, 0, 0, size);
          const addrValues = extractAreaValues(`${probe.scope}`, buffer);
          result.addresses.push(...addrValues);
        } catch {
          // Skip if raw read fails
        }
      }
    } catch {
      // Area not accessible
    }
  }

  onProgress({ phase: 'Done', current: 1, total: 1, percent: 100 });
  return result;
}

async function findDbSize(
  connMgr: ReadableConnectionManager,
  dbNumber: number,
  rateLimiter: RateLimiter,
): Promise<number> {
  let low = 1;
  let high = 65536;
  let lastGood = 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    await rateLimiter.acquire();

    try {
      await connMgr.readRawArea(0x84, dbNumber, mid - 1, 1);
      lastGood = mid;
      low = mid + 1;
    } catch {
      high = mid - 1;
    }
  }

  return lastGood;
}

async function findAreaSize(
  connMgr: ReadableConnectionManager,
  areaCode: number,
  maxSize: number,
  rateLimiter: RateLimiter,
): Promise<number> {
  // Try reading 1 byte at offset 0 first
  await connMgr.readRawArea(areaCode, 0, 0, 1);

  let low = 1;
  let high = maxSize;
  let lastGood = 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    await rateLimiter.acquire();

    try {
      await connMgr.readRawArea(areaCode, 0, mid - 1, 1);
      lastGood = mid;
      low = mid + 1;
    } catch {
      high = mid - 1;
    }
  }

  return lastGood;
}

const BROWSE_TYPES: Array<{ type: S7DataType; size: number }> = [
  { type: 'REAL', size: 4 },
  { type: 'DINT', size: 4 },
  { type: 'INT', size: 2 },
  { type: 'WORD', size: 2 },
  { type: 'BYTE', size: 1 },
];

function extractDbAddressValues(
  dbNum: number,
  buffer: Buffer,
  dbSize: number,
): Array<{ address: string; type: string; value: unknown }> {
  const addresses: Array<{ address: string; type: string; value: unknown }> = [];

  for (const { type, size } of BROWSE_TYPES) {
    for (let offset = 0; offset + size <= dbSize && offset + size <= buffer.length; offset += size) {
      try {
        const value = readValue(buffer, offset, type);
        addresses.push({ address: `DB${dbNum},${type}${offset}`, type, value });
      } catch {
        // Skip on error
      }
    }
  }

  // BOOL: iterate every byte, every bit
  for (let offset = 0; offset < dbSize && offset < buffer.length; offset++) {
    for (let bit = 0; bit < 8; bit++) {
      try {
        const value = readValue(buffer, offset, 'BOOL', bit);
        addresses.push({ address: `DB${dbNum},BOOL${offset}.${bit}`, type: 'BOOL', value });
      } catch {
        // Skip on error
      }
    }
  }

  return addresses;
}

function extractAreaValues(
  prefix: string,
  buffer: Buffer,
): Array<{ address: string; type: string; value: unknown }> {
  const addresses: Array<{ address: string; type: string; value: unknown }> = [];
  const size = buffer.length;

  for (const { type, size: typeSize } of BROWSE_TYPES) {
    for (let offset = 0; offset + typeSize <= size; offset += typeSize) {
      try {
        const value = readValue(buffer, offset, type);
        addresses.push({ address: `${prefix}${type}${offset}`, type, value });
      } catch {
        // Skip on error
      }
    }
  }

  // BOOL
  for (let offset = 0; offset < size; offset++) {
    for (let bit = 0; bit < 8; bit++) {
      try {
        const value = readValue(buffer, offset, 'BOOL', bit);
        addresses.push({ address: `${prefix}BOOL${offset}.${bit}`, type: 'BOOL', value });
      } catch {
        // Skip on error
      }
    }
  }

  return addresses;
}
