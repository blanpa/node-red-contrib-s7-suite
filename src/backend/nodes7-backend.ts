import { IS7Backend } from './s7-backend.interface';
import { S7ConnectionConfig } from '../types/s7-connection';
import { S7ReadItem, S7ReadResult, S7WriteItem, AREA_CODE_MAP } from '../types/s7-address';
import { S7BlockInfo, S7BlockList, S7BlockType } from '../types/s7-browse';
import { toNodes7Address } from '../core/address-parser';
import { arrayValues, stringWrite } from '../core/data-converter';
import { S7Error, S7ErrorCode, describeError, describeRawRequest } from '../utils/error-codes';

const BAD_QUALITY_HINT = ' (check that the address exists and is within the area or DB size)';

/**
 * Describes a failed nodes7 read/write. nodes7 passes `true` rather than an Error, and its
 * per-item quality doesn't say why (a missing DB and an out-of-range address both read
 * "BAD 255"), so name the addresses it marked bad, or all of them when there are no values.
 */
function failureDetail(err: unknown, addrs: string[], values?: Record<string, unknown>): string {
  if (err instanceof Error) return err.message;
  const bad = values ? addrs.filter((a) => isBadQuality(values[a])) : [];
  return `bad quality for ${(bad.length > 0 ? bad : addrs).join(', ')}${BAD_QUALITY_HINT}`;
}

/** True for the "BAD nnn" quality nodes7 returns in place of a value it couldn't read. */
function isBadQuality(v: unknown): boolean {
  return (Array.isArray(v) ? v : [v]).some((q) => typeof q === 'string' && /^BAD \d+$/.test(q));
}

const causeOf = (err: unknown): Error | undefined => (err instanceof Error ? err : undefined);

/**
 * nodes7's isoConnectionState when the link is up. It drops to 0 as soon as the socket closes
 * (PLC restart, cable reset by peer), with no request needed, and stays below 4 while nodes7
 * retries on its own.
 */
const ISO_CONNECTED = 4;

// The address types nodes7 0.3.18 understands (stringToS7Addr in nodeS7.js). It silently drops
// any other item, so a write never calls back on a fresh connection, and on a connection that
// has written before it sends the previous write again and reports success. Check first.
// LINT is left out too: nodes7 parses it, but its LINT read and write are commented out, so a read
// returns nothing and a write sends eight zero bytes.
const NODES7_DB_TYPES = new Set([
  'X', 'B', 'C', 'BYTE', 'CHAR', 'W', 'WORD', 'I', 'INT', 'DW', 'DWT', 'DWORD', 'DI', 'DINT',
  'R', 'REAL', 'LR', 'LREAL', 'WDT', 'DT', 'DTZ', 'DTL', 'DTLZ', 'S', 'STRING',
]);
const NODES7_UNFINISHED_TYPES = new Set(['LI', 'LINT']);
const AREA_SUFFIXES = ['', 'B', 'C', 'W', 'I', 'D', 'DI', 'R', 'LR'];
const NODES7_AREA_TYPES = new Set([
  ...['I', 'E', 'Q', 'A', 'M'].flatMap((area) => AREA_SUFFIXES.map((s) => area + s)),
  ...['PI', 'PE', 'PQ', 'PA'].flatMap((area) => ['B', 'C', 'W', 'I', 'D', 'DI', 'R'].map((s) => area + s)),
  'T', 'C',
]);

/** Returns why nodes7 can't handle this address, or undefined if it can. */
export function nodes7Unsupported(addr: string): string | undefined {
  const [db, rest] = addr.split(',');
  if (rest !== undefined) {
    const parts = rest.split('.');
    const type = parts[0].replace(/[0-9]/g, '').toUpperCase(); // as nodes7 reads it, so S5TIME is "STIME"
    if (NODES7_UNFINISHED_TYPES.has(type)) {
      return `"${addr}" isn't supported by the nodes7 backend (nodes7 can't read or write LINT); use the snap7 backend for it`;
    }
    if (!NODES7_DB_TYPES.has(type)) {
      const name = parts[0].replace(/\d+$/, '').toUpperCase();
      return `"${addr}" isn't supported by the nodes7 backend (nodes7 has no ${name} type); use the snap7 backend for it`;
    }
    if ((type === 'STRING' || type === 'S') && parts.length < 2) {
      return `"${addr}" needs the string's max length for the nodes7 backend, e.g. "${db},${rest}.20" for a STRING[20]`;
    }
    return undefined;
  }
  const type = addr.split('.')[0].replace(/[0-9]/g, '');
  if (!NODES7_AREA_TYPES.has(type)) {
    return `"${addr}" isn't supported by the nodes7 backend; use the snap7 backend for it`;
  }
  return undefined;
}

export class NodeS7Backend implements IS7Backend {
  private conn: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  private connected = false;

  async connect(config: S7ConnectionConfig): Promise<void> {
    // A reconnect must not leave the previous nodes7 instance (and its retry timers) running
    await this.disconnect();

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodes7 = require('nodes7');
    // nodeS7 defaults silentMode to false, which logs every read/poll cycle
    // (raw protocol trace) to stdout and can grow container logs to GBs.
    // Keep it silent unless the user explicitly enables debug logging.
    this.conn = new nodes7({ silent: config.debug !== true });

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
      this.conn.initiateConnection(connParams, (err: unknown) => {
        if (err) {
          reject(new S7Error(S7ErrorCode.CONNECTION_FAILED, `nodes7 connection failed: ${describeError(err)}`, causeOf(err)));
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
    return this.connected && this.conn !== null && this.conn.isoConnectionState === ISO_CONNECTED;
  }

  /** True when we hold a connection but nodes7 reports the link as down. */
  private linkLost(): boolean {
    return this.conn !== null && this.conn.isoConnectionState !== ISO_CONNECTED;
  }

  private lostError(op: string): S7Error {
    return new S7Error(S7ErrorCode.DISCONNECTED, `nodes7 ${op} failed: connection to the PLC was lost`);
  }

  /**
   * What the error in a nodes7 callback means for `conn`, the connection the request was sent on.
   * Returns the error to reject with, or null to carry on (no error, or one the caller describes).
   * - No error: carry on, even if that connection has since been dropped. The PLC answered, so a
   *   write was made; failing it would invite the flow to write it again.
   * - An error from a connection that has been dropped or replaced: READ_FAILED / WRITE_FAILED.
   *   The connection manager dropped it on purpose (a timeout or a reconnect), and a
   *   connection-class code would make it tear down the connection that replaced it.
   * - An error with the link down: DISCONNECTED, so the connection manager reconnects.
   */
  private callbackError(conn: unknown, err: unknown, op: 'read' | 'write'): S7Error | null {
    if (!err) return null;
    if (this.conn !== conn) {
      return new S7Error(
        op === 'write' ? S7ErrorCode.WRITE_FAILED : S7ErrorCode.READ_FAILED,
        `nodes7 ${op} failed: the connection was closed before the PLC answered`,
        causeOf(err),
      );
    }
    return this.linkLost() ? this.lostError(op) : null;
  }

  private assertConnected(op: string): void {
    if (!this.conn || !this.connected) {
      throw new S7Error(S7ErrorCode.DISCONNECTED, 'Not connected');
    }
    if (this.linkLost()) {
      throw this.lostError(op);
    }
  }

  async read(items: S7ReadItem[]): Promise<S7ReadResult[]> {
    this.assertConnected('read');

    const prepared = items.map((item) => {
      const addr = item.nodes7Address ?? toNodes7Address(item.address);
      return { item, addr, unsupported: nodes7Unsupported(addr) };
    });
    // Addresses nodes7 can't handle are reported bad without being sent to it
    const addrList = prepared.filter((p) => !p.unsupported).map((p) => p.addr);

    // anyBad is nodes7's flag that some item came back as a "BAD nnn" quality instead of a value
    const toResults = (values: Record<string, unknown>, anyBad = false): S7ReadResult[] =>
      prepared.map(({ item, addr, unsupported }) => {
        const value = unsupported ? undefined : values[addr];
        const badQuality = anyBad && isBadQuality(value);
        const isBad = value === undefined || value === null || badQuality;
        return {
          name: item.name,
          address: item.address,
          value: isBad ? null : value,
          quality: isBad ? 'bad' : 'good',
          timestamp: Date.now(),
          error: unsupported
            ?? (badQuality ? `bad quality for ${addr}${BAD_QUALITY_HINT}` : isBad ? 'No value returned' : undefined),
        };
      });

    if (addrList.length === 0) {
      return toResults({});
    }

    // Keep the connection this read was sent on: disconnect() can drop it (this.conn = null)
    // before nodes7's own timeout calls back, so the callback must not use this.conn
    const conn = this.conn;
    for (const addr of addrList) {
      conn.addItems(addr);
    }

    const removeAll = (): void => {
      for (const addr of addrList) {
        conn.removeItems(addr);
      }
    };

    return new Promise<S7ReadResult[]>((resolve, reject) => {
      try {
        conn.readAllItems((err: unknown, values: Record<string, unknown>) => {
          removeAll();

          const failure = this.callbackError(conn, err, 'read');
          if (failure) {
            reject(failure);
            return;
          }
          // nodes7 sets one flag for the whole read but still returns every item. When some of
          // them are good, report the bad ones per item, as the snap7 backend does; fail the
          // read only when nothing came back good.
          const someGood = !(err instanceof Error) && values
            && addrList.some((a) => values[a] !== undefined && values[a] !== null && !isBadQuality(values[a]));
          if (err && !someGood) {
            reject(new S7Error(
              S7ErrorCode.READ_FAILED,
              `nodes7 read failed: ${failureDetail(err, addrList, values)}`,
              causeOf(err),
            ));
            return;
          }

          resolve(toResults(values, Boolean(err)));
        });
      } catch (e) {
        removeAll();
        throw e;
      }
    });
  }

  async write(items: S7WriteItem[]): Promise<void> {
    this.assertConnected('write');

    // Strings are sized from their header first, so do that before this write's items are added
    const prepared: Array<{ name: string; value: unknown }> = [];
    for (const item of items) {
      const type = item.address.dataType;
      if (type === 'STRING' || type === 'WSTRING') {
        prepared.push(await this.prepareStringWrite(item));
      } else {
        // nodes7 would pad a short array with zeros; refuse it, as the snap7 backend does
        const value = item.address.arrayLength !== undefined ? Array.from(arrayValues(item.address, item.value)) : item.value;
        prepared.push({ name: item.nodes7Address ?? toNodes7Address(item.address), value });
      }
    }

    const names = prepared.map((p) => p.name);
    const values = prepared.map((p) => p.value);

    // Refuse the whole write rather than let nodes7 drop part of it (see NODES7_DB_TYPES)
    for (const addr of names) {
      const unsupported = nodes7Unsupported(addr);
      if (unsupported) {
        throw new S7Error(S7ErrorCode.WRITE_FAILED, unsupported);
      }
    }

    // Reading string headers above may have waited on the PLC, so check the link again, then keep
    // the connection this write is sent on (see read())
    this.assertConnected('write');
    const conn = this.conn;
    for (const addr of names) {
      conn.addItems(addr);
    }

    const removeAll = (): void => {
      for (const name of names) {
        conn.removeItems(name);
      }
    };

    return new Promise<void>((resolve, reject) => {
      try {
        conn.writeItems(names, values, (err: unknown) => {
          removeAll();
          const failure = this.callbackError(conn, err, 'write');
          if (failure) {
            reject(failure);
          } else if (err) {
            reject(new S7Error(S7ErrorCode.WRITE_FAILED, `nodes7 write failed: ${failureDetail(err, names)}`, causeOf(err)));
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

  /**
   * Turns a STRING/WSTRING write into a plain BYTE write of just the string's current length and
   * characters, using the same rules as the snap7 backend (see stringWrite). nodes7's own string
   * writes pad to the full length, need the length in the address, and don't support WSTRING.
   */
  private async prepareStringWrite(item: S7WriteItem): Promise<{ name: string; value: unknown }> {
    const addr = item.address;
    const dataType = addr.dataType as 'STRING' | 'WSTRING';
    const areaCode = AREA_CODE_MAP[addr.area];
    if (areaCode === undefined) {
      throw new S7Error(S7ErrorCode.WRITE_FAILED, `Unsupported area: ${addr.area}`);
    }
    const header = await this.readRawArea(areaCode, addr.dbNumber, addr.offset, dataType === 'WSTRING' ? 4 : 2);
    const where = `${addr.area === 'DB' ? `DB${addr.dbNumber}` : addr.area} offset ${addr.offset}`;
    const { start, bytes } = stringWrite(dataType, item.value, header, addr.stringLength, where);

    const at = addr.offset + start;
    const name = addr.area === 'DB' ? `DB${addr.dbNumber},BYTE${at}` : `${addr.area}B${at}`;
    // A single byte (an empty string) is a plain BYTE; nodes7 takes anything longer as an array
    return bytes.length === 1 ? { name, value: bytes[0] } : { name: `${name}.${bytes.length}`, value: [...bytes] };
  }

  async readRawArea(area: number, dbNumber: number, start: number, length: number): Promise<Buffer> {
    // nodes7 doesn't have a direct raw area read, so we construct a BYTE read
    this.assertConnected('read');

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

    // Keep the connection this read is sent on (see read())
    const conn = this.conn;
    conn.addItems(addr);

    return new Promise<Buffer>((resolve, reject) => {
      conn.readAllItems((err: unknown, values: Record<string, unknown>) => {
        conn.removeItems(addr);
        const failure = this.callbackError(conn, err, 'read');
        if (failure) {
          reject(failure);
          return;
        }
        if (err) {
          // Describe the request rather than the internal nodes7 address (DB1,BYTE200.8), which
          // the user never typed: struct, buffer and bits modes all read through here.
          const detail = err instanceof Error
            ? err.message
            : `bad quality reading ${describeRawRequest(area, dbNumber, start, length)}${BAD_QUALITY_HINT}`;
          reject(new S7Error(S7ErrorCode.READ_FAILED, `Raw read failed: ${detail}`, causeOf(err)));
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
