import { IS7Backend } from './s7-backend.interface';
import { S7ConnectionConfig } from '../types/s7-connection';
import { S7ReadItem, S7ReadResult, S7WriteItem } from '../types/s7-address';
import { S7BlockInfo, S7BlockList, S7BlockType } from '../types/s7-browse';
import { toNodes7Address } from '../core/address-parser';
import { S7Error, S7ErrorCode } from '../utils/error-codes';

export class NodeS7Backend implements IS7Backend {
  private conn: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  private connected = false;

  async connect(config: S7ConnectionConfig): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodes7 = require('nodes7');
    this.conn = new nodes7();

    const connParams: Record<string, unknown> = {
      host: config.host,
      port: config.port,
      rack: config.rack,
      slot: config.slot,
    };

    if (config.localTSAP !== undefined) {
      connParams.localTSAP = config.localTSAP;
    }
    if (config.remoteTSAP !== undefined) {
      connParams.remoteTSAP = config.remoteTSAP;
    }
    if (config.connectionTimeout !== undefined) {
      connParams.timeout = config.connectionTimeout;
    }

    return new Promise<void>((resolve, reject) => {
      this.conn.initiateConnection(connParams, (err: Error | undefined) => {
        if (err) {
          reject(new S7Error(S7ErrorCode.CONNECTION_FAILED, `nodes7 connection failed: ${err.message}`, err));
        } else {
          this.connected = true;
          resolve();
        }
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.conn) {
      try {
        this.conn.dropConnection();
      } catch {
        // ignore disconnect errors
      } finally {
        this.connected = false;
        this.conn = null;
      }
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async read(items: S7ReadItem[]): Promise<S7ReadResult[]> {
    if (!this.conn || !this.connected) {
      throw new S7Error(S7ErrorCode.DISCONNECTED, 'Not connected');
    }

    const addrList = items.map((i) => i.nodes7Address ?? toNodes7Address(i.address));
    for (const addr of addrList) {
      this.conn.addItems(addr);
    }

    const removeAll = (): void => {
      for (const addr of addrList) {
        this.conn.removeItems(addr);
      }
    };

    return new Promise<S7ReadResult[]>((resolve, reject) => {
      try {
        this.conn.readAllItems((err: Error | undefined, values: Record<string, unknown>) => {
          removeAll();

          if (err) {
            reject(new S7Error(S7ErrorCode.READ_FAILED, `nodes7 read failed: ${err.message}`, err));
            return;
          }

          const results: S7ReadResult[] = items.map((item) => {
            const addr = item.nodes7Address ?? toNodes7Address(item.address);
            const value = values[addr];
            const isBad = value === undefined || value === null;
            return {
              name: item.name,
              address: item.address,
              value: isBad ? null : value,
              quality: isBad ? 'bad' : 'good',
              timestamp: Date.now(),
              error: isBad ? 'No value returned' : undefined,
            };
          });

          resolve(results);
        });
      } catch (e) {
        removeAll();
        throw e;
      }
    });
  }

  async write(items: S7WriteItem[]): Promise<void> {
    if (!this.conn || !this.connected) {
      throw new S7Error(S7ErrorCode.DISCONNECTED, 'Not connected');
    }

    const names: string[] = [];
    const values: unknown[] = [];

    for (const item of items) {
      const addr = item.nodes7Address ?? toNodes7Address(item.address);
      this.conn.addItems(addr);
      names.push(addr);
      values.push(item.value);
    }

    const removeAll = (): void => {
      for (const name of names) {
        this.conn.removeItems(name);
      }
    };

    return new Promise<void>((resolve, reject) => {
      try {
        this.conn.writeItems(names, values, (err: Error | undefined) => {
          removeAll();
          if (err) {
            reject(new S7Error(S7ErrorCode.WRITE_FAILED, `nodes7 write failed: ${err.message}`, err));
          } else {
            resolve();
          }
        });
      } catch (e) {
        removeAll();
        throw e;
      }
    });
  }

  async readRawArea(area: number, dbNumber: number, start: number, length: number): Promise<Buffer> {
    // nodes7 doesn't have a direct raw area read, so we construct a BYTE read
    if (!this.conn || !this.connected) {
      throw new S7Error(S7ErrorCode.DISCONNECTED, 'Not connected');
    }

    const areaMap: Record<number, string> = {
      0x81: 'I',
      0x82: 'Q',
      0x83: 'M',
      0x84: 'DB',
    };

    const areaPrefix = areaMap[area];
    if (!areaPrefix) {
      throw new S7Error(S7ErrorCode.READ_FAILED, `Unsupported area code: ${area}`);
    }

    let addr: string;
    if (areaPrefix === 'DB') {
      addr = `DB${dbNumber},BYTE${start}.${length}`;
    } else {
      addr = `${areaPrefix}B${start}.${length}`;
    }

    this.conn.addItems(addr);

    return new Promise<Buffer>((resolve, reject) => {
      this.conn.readAllItems((err: Error | undefined, values: Record<string, unknown>) => {
        this.conn.removeItems(addr);
        if (err) {
          reject(new S7Error(S7ErrorCode.READ_FAILED, `Raw read failed: ${err.message}`, err));
          return;
        }
        const val = values[addr];
        if (Buffer.isBuffer(val)) {
          resolve(val);
        } else if (Array.isArray(val)) {
          resolve(Buffer.from(val as number[]));
        } else if (typeof val === 'number') {
          const buf = Buffer.alloc(1);
          buf.writeUInt8(val);
          resolve(buf);
        } else {
          reject(new S7Error(S7ErrorCode.READ_FAILED, 'Unexpected value type from raw read'));
        }
      });
    });
  }

  // Probe-based browse for nodes7 (no native block listing)
  async listBlocks(): Promise<S7BlockList> {
    throw new S7Error(
      S7ErrorCode.BROWSE_FAILED,
      'nodes7 does not support native block listing. Use probe-based browsing.',
    );
  }

  async listBlocksOfType(_blockType: S7BlockType): Promise<number[]> {
    throw new S7Error(
      S7ErrorCode.BROWSE_FAILED,
      'nodes7 does not support native block type listing.',
    );
  }

  async getBlockInfo(_blockType: S7BlockType, _blockNumber: number): Promise<S7BlockInfo> {
    throw new S7Error(
      S7ErrorCode.BROWSE_FAILED,
      'nodes7 does not support native block info.',
    );
  }

  async readSZL(_id: number, _index: number): Promise<Buffer> {
    throw new S7Error(S7ErrorCode.BROWSE_FAILED, 'nodes7 does not support SZL reads.');
  }
}
