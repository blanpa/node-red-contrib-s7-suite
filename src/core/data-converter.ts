import { S7DataType } from '../types';

export function byteLength(dataType: S7DataType, stringLength?: number): number {
  switch (dataType) {
    case 'BOOL':
    case 'BYTE':
    case 'CHAR':
      return 1;
    case 'WORD':
    case 'INT':
      return 2;
    case 'DWORD':
    case 'DINT':
    case 'REAL':
      return 4;
    case 'LREAL':
      return 8;
    case 'STRING':
      return (stringLength ?? 254) + 2;
  }
}

export function readValue(buffer: Buffer, offset: number, dataType: S7DataType, bitOffset = 0): unknown {
  switch (dataType) {
    case 'BOOL':
      return (buffer.readUInt8(offset) & (1 << bitOffset)) !== 0;
    case 'BYTE':
      return buffer.readUInt8(offset);
    case 'WORD':
      return buffer.readUInt16BE(offset);
    case 'DWORD':
      return buffer.readUInt32BE(offset);
    case 'INT':
      return buffer.readInt16BE(offset);
    case 'DINT':
      return buffer.readInt32BE(offset);
    case 'REAL':
      return buffer.readFloatBE(offset);
    case 'LREAL':
      return buffer.readDoubleBE(offset);
    case 'CHAR':
      return String.fromCharCode(buffer.readUInt8(offset));
    case 'STRING': {
      const maxLen = buffer.readUInt8(offset);
      const actualLen = buffer.readUInt8(offset + 1);
      const len = Math.min(actualLen, maxLen, buffer.length - offset - 2);
      return buffer.toString('ascii', offset + 2, offset + 2 + len);
    }
  }
}

export function writeValue(buffer: Buffer, offset: number, dataType: S7DataType, value: unknown, bitOffset = 0): void {
  switch (dataType) {
    case 'BOOL': {
      const current = buffer.readUInt8(offset);
      if (value) {
        buffer.writeUInt8(current | (1 << bitOffset), offset);
      } else {
        buffer.writeUInt8(current & ~(1 << bitOffset), offset);
      }
      break;
    }
    case 'BYTE':
      buffer.writeUInt8(Number(value), offset);
      break;
    case 'WORD':
      buffer.writeUInt16BE(Number(value), offset);
      break;
    case 'DWORD':
      buffer.writeUInt32BE(Number(value), offset);
      break;
    case 'INT':
      buffer.writeInt16BE(Number(value), offset);
      break;
    case 'DINT':
      buffer.writeInt32BE(Number(value), offset);
      break;
    case 'REAL':
      buffer.writeFloatBE(Number(value), offset);
      break;
    case 'LREAL':
      buffer.writeDoubleBE(Number(value), offset);
      break;
    case 'CHAR':
      buffer.writeUInt8(String(value).charCodeAt(0) || 0, offset);
      break;
    case 'STRING': {
      const str = String(value);
      const maxLen = buffer.readUInt8(offset);
      const writeLen = Math.min(str.length, maxLen);
      buffer.writeUInt8(writeLen, offset + 1);
      buffer.write(str.substring(0, writeLen), offset + 2, 'ascii');
      break;
    }
  }
}
