import { IS7Backend } from '../../src/backend/s7-backend.interface';
import { S7ConnectionConfig } from '../../src/types/s7-connection';
import { S7ReadItem, S7ReadResult, S7WriteItem } from '../../src/types/s7-address';
import { S7BlockInfo, S7BlockList, S7BlockType } from '../../src/types/s7-browse';

export class MockBackend implements IS7Backend {
  connected = false;
  connectCalls: S7ConnectionConfig[] = [];
  readCalls: S7ReadItem[][] = [];
  writeCalls: S7WriteItem[][] = [];
  rawReadCalls: Array<{ area: number; dbNumber: number; start: number; length: number }> = [];

  shouldFailConnect = false;
  shouldFailRead = false;
  shouldFailWrite = false;
  readValues: Record<string, unknown> = {};
  rawAreaData: Map<string, Buffer> = new Map();
  blockList: S7BlockList = {
    OBCount: 0, DBCount: 0, SDBCount: 0, FCCount: 0, SFCCount: 0, FBCount: 0, SFBCount: 0,
  };
  blockNumbers: Record<string, number[]> = {};
  blockInfos: Map<string, S7BlockInfo> = new Map();

  async connect(config: S7ConnectionConfig): Promise<void> {
    this.connectCalls.push(config);
    if (this.shouldFailConnect) throw new Error('Connection failed');
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async read(items: S7ReadItem[]): Promise<S7ReadResult[]> {
    this.readCalls.push(items);
    if (this.shouldFailRead) throw new Error('Read failed');

    return items.map((item) => ({
      name: item.name,
      address: item.address,
      value: this.readValues[item.name] ?? 0,
      quality: 'good' as const,
      timestamp: Date.now(),
    }));
  }

  async write(items: S7WriteItem[]): Promise<void> {
    this.writeCalls.push(items);
    if (this.shouldFailWrite) throw new Error('Write failed');
  }

  async readRawArea(area: number, dbNumber: number, start: number, length: number): Promise<Buffer> {
    this.rawReadCalls.push({ area, dbNumber, start, length });
    const key = `${area}:${dbNumber}:${start}:${length}`;
    const data = this.rawAreaData.get(key);
    if (data) return data;

    // Check for any matching area+db regardless of offset/length
    for (const [k, v] of this.rawAreaData) {
      const [a, d] = k.split(':').map(Number);
      if (a === area && d === dbNumber) {
        return v.subarray(start, start + length);
      }
    }

    throw new Error(`No data for area ${area} DB${dbNumber} offset ${start}`);
  }

  async listBlocks(): Promise<S7BlockList> {
    return this.blockList;
  }

  async listBlocksOfType(blockType: S7BlockType): Promise<number[]> {
    return this.blockNumbers[blockType] ?? [];
  }

  async getBlockInfo(blockType: S7BlockType, blockNumber: number): Promise<S7BlockInfo> {
    const info = this.blockInfos.get(`${blockType}:${blockNumber}`);
    if (info) return info;
    return { blockType, blockNumber, sizeData: 0 };
  }

  async readSZL(_id: number, _index: number): Promise<Buffer> {
    return Buffer.alloc(0);
  }

  reset(): void {
    this.connected = false;
    this.connectCalls = [];
    this.readCalls = [];
    this.writeCalls = [];
    this.rawReadCalls = [];
    this.shouldFailConnect = false;
    this.shouldFailRead = false;
    this.shouldFailWrite = false;
    this.readValues = {};
    this.rawAreaData.clear();
  }
}
