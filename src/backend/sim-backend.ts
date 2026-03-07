import { IS7Backend } from './s7-backend.interface';
import { S7ConnectionConfig } from '../types/s7-connection';
import { S7ReadItem, S7ReadResult, S7WriteItem } from '../types/s7-address';
import { S7BlockInfo, S7BlockList, S7BlockType } from '../types/s7-browse';
import { byteLength, readValue, writeValue } from '../core/data-converter';

export class SimBackend implements IS7Backend {
  private connected = false;
  private memory: Map<string, Buffer> = new Map();

  async connect(_config: S7ConnectionConfig): Promise<void> {
    // Initialize simulated DB1 with 100 bytes
    this.initArea('DB:1', 100);
    // Initialize Merker, Input, Output areas
    this.initArea('M:0', 256);
    this.initArea('I:0', 32);
    this.initArea('Q:0', 32);

    // Set some initial values in DB1
    const db1 = this.memory.get('DB:1')!;
    db1.writeFloatBE(23.5, 0);      // DB1,REAL0 = 23.5
    db1.writeInt16BE(42, 4);         // DB1,INT4 = 42
    db1.writeUInt8(0x05, 6);         // DB1,BOOL6.0 = true, DB1,BOOL6.2 = true
    db1.writeInt32BE(123456, 8);     // DB1,DINT8 = 123456
    db1.writeUInt16BE(0xCAFE, 12);   // DB1,WORD12 = 0xCAFE
    db1.writeUInt32BE(0xDEADBEEF, 14); // DB1,DWORD14
    db1.writeUInt8(0x55, 18);        // DB1,BYTE18 = 0x55

    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async read(items: S7ReadItem[]): Promise<S7ReadResult[]> {
    return items.map((item) => {
      try {
        const addr = item.address;
        const key = this.areaKey(addr.area, addr.dbNumber);
        const buf = this.memory.get(key);

        if (!buf) {
          return {
            name: item.name, address: addr, value: null,
            quality: 'bad' as const, timestamp: Date.now(),
            error: `Area ${key} not found`,
          };
        }

        const len = byteLength(addr.dataType, addr.stringLength);
        if (addr.offset + len > buf.length) {
          return {
            name: item.name, address: addr, value: null,
            quality: 'bad' as const, timestamp: Date.now(),
            error: `Offset ${addr.offset} out of range (area size: ${buf.length})`,
          };
        }

        const value = readValue(buf, addr.offset, addr.dataType, addr.bitOffset);

        return {
          name: item.name, address: addr, value,
          quality: 'good' as const, timestamp: Date.now(),
        };
      } catch (err) {
        return {
          name: item.name, address: item.address, value: null,
          quality: 'bad' as const, timestamp: Date.now(),
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });
  }

  async write(items: S7WriteItem[]): Promise<void> {
    for (const item of items) {
      const addr = item.address;
      const key = this.areaKey(addr.area, addr.dbNumber);
      let buf = this.memory.get(key);

      if (!buf) {
        // Auto-create area
        const size = Math.max(addr.offset + byteLength(addr.dataType, addr.stringLength), 100);
        this.initArea(key, size);
        buf = this.memory.get(key)!;
      }

      writeValue(buf, addr.offset, addr.dataType, item.value, addr.bitOffset);
    }
  }

  async readRawArea(area: number, dbNumber: number, start: number, length: number): Promise<Buffer> {
    const areaMap: Record<number, string> = {
      0x81: 'I', 0x82: 'Q', 0x83: 'M', 0x84: 'DB',
    };
    const areaName = areaMap[area];
    if (!areaName) throw new Error(`Unknown area code: ${area}`);

    const key = areaName === 'DB' ? `DB:${dbNumber}` : `${areaName}:0`;
    const buf = this.memory.get(key);

    if (!buf) throw new Error(`Area ${key} not found`);
    if (start + length > buf.length) throw new Error(`Out of range: ${start}+${length} > ${buf.length}`);

    return Buffer.from(buf.subarray(start, start + length));
  }

  async listBlocks(): Promise<S7BlockList> {
    const dbCount = [...this.memory.keys()].filter((k) => k.startsWith('DB:')).length;
    return {
      OBCount: 1, DBCount: dbCount, SDBCount: 0,
      FCCount: 0, SFCCount: 0, FBCount: 0, SFBCount: 0,
    };
  }

  async listBlocksOfType(blockType: S7BlockType): Promise<number[]> {
    if (blockType === 'DB') {
      return [...this.memory.keys()]
        .filter((k) => k.startsWith('DB:'))
        .map((k) => parseInt(k.split(':')[1], 10))
        .sort((a, b) => a - b);
    }
    return [];
  }

  async getBlockInfo(blockType: S7BlockType, blockNumber: number): Promise<S7BlockInfo> {
    const key = `${blockType === 'DB' ? 'DB' : blockType}:${blockNumber}`;
    const buf = this.memory.get(key);
    return {
      blockType,
      blockNumber,
      sizeData: buf ? buf.length : 0,
      author: 'SIM',
      family: 'TEST',
      name: `Simulated ${blockType}${blockNumber}`,
    };
  }

  async readSZL(_id: number, _index: number): Promise<Buffer> {
    // Return simulated CPU info
    return Buffer.from('S7-1200 Simulator', 'ascii');
  }

  private areaKey(area: string, dbNumber: number): string {
    return area === 'DB' ? `DB:${dbNumber}` : `${area}:0`;
  }

  private initArea(key: string, size: number): void {
    if (!this.memory.has(key)) {
      this.memory.set(key, Buffer.alloc(size));
    }
  }
}
