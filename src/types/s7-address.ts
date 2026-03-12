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
  | 'STRING'
  | 'USINT'
  | 'UINT'
  | 'UDINT'
  | 'LINT'
  | 'ULINT'
  | 'DATE'
  | 'TIME'
  | 'TIME_OF_DAY'
  | 'DATE_AND_TIME'
  | 'S5TIME'
  | 'WSTRING';

export type S7AreaType = 'DB' | 'M' | 'I' | 'Q' | 'C' | 'T';

/** Snap7 area codes for each S7 memory area */
export const AREA_CODE_MAP: Record<S7AreaType, number> = {
  DB: 0x84,
  M: 0x83,
  I: 0x81,
  Q: 0x82,
  C: 0x1c,
  T: 0x1d,
};

export interface S7Address {
  area: S7AreaType;
  dbNumber: number;
  dataType: S7DataType;
  offset: number;
  bitOffset: number;
  arrayLength?: number;
  stringLength?: number;
}

export interface S7StructField {
  name: string;
  type: S7DataType;
  offset: number;
  bit?: number;
  length?: number; // for STRING
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
