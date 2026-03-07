import { S7ConnectionConfig } from '../types/s7-connection';
import { S7ReadItem, S7ReadResult, S7WriteItem } from '../types/s7-address';
import { S7BlockInfo, S7BlockList, S7BlockType } from '../types/s7-browse';

export interface IS7Backend {
  connect(config: S7ConnectionConfig): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  read(items: S7ReadItem[]): Promise<S7ReadResult[]>;
  write(items: S7WriteItem[]): Promise<void>;
  readRawArea(area: number, dbNumber: number, start: number, length: number): Promise<Buffer>;
  listBlocks(): Promise<S7BlockList>;
  listBlocksOfType(blockType: S7BlockType): Promise<number[]>;
  getBlockInfo(blockType: S7BlockType, blockNumber: number): Promise<S7BlockInfo>;
  readSZL(id: number, index: number): Promise<Buffer>;
}
