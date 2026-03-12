import { S7ConnectionConfig } from '../types/s7-connection';
import { S7ReadItem, S7ReadResult, S7WriteItem } from '../types/s7-address';
import { S7BlockInfo, S7BlockList, S7BlockType } from '../types/s7-browse';

/** Interface for S7 PLC communication backends. */
export interface IS7Backend {
  /** Connects to the PLC using the provided configuration. */
  connect(config: S7ConnectionConfig): Promise<void>;
  /** Disconnects from the PLC. */
  disconnect(): Promise<void>;
  /** Returns whether the backend is currently connected. */
  isConnected(): boolean;
  /** Reads values for the specified S7 items. */
  read(items: S7ReadItem[]): Promise<S7ReadResult[]>;
  /** Writes values for the specified S7 items. */
  write(items: S7WriteItem[]): Promise<void>;
  /** Reads raw bytes from a PLC memory area. */
  readRawArea(area: number, dbNumber: number, start: number, length: number): Promise<Buffer>;
  /** Lists all blocks on the PLC grouped by type. */
  listBlocks(): Promise<S7BlockList>;
  /** Lists block numbers for a given block type. */
  listBlocksOfType(blockType: S7BlockType): Promise<number[]>;
  /** Returns detailed info for a specific block. */
  getBlockInfo(blockType: S7BlockType, blockNumber: number): Promise<S7BlockInfo>;
  /** Reads System Status List (SZL) data from the PLC. */
  readSZL(id: number, index: number): Promise<Buffer>;
  /** Starts the PLC (hot start). snap7 only. */
  plcStart?(): Promise<void>;
  /** Stops the PLC. snap7 only. */
  plcStop?(): Promise<void>;
  /** Cold starts the PLC. snap7 only. */
  plcColdStart?(): Promise<void>;
}
