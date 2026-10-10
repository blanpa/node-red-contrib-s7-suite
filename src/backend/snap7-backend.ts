import { IS7Backend } from './s7-backend.interface';
import { S7ConnectionConfig } from '../types/s7-connection';
import { S7ReadItem, S7ReadResult, S7WriteItem, AREA_CODE_MAP } from '../types/s7-address';
import { S7BlockInfo, S7BlockList, S7BlockType } from '../types/s7-browse';
import { addressByteLength, readAddressValue, ReadOptions, stringWrite, writeAddressValue } from '../core/data-converter';
import { S7Error, S7ErrorCode, describeError, describeRawRequest } from '../utils/error-codes';

const BLOCK_TYPE_MAP: Record<S7BlockType, number> = {
  OB: 0x38,
  DB: 0x41,
  SDB: 0x42,
  FC: 0x43,
  SFC: 0x44,
  FB: 0x45,
  SFB: 0x46,
};

/**
 * snap7 error codes carry the TCP and ISO layer errors in the low 20 bits (e.g. 0x92746 =
 * ISO send error + connection reset). PLC-level errors such as "Address out of range"
 * (0x00900000) leave them clear. snap7's own Connected() stays true after a reset, so this is
 * how we tell a lost link from a bad request.
 */
const LINK_ERROR_MASK = 0x000fffff;

export class Snap7Backend implements IS7Backend {
  private client: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  private connected = false;
  private readOptions: ReadOptions = {};

  async connect(config: S7ConnectionConfig): Promise<void> {
    this.readOptions = { int64: config.int64As };
    // snap7 never reconnects on its own; drop the old client before making a new one
    await this.disconnect();

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

    // snap7 connects to 102 unless told otherwise; ConnectTo/SetConnectionParams take no port
    if (config.port) {
      this.client.SetParam(this.client.RemotePort, config.port);
    }

    if (config.connectionTimeout) {
      this.client.SetParam(this.client.PingTimeout, config.connectionTimeout);
    }

    await new Promise<void>((resolve, reject) => {
      if (config.localTSAP !== undefined && config.remoteTSAP !== undefined) {
        this.client.SetConnectionParams(
          config.host,
          config.localTSAP,
          config.remoteTSAP,
        );
        this.client.Connect((err: Error | undefined) => {
          if (err) {
            reject(new S7Error(S7ErrorCode.CONNECTION_FAILED, `snap7 connection failed: ${this.describeError(err)}`, err));
          } else {
            this.connected = true;
            resolve();
          }
        });
      } else {
        this.client.ConnectTo(config.host, config.rack, config.slot, (err: Error | undefined) => {
          if (err) {
            reject(new S7Error(S7ErrorCode.CONNECTION_FAILED, `snap7 connection failed: ${this.describeError(err)}`, err));
          } else {
            this.connected = true;
            resolve();
          }
        });
      }
    });

    if (config.password) {
      await new Promise<void>((resolve, reject) => {
        this.client.SetSessionPassword(config.password, (err: Error | undefined) => {
          if (err) {
            reject(new S7Error(S7ErrorCode.CONNECTION_FAILED, `SetSessionPassword failed: ${this.describeError(err)}`, err));
          } else {
            resolve();
          }
        });
      });
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        try {
          this.client.ClearSessionPassword();
        } catch {
          // ignore clear password errors
        }
        this.client.Disconnect();
      } catch {
        // ignore disconnect errors
      } finally {
        this.connected = false;
        this.client = null;
      }
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** node-snap7 passes a numeric error code; ErrorText() gives e.g. "CPU : Address out of range". */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private describeError(err: unknown, client: any = this.client): string {
    if (typeof err === 'number' && client) {
      return String(client.ErrorText(err)).trim();
    }
    return describeError(err);
  }

  /**
   * DISCONNECTED (and mark the link down) for TCP/ISO errors, otherwise the given code. `client` is
   * the one the request was sent on: an error from a client a reconnect has since replaced (its
   * socket is gone) says nothing about the current link, so it keeps the given code and leaves the
   * link alone. Otherwise the new connection would be marked down and refuse every request.
   */
  private codeFor(client: unknown, err: unknown, fallback: S7ErrorCode): S7ErrorCode {
    if (client !== this.client) return fallback;
    if (typeof err === 'number' && (err & LINK_ERROR_MASK) !== 0) {
      this.connected = false;
      return S7ErrorCode.DISCONNECTED;
    }
    return fallback;
  }

  /** Asks the CPU for its run/stop status: a small request that needs no valid address. */
  async ping(): Promise<void> {
    if (!this.client || !this.connected) {
      throw new S7Error(S7ErrorCode.DISCONNECTED, 'Not connected');
    }
    const client = this.client;
    return new Promise<void>((resolve, reject) => {
      client.PlcStatus((err: unknown) => {
        if (err) {
          reject(new S7Error(this.codeFor(client, err, S7ErrorCode.READ_FAILED), `snap7 status check failed: ${this.describeError(err, client)}`));
        } else {
          resolve();
        }
      });
    });
  }

  async read(items: S7ReadItem[]): Promise<S7ReadResult[]> {
    if (!this.client || !this.connected) {
      throw new S7Error(S7ErrorCode.DISCONNECTED, 'Not connected');
    }

    const results: S7ReadResult[] = [];

    for (const item of items) {
      try {
        const addr = item.address;
        const areaCode = AREA_CODE_MAP[addr.area];
        if (areaCode === undefined) {
          throw new S7Error(S7ErrorCode.READ_FAILED, `Unsupported area: ${addr.area}`);
        }
        const buffer = await this.readRawArea(areaCode, addr.dbNumber, addr.offset, addressByteLength(addr));
        const value = readAddressValue(buffer, 0, addr, this.readOptions);

        results.push({
          name: item.name,
          address: addr,
          value,
          quality: 'good',
          timestamp: Date.now(),
        });
      } catch (err) {
        // A lost link fails the whole read so the connection manager can reconnect;
        // anything else is reported against this item only.
        if (err instanceof S7Error && err.code === S7ErrorCode.DISCONNECTED) {
          throw err;
        }
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
      const areaCode = AREA_CODE_MAP[addr.area];
      if (areaCode === undefined) {
        throw new S7Error(S7ErrorCode.WRITE_FAILED, `Unsupported area: ${addr.area}`);
      }
      const len = addressByteLength(addr);

      if (addr.dataType === 'BOOL') {
        // Read-modify-write for booleans, so the other bits in those bytes are kept
        const buf = await this.readRawArea(areaCode, addr.dbNumber, addr.offset, len);
        writeAddressValue(buf, 0, addr, item.value);
        await this.writeRawArea(areaCode, addr.dbNumber, addr.offset, len, buf);
      } else if (addr.dataType === 'STRING' || addr.dataType === 'WSTRING') {
        // Size the write from the string's header in the PLC, so nothing past the string is touched
        const header = await this.readRawArea(areaCode, addr.dbNumber, addr.offset, addr.dataType === 'WSTRING' ? 4 : 2);
        const where = `${addr.area === 'DB' ? `DB${addr.dbNumber}` : addr.area} offset ${addr.offset}`;
        const { start, bytes } = stringWrite(addr.dataType, item.value, header, addr.stringLength, where);
        await this.writeRawArea(areaCode, addr.dbNumber, addr.offset + start, bytes.length, bytes);
      } else {
        const buf = Buffer.alloc(len);
        writeAddressValue(buf, 0, addr, item.value);
        await this.writeRawArea(areaCode, addr.dbNumber, addr.offset, len, buf);
      }
    }
  }

  async readRawArea(area: number, dbNumber: number, start: number, length: number): Promise<Buffer> {
    if (!this.client || !this.connected) {
      throw new S7Error(S7ErrorCode.DISCONNECTED, 'Not connected');
    }

    const client = this.client;
    return new Promise<Buffer>((resolve, reject) => {
      client.ReadArea(area, dbNumber, start, length, 0x02 /* S7WLByte */, (err: Error | undefined, data: Buffer) => {
        if (err) {
          reject(new S7Error(
            this.codeFor(client, err, S7ErrorCode.READ_FAILED),
            `snap7 read failed: ${this.describeError(err, client)} (${describeRawRequest(area, dbNumber, start, length)})`,
            err,
          ));
        } else {
          resolve(data);
        }
      });
    });
  }

  private async writeRawArea(area: number, dbNumber: number, start: number, length: number, buffer: Buffer): Promise<void> {
    // A STRING or BOOL write reads first, so the link can drop before we get here
    if (!this.client || !this.connected) {
      throw new S7Error(S7ErrorCode.DISCONNECTED, 'Not connected');
    }

    const client = this.client;
    return new Promise<void>((resolve, reject) => {
      client.WriteArea(area, dbNumber, start, length, 0x02, buffer, (err: Error | undefined) => {
        if (err) {
          reject(new S7Error(
            this.codeFor(client, err, S7ErrorCode.WRITE_FAILED),
            `snap7 write failed: ${this.describeError(err, client)} (${describeRawRequest(area, dbNumber, start, length)})`,
            err,
          ));
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

    const client = this.client;
    return new Promise<S7BlockList>((resolve, reject) => {
      client.ListBlocks((err: Error | undefined, list: S7BlockList) => {
        if (err) {
          reject(new S7Error(this.codeFor(client, err, S7ErrorCode.BROWSE_FAILED), `ListBlocks failed: ${this.describeError(err, client)}`, err));
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

    const client = this.client;
    return new Promise<number[]>((resolve, reject) => {
      client.ListBlocksOfType(typeCode, (err: Error | undefined, blocks: number[]) => {
        if (err) {
          reject(new S7Error(this.codeFor(client, err, S7ErrorCode.BROWSE_FAILED), `ListBlocksOfType failed: ${this.describeError(err, client)}`, err));
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

    const client = this.client;
    return new Promise<S7BlockInfo>((resolve, reject) => {
      client.GetAgBlockInfo(typeCode, blockNumber, (err: Error | undefined, info: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (err) {
          reject(new S7Error(this.codeFor(client, err, S7ErrorCode.BROWSE_FAILED), `GetBlockInfo failed: ${this.describeError(err, client)}`, err));
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

  async plcStart(): Promise<void> {
    if (!this.client || !this.connected) {
      throw new S7Error(S7ErrorCode.DISCONNECTED, 'Not connected');
    }

    const client = this.client;
    return new Promise<void>((resolve, reject) => {
      client.PlcHotStart((err: Error | undefined) => {
        if (err) {
          reject(new S7Error(this.codeFor(client, err, S7ErrorCode.CONTROL_FAILED), `PlcHotStart failed: ${this.describeError(err, client)}`, err));
        } else {
          resolve();
        }
      });
    });
  }

  async plcStop(): Promise<void> {
    if (!this.client || !this.connected) {
      throw new S7Error(S7ErrorCode.DISCONNECTED, 'Not connected');
    }

    const client = this.client;
    return new Promise<void>((resolve, reject) => {
      client.PlcStop((err: Error | undefined) => {
        if (err) {
          reject(new S7Error(this.codeFor(client, err, S7ErrorCode.CONTROL_FAILED), `PlcStop failed: ${this.describeError(err, client)}`, err));
        } else {
          resolve();
        }
      });
    });
  }

  async plcColdStart(): Promise<void> {
    if (!this.client || !this.connected) {
      throw new S7Error(S7ErrorCode.DISCONNECTED, 'Not connected');
    }

    const client = this.client;
    return new Promise<void>((resolve, reject) => {
      client.PlcColdStart((err: Error | undefined) => {
        if (err) {
          reject(new S7Error(this.codeFor(client, err, S7ErrorCode.CONTROL_FAILED), `PlcColdStart failed: ${this.describeError(err, client)}`, err));
        } else {
          resolve();
        }
      });
    });
  }

  async readSZL(id: number, index: number): Promise<Buffer> {
    if (!this.client || !this.connected) {
      throw new S7Error(S7ErrorCode.DISCONNECTED, 'Not connected');
    }

    const client = this.client;
    return new Promise<Buffer>((resolve, reject) => {
      client.ReadSZL(id, index, (err: Error | undefined, data: Buffer) => {
        if (err) {
          reject(new S7Error(this.codeFor(client, err, S7ErrorCode.BROWSE_FAILED), `ReadSZL failed: ${this.describeError(err, client)}`, err));
        } else {
          resolve(data);
        }
      });
    });
  }
}
