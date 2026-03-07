import { IS7Backend } from './s7-backend.interface';
import { S7ConnectionConfig } from '../types/s7-connection';
import { S7ReadItem, S7ReadResult, S7WriteItem } from '../types/s7-address';
import { S7BlockInfo, S7BlockList, S7BlockType } from '../types/s7-browse';
import { byteLength, readValue, writeValue } from '../core/data-converter';
import { S7Error, S7ErrorCode } from '../utils/error-codes';

// snap7 area codes
const S7AreaDB = 0x84;
const S7AreaMK = 0x83;
const S7AreaPE = 0x81;
const S7AreaPA = 0x82;

const AREA_CODE_MAP: Record<string, number> = {
  DB: S7AreaDB,
  M: S7AreaMK,
  I: S7AreaPE,
  Q: S7AreaPA,
};

const BLOCK_TYPE_MAP: Record<S7BlockType, number> = {
  OB: 0x38,
  DB: 0x41,
  SDB: 0x42,
  FC: 0x43,
  SFC: 0x44,
  FB: 0x45,
  SFB: 0x46,
};

export class Snap7Backend implements IS7Backend {
  private client: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  private connected = false;

  async connect(config: S7ConnectionConfig): Promise<void> {
    let snap7: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      snap7 = require('node-snap7');
    } catch {
      throw new S7Error(
        S7ErrorCode.BACKEND_NOT_AVAILABLE,
        'node-snap7 is not installed. Install it with: npm install node-snap7',
      );
    }

    this.client = new snap7.S7Client();

    if (config.connectionTimeout) {
      this.client.SetParam(this.client.PingTimeout, config.connectionTimeout);
    }

    return new Promise<void>((resolve, reject) => {
      if (config.localTSAP !== undefined && config.remoteTSAP !== undefined) {
        this.client.SetConnectionParams(
          config.host,
          config.localTSAP,
          config.remoteTSAP,
        );
        this.client.Connect((err: Error | undefined) => {
          if (err) {
            reject(new S7Error(S7ErrorCode.CONNECTION_FAILED, `snap7 connection failed: ${err.message}`, err));
          } else {
            this.connected = true;
            resolve();
          }
        });
      } else {
        this.client.ConnectTo(config.host, config.rack, config.slot, (err: Error | undefined) => {
          if (err) {
            reject(new S7Error(S7ErrorCode.CONNECTION_FAILED, `snap7 connection failed: ${err.message}`, err));
          } else {
            this.connected = true;
            resolve();
          }
        });
      }
    });
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.Disconnect();
      this.connected = false;
      this.client = null;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async read(items: S7ReadItem[]): Promise<S7ReadResult[]> {
    if (!this.client || !this.connected) {
      throw new S7Error(S7ErrorCode.DISCONNECTED, 'Not connected');
    }

    const results: S7ReadResult[] = [];

    for (const item of items) {
      try {
        const addr = item.address;
        const areaCode = AREA_CODE_MAP[addr.area] ?? S7AreaDB;
        const len = byteLength(addr.dataType, addr.stringLength);
        const totalLen = addr.arrayLength ? len * addr.arrayLength : len;

        const buffer = await this.readRawArea(areaCode, addr.dbNumber, addr.offset, totalLen);

        let value: unknown;
        if (addr.arrayLength) {
          const arr: unknown[] = [];
          for (let i = 0; i < addr.arrayLength; i++) {
            arr.push(readValue(buffer, i * len, addr.dataType, addr.bitOffset));
          }
          value = arr;
        } else {
          value = readValue(buffer, 0, addr.dataType, addr.bitOffset);
        }

        results.push({
          name: item.name,
          address: addr,
          value,
          quality: 'good',
          timestamp: Date.now(),
        });
      } catch (err) {
        results.push({
          name: item.name,
          address: item.address,
          value: null,
          quality: 'bad',
          timestamp: Date.now(),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  }

  async write(items: S7WriteItem[]): Promise<void> {
    if (!this.client || !this.connected) {
      throw new S7Error(S7ErrorCode.DISCONNECTED, 'Not connected');
    }

    for (const item of items) {
      const addr = item.address;
      const areaCode = AREA_CODE_MAP[addr.area] ?? S7AreaDB;
      const len = byteLength(addr.dataType, addr.stringLength);

      if (addr.dataType === 'BOOL') {
        // Read-modify-write for booleans
        const buf = await this.readRawArea(areaCode, addr.dbNumber, addr.offset, 1);
        writeValue(buf, 0, 'BOOL', item.value, addr.bitOffset);
        await this.writeRawArea(areaCode, addr.dbNumber, addr.offset, 1, buf);
      } else {
        const buf = Buffer.alloc(len);
        writeValue(buf, 0, addr.dataType, item.value, addr.bitOffset);
        await this.writeRawArea(areaCode, addr.dbNumber, addr.offset, len, buf);
      }
    }
  }

  async readRawArea(area: number, dbNumber: number, start: number, length: number): Promise<Buffer> {
    if (!this.client || !this.connected) {
      throw new S7Error(S7ErrorCode.DISCONNECTED, 'Not connected');
    }

    return new Promise<Buffer>((resolve, reject) => {
      this.client.ReadArea(area, dbNumber, start, length, 0x02 /* S7WLByte */, (err: Error | undefined, data: Buffer) => {
        if (err) {
          reject(new S7Error(S7ErrorCode.READ_FAILED, `snap7 read failed: ${err.message}`, err));
        } else {
          resolve(data);
        }
      });
    });
  }

  private async writeRawArea(area: number, dbNumber: number, start: number, length: number, buffer: Buffer): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.client.WriteArea(area, dbNumber, start, length, 0x02, buffer, (err: Error | undefined) => {
        if (err) {
          reject(new S7Error(S7ErrorCode.WRITE_FAILED, `snap7 write failed: ${err.message}`, err));
        } else {
          resolve();
        }
      });
    });
  }

  async listBlocks(): Promise<S7BlockList> {
    if (!this.client || !this.connected) {
      throw new S7Error(S7ErrorCode.DISCONNECTED, 'Not connected');
    }

    return new Promise<S7BlockList>((resolve, reject) => {
      this.client.ListBlocks((err: Error | undefined, list: S7BlockList) => {
        if (err) {
          reject(new S7Error(S7ErrorCode.BROWSE_FAILED, `ListBlocks failed: ${err.message}`, err));
        } else {
          resolve(list);
        }
      });
    });
  }

  async listBlocksOfType(blockType: S7BlockType): Promise<number[]> {
    if (!this.client || !this.connected) {
      throw new S7Error(S7ErrorCode.DISCONNECTED, 'Not connected');
    }

    const typeCode = BLOCK_TYPE_MAP[blockType];

    return new Promise<number[]>((resolve, reject) => {
      this.client.ListBlocksOfType(typeCode, (err: Error | undefined, blocks: number[]) => {
        if (err) {
          reject(new S7Error(S7ErrorCode.BROWSE_FAILED, `ListBlocksOfType failed: ${err.message}`, err));
        } else {
          resolve(blocks);
        }
      });
    });
  }

  async getBlockInfo(blockType: S7BlockType, blockNumber: number): Promise<S7BlockInfo> {
    if (!this.client || !this.connected) {
      throw new S7Error(S7ErrorCode.DISCONNECTED, 'Not connected');
    }

    const typeCode = BLOCK_TYPE_MAP[blockType];

    return new Promise<S7BlockInfo>((resolve, reject) => {
      this.client.GetAgBlockInfo(typeCode, blockNumber, (err: Error | undefined, info: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (err) {
          reject(new S7Error(S7ErrorCode.BROWSE_FAILED, `GetBlockInfo failed: ${err.message}`, err));
        } else {
          resolve({
            blockType,
            blockNumber,
            sizeData: info.MC7Size ?? info.SizeData ?? 0,
            author: info.Author,
            family: info.Family,
            name: info.Header,
            version: info.Version ? `${(info.Version >> 4) & 0xf}.${info.Version & 0xf}` : undefined,
            date: info.CodeDate,
          });
        }
      });
    });
  }

  async readSZL(id: number, index: number): Promise<Buffer> {
    if (!this.client || !this.connected) {
      throw new S7Error(S7ErrorCode.DISCONNECTED, 'Not connected');
    }

    return new Promise<Buffer>((resolve, reject) => {
      this.client.ReadSZL(id, index, (err: Error | undefined, data: Buffer) => {
        if (err) {
          reject(new S7Error(S7ErrorCode.BROWSE_FAILED, `ReadSZL failed: ${err.message}`, err));
        } else {
          resolve(data);
        }
      });
    });
  }
}
