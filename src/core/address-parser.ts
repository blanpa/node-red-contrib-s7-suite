import { S7Address, S7AreaType, S7DataType } from '../types';
import { S7Error, S7ErrorCode } from '../utils/error-codes';

const NODES7_REGEX =
  /^(DB)(\d+),(BOOL|BYTE|WORD|DWORD|INT|DINT|REAL|LREAL|CHAR|STRING)(\d+)(?:\.(\d))?(?:\.(\d+))?$/i;

const IEC_REGEX =
  /^(DB)(\d+)\.(DBX|DBB|DBW|DBD|DBD)(\d+)(?:\.(\d))?$/i;

const AREA_REGEX =
  /^([MIQCT])(X|B|W|D)?(\d+)(?:\.(\d))?$/i;

const IEC_TYPE_MAP: Record<string, S7DataType> = {
  DBX: 'BOOL',
  DBB: 'BYTE',
  DBW: 'WORD',
  DBD: 'DWORD',
};

const AREA_SIZE_TYPE_MAP: Record<string, S7DataType> = {
  X: 'BOOL',
  B: 'BYTE',
  W: 'WORD',
  D: 'DWORD',
};

const AREA_LETTER_MAP: Record<string, S7AreaType> = {
  M: 'M',
  I: 'I',
  Q: 'Q',
  C: 'C',
  T: 'T',
};

export function splitAddresses(input: string): string[] {
  const results: string[] = [];
  let current = '';

  const parts = input.split(/\s+/);
  for (const part of parts) {
    const trimmed = part.replace(/;$/, '');
    if (!trimmed) continue;

    if (current) {
      // Check if this part looks like a data type continuation (e.g. "REAL0" after "DB1,")
      // nodes7 format: "DB1,REAL0" — if current ends with comma, join
      if (current.endsWith(',')) {
        current += trimmed;
        results.push(current);
        current = '';
        continue;
      }
      // current is complete, push it
      results.push(current);
      current = '';
    }

    // Check if this is a nodes7-style address with comma (complete or partial)
    if (/^DB\d+,/i.test(trimmed) && !/^DB\d+,\w+\d+/i.test(trimmed)) {
      // Partial: "DB1," without the type part — wait for next
      current = trimmed;
    } else {
      results.push(trimmed);
    }
  }
  if (current) {
    // If current still ends with comma, it's incomplete but push as-is
    results.push(current.replace(/,$/, ''));
  }

  // If no whitespace splitting produced results, try semicolon
  if (results.length === 0 && input.trim()) {
    return [input.trim()];
  }

  // If only one result and it contains semicolons, split on those
  if (results.length === 1 && results[0].includes(';')) {
    return results[0].split(';').map((s) => s.trim()).filter(Boolean);
  }

  return results;
}

export function parseAddress(input: string): S7Address {
  const trimmed = input.trim();

  let result = tryParseNodes7Style(trimmed);
  if (result) return result;

  result = tryParseIECStyle(trimmed);
  if (result) return result;

  result = tryParseAreaStyle(trimmed);
  if (result) return result;

  throw new S7Error(S7ErrorCode.INVALID_ADDRESS, `Cannot parse address: "${input}"`);
}

function tryParseNodes7Style(input: string): S7Address | null {
  const match = input.match(NODES7_REGEX);
  if (!match) return null;

  const dbNumber = parseInt(match[2], 10);
  const dataType = match[3].toUpperCase() as S7DataType;
  const offset = parseInt(match[4], 10);
  const bitOffset = match[5] !== undefined ? parseInt(match[5], 10) : 0;
  const arrayLength = match[6] !== undefined ? parseInt(match[6], 10) : undefined;

  return {
    area: 'DB',
    dbNumber,
    dataType,
    offset,
    bitOffset,
    arrayLength,
  };
}

function tryParseIECStyle(input: string): S7Address | null {
  const match = input.match(IEC_REGEX);
  if (!match) return null;

  const dbNumber = parseInt(match[2], 10);
  const iecType = match[3].toUpperCase();
  const dataType = IEC_TYPE_MAP[iecType];
  if (!dataType) return null;

  const offset = parseInt(match[4], 10);
  const bitOffset = match[5] !== undefined ? parseInt(match[5], 10) : 0;

  return {
    area: 'DB',
    dbNumber,
    dataType,
    offset,
    bitOffset,
  };
}

function tryParseAreaStyle(input: string): S7Address | null {
  const match = input.match(AREA_REGEX);
  if (!match) return null;

  const areaLetter = match[1].toUpperCase();
  const area = AREA_LETTER_MAP[areaLetter];
  if (!area) return null;

  const sizeLetter = match[2]?.toUpperCase();
  const offset = parseInt(match[3], 10);
  const bitOffset = match[4] !== undefined ? parseInt(match[4], 10) : 0;

  let dataType: S7DataType;
  if (sizeLetter) {
    dataType = AREA_SIZE_TYPE_MAP[sizeLetter] || 'BYTE';
  } else if (match[4] !== undefined) {
    dataType = 'BOOL';
  } else {
    dataType = 'BYTE';
  }

  return {
    area,
    dbNumber: 0,
    dataType,
    offset,
    bitOffset,
  };
}

export function toNodes7Address(addr: S7Address): string {
  if (addr.area === 'DB') {
    let result = `DB${addr.dbNumber},${addr.dataType}${addr.offset}`;
    if (addr.dataType === 'BOOL') {
      result += `.${addr.bitOffset}`;
    }
    if (addr.arrayLength !== undefined) {
      result += `.${addr.arrayLength}`;
    }
    return result;
  }

  const prefix = addr.area;
  if (addr.dataType === 'BOOL') {
    return `${prefix}${addr.offset}.${addr.bitOffset}`;
  }

  const sizeMap: Partial<Record<S7DataType, string>> = {
    BYTE: 'B',
    WORD: 'W',
    DWORD: 'D',
    INT: 'W',
    DINT: 'D',
    REAL: 'D',
  };
  const sizeLetter = sizeMap[addr.dataType] || 'B';
  return `${prefix}${sizeLetter}${addr.offset}`;
}
