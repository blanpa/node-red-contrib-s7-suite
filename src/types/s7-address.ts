export type S7DataType =
  | 'BOOL'
  | 'BYTE'
  | 'WORD'
  | 'DWORD'
  | 'INT'
  | 'DINT'
  | 'REAL'
  | 'LREAL'
  | 'CHAR'
  | 'STRING';

export type S7AreaType = 'DB' | 'M' | 'I' | 'Q' | 'C' | 'T';

export interface S7Address {
  area: S7AreaType;
  dbNumber: number;
  dataType: S7DataType;
  offset: number;
  bitOffset: number;
  arrayLength?: number;
  stringLength?: number;
}

export interface S7ReadItem {
  name: string;
  address: S7Address;
  nodes7Address?: string;
}

export interface S7WriteItem {
  name: string;
  address: S7Address;
  nodes7Address?: string;
  value: unknown;
}

export interface S7ReadResult {
  name: string;
  address: S7Address;
  value: unknown;
  quality: 'good' | 'bad';
  timestamp: number;
  error?: string;
}
