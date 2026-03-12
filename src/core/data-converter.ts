import { S7DataType } from '../types';
import { S7Error, S7ErrorCode } from '../utils/error-codes';

/** S7 epoch: 1990-01-01 */
const S7_DATE_EPOCH = new Date('1990-01-01T00:00:00Z');
const S7_DATE_EPOCH_MS = S7_DATE_EPOCH.getTime();

/** Encode a decimal value (0-99) as BCD byte */
function toBCD(val: number): number {
  const clamped = Math.max(0, Math.min(99, Math.floor(val)));
  return ((Math.floor(clamped / 10) & 0x0f) << 4) | (clamped % 10);
}

/** Decode a BCD byte to decimal value */
function fromBCD(bcd: number): number {
  return ((bcd >> 4) & 0x0f) * 10 + (bcd & 0x0f);
}

/** Returns the byte length for a given S7 data type. */
export function byteLength(dataType: S7DataType, stringLength?: number): number {
  switch (dataType) {
    case 'BOOL':
    case 'BYTE':
    case 'CHAR':
    case 'USINT':
      return 1;
    case 'WORD':
    case 'INT':
    case 'UINT':
    case 'DATE':
    case 'S5TIME':
      return 2;
    case 'DWORD':
    case 'DINT':
    case 'REAL':
    case 'UDINT':
    case 'TIME':
    case 'TIME_OF_DAY':
      return 4;
    case 'LREAL':
    case 'LINT':
    case 'ULINT':
    case 'DATE_AND_TIME':
      return 8;
    case 'STRING':
      return (stringLength ?? 254) + 2;
    case 'WSTRING':
      return (stringLength ?? 254) * 2 + 4;
  }
}

/** Reads a typed value from a buffer at the given offset. */
export function readValue(buffer: Buffer, offset: number, dataType: S7DataType, bitOffset = 0): unknown {
  const required = dataType === 'STRING' ? 2 : dataType === 'WSTRING' ? 4 : byteLength(dataType);
  if (buffer.length < offset + required) {
    throw new S7Error(S7ErrorCode.READ_FAILED, `Buffer too small for ${dataType} read at offset ${offset}: need ${offset + required} bytes, have ${buffer.length}`);
  }
  switch (dataType) {
    case 'BOOL':
      return (buffer.readUInt8(offset) & (1 << bitOffset)) !== 0;
    case 'BYTE':
      return buffer.readUInt8(offset);
    case 'USINT':
      return buffer.readUInt8(offset);
    case 'WORD':
      return buffer.readUInt16BE(offset);
    case 'UINT':
      return buffer.readUInt16BE(offset);
    case 'DWORD':
      return buffer.readUInt32BE(offset);
    case 'UDINT':
      return buffer.readUInt32BE(offset);
    case 'INT':
      return buffer.readInt16BE(offset);
    case 'DINT':
      return buffer.readInt32BE(offset);
    case 'LINT':
      return Number(buffer.readBigInt64BE(offset));
    case 'ULINT':
      return Number(buffer.readBigUInt64BE(offset));
    case 'REAL':
      return buffer.readFloatBE(offset);
    case 'LREAL':
      return buffer.readDoubleBE(offset);
    case 'CHAR':
      return String.fromCharCode(buffer.readUInt8(offset));
    case 'STRING': {
      const maxLen = buffer.readUInt8(offset);
      const actualLen = buffer.readUInt8(offset + 1);
      const available = Math.max(0, buffer.length - offset - 2);
      const len = Math.min(actualLen, maxLen, available);
      return buffer.toString('ascii', offset + 2, offset + 2 + len);
    }
    case 'WSTRING': {
      const wsMaxLen = buffer.readUInt16BE(offset);
      const wsActualLen = buffer.readUInt16BE(offset + 2);
      const wsAvailable = Math.max(0, Math.floor((buffer.length - offset - 4) / 2));
      const wsLen = Math.min(wsActualLen, wsMaxLen, wsAvailable);
      const chars: string[] = [];
      for (let i = 0; i < wsLen; i++) {
        chars.push(String.fromCharCode(buffer.readUInt16BE(offset + 4 + i * 2)));
      }
      return chars.join('');
    }
    case 'DATE': {
      const days = buffer.readUInt16BE(offset);
      const dateMs = S7_DATE_EPOCH_MS + days * 86400000;
      const d = new Date(dateMs);
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
    case 'TIME':
      return buffer.readInt32BE(offset);
    case 'TIME_OF_DAY':
      return buffer.readUInt32BE(offset);
    case 'DATE_AND_TIME': {
      const yr = fromBCD(buffer.readUInt8(offset));
      const mo = fromBCD(buffer.readUInt8(offset + 1));
      const dy = fromBCD(buffer.readUInt8(offset + 2));
      const hr = fromBCD(buffer.readUInt8(offset + 3));
      const mi = fromBCD(buffer.readUInt8(offset + 4));
      const sc = fromBCD(buffer.readUInt8(offset + 5));
      const msHigh = fromBCD(buffer.readUInt8(offset + 6));
      const msLowAndDow = buffer.readUInt8(offset + 7);
      const msLow = (msLowAndDow >> 4) & 0x0f;
      const ms = msHigh * 10 + msLow;
      const fullYear = yr < 90 ? 2000 + yr : 1900 + yr;
      const dt = new Date(Date.UTC(fullYear, mo - 1, dy, hr, mi, sc, ms));
      return dt.toISOString();
    }
    case 'S5TIME': {
      const raw = buffer.readUInt16BE(offset);
      const timeBase = (raw >> 12) & 0x03;
      const bcdVal = raw & 0x0fff;
      const hundreds = (bcdVal >> 8) & 0x0f;
      const tens = (bcdVal >> 4) & 0x0f;
      const ones = bcdVal & 0x0f;
      const count = hundreds * 100 + tens * 10 + ones;
      const multipliers = [10, 100, 1000, 10000];
      return count * multipliers[timeBase];
    }
  }
}

/** Writes a typed value into a buffer at the given offset. */
export function writeValue(buffer: Buffer, offset: number, dataType: S7DataType, value: unknown, bitOffset = 0): void {
  const required = dataType === 'STRING' ? 2 : byteLength(dataType);
  if (buffer.length < offset + required) {
    throw new S7Error(S7ErrorCode.WRITE_FAILED, `Buffer too small for ${dataType} write at offset ${offset}: need ${offset + required} bytes, have ${buffer.length}`);
  }
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
    case 'USINT':
      buffer.writeUInt8(Number(value), offset);
      break;
    case 'UINT':
      buffer.writeUInt16BE(Number(value), offset);
      break;
    case 'UDINT':
      buffer.writeUInt32BE(Number(value), offset);
      break;
    case 'LINT':
      buffer.writeBigInt64BE(BigInt(Math.round(Number(value))), offset);
      break;
    case 'ULINT':
      buffer.writeBigUInt64BE(BigInt(Math.round(Number(value))), offset);
      break;
    case 'STRING': {
      const str = String(value);
      const maxLen = buffer.readUInt8(offset) || (buffer.length - offset - 2);
      const writeLen = Math.min(str.length, maxLen, buffer.length - offset - 2);
      if (writeLen < 0) break;
      buffer.writeUInt8(maxLen, offset);
      buffer.writeUInt8(writeLen, offset + 1);
      buffer.write(str.substring(0, writeLen), offset + 2, writeLen, 'ascii');
      break;
    }
    case 'WSTRING': {
      const wstr = String(value);
      const wsMaxLen = buffer.readUInt16BE(offset) || Math.floor((buffer.length - offset - 4) / 2);
      const wsWriteLen = Math.min(wstr.length, wsMaxLen, Math.floor((buffer.length - offset - 4) / 2));
      if (wsWriteLen < 0) break;
      buffer.writeUInt16BE(wsMaxLen, offset);
      buffer.writeUInt16BE(wsWriteLen, offset + 2);
      for (let i = 0; i < wsWriteLen; i++) {
        buffer.writeUInt16BE(wstr.charCodeAt(i), offset + 4 + i * 2);
      }
      break;
    }
    case 'DATE': {
      const dateVal = new Date(String(value));
      const daysDiff = Math.round((dateVal.getTime() - S7_DATE_EPOCH_MS) / 86400000);
      buffer.writeUInt16BE(Math.max(0, daysDiff), offset);
      break;
    }
    case 'TIME':
      buffer.writeInt32BE(Number(value), offset);
      break;
    case 'TIME_OF_DAY':
      buffer.writeUInt32BE(Number(value), offset);
      break;
    case 'DATE_AND_TIME': {
      const dtVal = new Date(String(value));
      const dtYear = dtVal.getUTCFullYear();
      const yr2 = dtYear >= 2000 ? dtYear - 2000 : dtYear - 1900;
      buffer.writeUInt8(toBCD(yr2), offset);
      buffer.writeUInt8(toBCD(dtVal.getUTCMonth() + 1), offset + 1);
      buffer.writeUInt8(toBCD(dtVal.getUTCDate()), offset + 2);
      buffer.writeUInt8(toBCD(dtVal.getUTCHours()), offset + 3);
      buffer.writeUInt8(toBCD(dtVal.getUTCMinutes()), offset + 4);
      buffer.writeUInt8(toBCD(dtVal.getUTCSeconds()), offset + 5);
      const dtMs = dtVal.getUTCMilliseconds();
      const msH = Math.floor(dtMs / 10);
      const msL = dtMs % 10;
      buffer.writeUInt8(toBCD(msH), offset + 6);
      const dow = dtVal.getUTCDay() === 0 ? 7 : dtVal.getUTCDay(); // 1=Mon..7=Sun
      buffer.writeUInt8(((msL & 0x0f) << 4) | (dow & 0x0f), offset + 7);
      break;
    }
    case 'S5TIME': {
      const totalMs = Math.max(0, Number(value));
      let base: number;
      let multiplier: number;
      if (totalMs <= 9990) { base = 0; multiplier = 10; }
      else if (totalMs <= 99900) { base = 1; multiplier = 100; }
      else if (totalMs <= 999000) { base = 2; multiplier = 1000; }
      else { base = 3; multiplier = 10000; }
      const count = Math.min(999, Math.round(totalMs / multiplier));
      const h = Math.floor(count / 100);
      const t = Math.floor((count % 100) / 10);
      const o = count % 10;
      const bcdVal = (h << 8) | (t << 4) | o;
      buffer.writeUInt16BE((base << 12) | bcdVal, offset);
      break;
    }
  }
}
