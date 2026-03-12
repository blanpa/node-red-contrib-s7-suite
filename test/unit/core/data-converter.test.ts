import { byteLength, readValue, writeValue } from '../../../src/core/data-converter';
import { S7Error } from '../../../src/utils/error-codes';

describe('data-converter', () => {
  describe('byteLength', () => {
    it('returns 1 for BOOL', () => expect(byteLength('BOOL')).toBe(1));
    it('returns 1 for BYTE', () => expect(byteLength('BYTE')).toBe(1));
    it('returns 1 for CHAR', () => expect(byteLength('CHAR')).toBe(1));
    it('returns 2 for WORD', () => expect(byteLength('WORD')).toBe(2));
    it('returns 2 for INT', () => expect(byteLength('INT')).toBe(2));
    it('returns 4 for DWORD', () => expect(byteLength('DWORD')).toBe(4));
    it('returns 4 for DINT', () => expect(byteLength('DINT')).toBe(4));
    it('returns 4 for REAL', () => expect(byteLength('REAL')).toBe(4));
    it('returns 8 for LREAL', () => expect(byteLength('LREAL')).toBe(8));
    it('returns 256 for STRING (default)', () => expect(byteLength('STRING')).toBe(256));
    it('returns custom length for STRING', () => expect(byteLength('STRING', 50)).toBe(52));
    it('returns 1 for USINT', () => expect(byteLength('USINT')).toBe(1));
    it('returns 2 for UINT', () => expect(byteLength('UINT')).toBe(2));
    it('returns 2 for DATE', () => expect(byteLength('DATE')).toBe(2));
    it('returns 2 for S5TIME', () => expect(byteLength('S5TIME')).toBe(2));
    it('returns 4 for UDINT', () => expect(byteLength('UDINT')).toBe(4));
    it('returns 4 for TIME', () => expect(byteLength('TIME')).toBe(4));
    it('returns 4 for TIME_OF_DAY', () => expect(byteLength('TIME_OF_DAY')).toBe(4));
    it('returns 8 for LINT', () => expect(byteLength('LINT')).toBe(8));
    it('returns 8 for ULINT', () => expect(byteLength('ULINT')).toBe(8));
    it('returns 8 for DATE_AND_TIME', () => expect(byteLength('DATE_AND_TIME')).toBe(8));
    it('returns 512 for WSTRING (default)', () => expect(byteLength('WSTRING')).toBe(512));
    it('returns custom length for WSTRING', () => expect(byteLength('WSTRING', 10)).toBe(24));
  });

  describe('readValue', () => {
    it('reads BOOL bit 0 = true', () => {
      const buf = Buffer.from([0x01]);
      expect(readValue(buf, 0, 'BOOL', 0)).toBe(true);
    });

    it('reads BOOL bit 0 = false', () => {
      const buf = Buffer.from([0x00]);
      expect(readValue(buf, 0, 'BOOL', 0)).toBe(false);
    });

    it('reads BOOL bit 3', () => {
      const buf = Buffer.from([0x08]); // bit 3 set
      expect(readValue(buf, 0, 'BOOL', 3)).toBe(true);
    });

    it('reads BYTE', () => {
      const buf = Buffer.from([0xAB]);
      expect(readValue(buf, 0, 'BYTE')).toBe(0xAB);
    });

    it('reads WORD (big-endian)', () => {
      const buf = Buffer.from([0x01, 0x00]);
      expect(readValue(buf, 0, 'WORD')).toBe(256);
    });

    it('reads DWORD', () => {
      const buf = Buffer.alloc(4);
      buf.writeUInt32BE(0x12345678);
      expect(readValue(buf, 0, 'DWORD')).toBe(0x12345678);
    });

    it('reads INT (signed)', () => {
      const buf = Buffer.alloc(2);
      buf.writeInt16BE(-100);
      expect(readValue(buf, 0, 'INT')).toBe(-100);
    });

    it('reads DINT (signed)', () => {
      const buf = Buffer.alloc(4);
      buf.writeInt32BE(-100000);
      expect(readValue(buf, 0, 'DINT')).toBe(-100000);
    });

    it('reads REAL', () => {
      const buf = Buffer.alloc(4);
      buf.writeFloatBE(3.14);
      expect(readValue(buf, 0, 'REAL')).toBeCloseTo(3.14);
    });

    it('reads LREAL', () => {
      const buf = Buffer.alloc(8);
      buf.writeDoubleBE(3.141592653589793);
      expect(readValue(buf, 0, 'LREAL')).toBeCloseTo(3.141592653589793);
    });

    it('reads CHAR', () => {
      const buf = Buffer.from([0x41]); // 'A'
      expect(readValue(buf, 0, 'CHAR')).toBe('A');
    });

    it('reads STRING', () => {
      const buf = Buffer.alloc(20);
      buf.writeUInt8(18, 0); // max length
      buf.writeUInt8(5, 1); // actual length
      buf.write('Hello', 2, 'ascii');
      expect(readValue(buf, 0, 'STRING')).toBe('Hello');
    });

    it('reads with offset', () => {
      const buf = Buffer.from([0x00, 0x00, 0xAB]);
      expect(readValue(buf, 2, 'BYTE')).toBe(0xAB);
    });

    it('reads USINT', () => {
      const buf = Buffer.from([200]);
      expect(readValue(buf, 0, 'USINT')).toBe(200);
    });

    it('reads UINT', () => {
      const buf = Buffer.alloc(2);
      buf.writeUInt16BE(50000);
      expect(readValue(buf, 0, 'UINT')).toBe(50000);
    });

    it('reads UDINT', () => {
      const buf = Buffer.alloc(4);
      buf.writeUInt32BE(3000000000);
      expect(readValue(buf, 0, 'UDINT')).toBe(3000000000);
    });

    it('reads LINT (signed 64-bit)', () => {
      const buf = Buffer.alloc(8);
      buf.writeBigInt64BE(BigInt(-1234567890));
      expect(readValue(buf, 0, 'LINT')).toBe(-1234567890);
    });

    it('reads ULINT (unsigned 64-bit)', () => {
      const buf = Buffer.alloc(8);
      buf.writeBigUInt64BE(BigInt(1234567890));
      expect(readValue(buf, 0, 'ULINT')).toBe(1234567890);
    });

    it('reads WSTRING', () => {
      // max=10, actual=3, then UCS-2 chars for "Hi!"
      const buf = Buffer.alloc(4 + 10 * 2);
      buf.writeUInt16BE(10, 0); // max length
      buf.writeUInt16BE(3, 2);  // actual length
      buf.writeUInt16BE(0x0048, 4); // 'H'
      buf.writeUInt16BE(0x0069, 6); // 'i'
      buf.writeUInt16BE(0x0021, 8); // '!'
      expect(readValue(buf, 0, 'WSTRING')).toBe('Hi!');
    });

    it('reads WSTRING clamps to available buffer', () => {
      // actual length claims 10 chars but buffer only has room for 2
      const buf = Buffer.alloc(4 + 2 * 2);
      buf.writeUInt16BE(10, 0); // max
      buf.writeUInt16BE(10, 2); // actual (overstated)
      buf.writeUInt16BE(0x0041, 4); // 'A'
      buf.writeUInt16BE(0x0042, 6); // 'B'
      expect(readValue(buf, 0, 'WSTRING')).toBe('AB');
    });

    it('reads DATE (days since 1990-01-01)', () => {
      // 0 days = 1990-01-01
      const buf = Buffer.alloc(2);
      buf.writeUInt16BE(0);
      expect(readValue(buf, 0, 'DATE')).toBe('1990-01-01');
    });

    it('reads DATE with offset days', () => {
      // 365 days from 1990-01-01 = 1991-01-01
      const buf = Buffer.alloc(2);
      buf.writeUInt16BE(365);
      expect(readValue(buf, 0, 'DATE')).toBe('1991-01-01');
    });

    it('reads TIME (signed INT32BE milliseconds)', () => {
      const buf = Buffer.alloc(4);
      buf.writeInt32BE(-5000);
      expect(readValue(buf, 0, 'TIME')).toBe(-5000);
    });

    it('reads TIME_OF_DAY (unsigned UINT32BE milliseconds)', () => {
      // 12:00:00.000 = 43200000 ms
      const buf = Buffer.alloc(4);
      buf.writeUInt32BE(43200000);
      expect(readValue(buf, 0, 'TIME_OF_DAY')).toBe(43200000);
    });

    it('reads DATE_AND_TIME (BCD encoded)', () => {
      // 2024-03-15 10:30:45.123 (Friday = DOW 5)
      const buf = Buffer.alloc(8);
      buf.writeUInt8(0x24, 0); // year 24 (BCD)
      buf.writeUInt8(0x03, 1); // month 03
      buf.writeUInt8(0x15, 2); // day 15
      buf.writeUInt8(0x10, 3); // hour 10
      buf.writeUInt8(0x30, 4); // minute 30
      buf.writeUInt8(0x45, 5); // second 45
      buf.writeUInt8(0x12, 6); // ms high: 12 (BCD) -> 12
      // ms low digit = 3, dow = 5 (Friday)
      buf.writeUInt8(0x35, 7); // (3 << 4) | 5
      // ms = 12*10 + 3 = 123
      const result = readValue(buf, 0, 'DATE_AND_TIME') as string;
      const d = new Date(result);
      expect(d.getUTCFullYear()).toBe(2024);
      expect(d.getUTCMonth()).toBe(2); // March = 2
      expect(d.getUTCDate()).toBe(15);
      expect(d.getUTCHours()).toBe(10);
      expect(d.getUTCMinutes()).toBe(30);
      expect(d.getUTCSeconds()).toBe(45);
      expect(d.getUTCMilliseconds()).toBe(123);
    });

    it('reads DATE_AND_TIME with year >= 90 (1900s)', () => {
      const buf = Buffer.alloc(8);
      buf.writeUInt8(0x95, 0); // year 95 -> 1995
      buf.writeUInt8(0x06, 1);
      buf.writeUInt8(0x01, 2);
      buf.writeUInt8(0x00, 3);
      buf.writeUInt8(0x00, 4);
      buf.writeUInt8(0x00, 5);
      buf.writeUInt8(0x00, 6);
      buf.writeUInt8(0x01, 7); // ms low=0, dow=1
      const result = readValue(buf, 0, 'DATE_AND_TIME') as string;
      const d = new Date(result);
      expect(d.getUTCFullYear()).toBe(1995);
    });

    it('reads S5TIME with time base 0 (10ms)', () => {
      // base=0, count=100 -> 100 * 10 = 1000ms
      // BCD 100 = 0x100, base 0 -> (0 << 12) | 0x100 = 0x0100
      const buf = Buffer.alloc(2);
      buf.writeUInt16BE(0x0100);
      expect(readValue(buf, 0, 'S5TIME')).toBe(1000);
    });

    it('reads S5TIME with time base 1 (100ms)', () => {
      // base=1, count=50 -> 50 * 100 = 5000ms
      // BCD 50 = 0x050, base 1 -> (1 << 12) | 0x050 = 0x1050
      const buf = Buffer.alloc(2);
      buf.writeUInt16BE(0x1050);
      expect(readValue(buf, 0, 'S5TIME')).toBe(5000);
    });

    it('reads S5TIME with time base 2 (1000ms)', () => {
      // base=2, count=10 -> 10 * 1000 = 10000ms
      // BCD 10 = 0x010, base 2 -> (2 << 12) | 0x010 = 0x2010
      const buf = Buffer.alloc(2);
      buf.writeUInt16BE(0x2010);
      expect(readValue(buf, 0, 'S5TIME')).toBe(10000);
    });

    it('reads S5TIME with time base 3 (10000ms)', () => {
      // base=3, count=5 -> 5 * 10000 = 50000ms
      // BCD 5 = 0x005, base 3 -> (3 << 12) | 0x005 = 0x3005
      const buf = Buffer.alloc(2);
      buf.writeUInt16BE(0x3005);
      expect(readValue(buf, 0, 'S5TIME')).toBe(50000);
    });

    it('throws S7Error on buffer too small for read', () => {
      const buf = Buffer.alloc(1);
      expect(() => readValue(buf, 0, 'DWORD')).toThrow(S7Error);
    });

    it('throws S7Error on buffer too small for WSTRING read', () => {
      const buf = Buffer.alloc(2); // need at least 4
      expect(() => readValue(buf, 0, 'WSTRING')).toThrow(S7Error);
    });
  });

  describe('writeValue', () => {
    it('writes BOOL true', () => {
      const buf = Buffer.from([0x00]);
      writeValue(buf, 0, 'BOOL', true, 0);
      expect(buf[0]).toBe(0x01);
    });

    it('writes BOOL false (clears bit)', () => {
      const buf = Buffer.from([0xFF]);
      writeValue(buf, 0, 'BOOL', false, 3);
      expect(buf[0]).toBe(0xF7);
    });

    it('writes BOOL preserves other bits', () => {
      const buf = Buffer.from([0xAA]);
      writeValue(buf, 0, 'BOOL', true, 0);
      expect(buf[0]).toBe(0xAB);
    });

    it('writes BYTE', () => {
      const buf = Buffer.alloc(1);
      writeValue(buf, 0, 'BYTE', 0xCD);
      expect(buf[0]).toBe(0xCD);
    });

    it('writes WORD', () => {
      const buf = Buffer.alloc(2);
      writeValue(buf, 0, 'WORD', 0x1234);
      expect(buf.readUInt16BE(0)).toBe(0x1234);
    });

    it('writes DWORD', () => {
      const buf = Buffer.alloc(4);
      writeValue(buf, 0, 'DWORD', 0x12345678);
      expect(buf.readUInt32BE(0)).toBe(0x12345678);
    });

    it('writes INT', () => {
      const buf = Buffer.alloc(2);
      writeValue(buf, 0, 'INT', -200);
      expect(buf.readInt16BE(0)).toBe(-200);
    });

    it('writes DINT', () => {
      const buf = Buffer.alloc(4);
      writeValue(buf, 0, 'DINT', -50000);
      expect(buf.readInt32BE(0)).toBe(-50000);
    });

    it('writes REAL', () => {
      const buf = Buffer.alloc(4);
      writeValue(buf, 0, 'REAL', 1.5);
      expect(buf.readFloatBE(0)).toBeCloseTo(1.5);
    });

    it('writes LREAL', () => {
      const buf = Buffer.alloc(8);
      writeValue(buf, 0, 'LREAL', 2.718281828);
      expect(buf.readDoubleBE(0)).toBeCloseTo(2.718281828);
    });

    it('writes CHAR', () => {
      const buf = Buffer.alloc(1);
      writeValue(buf, 0, 'CHAR', 'Z');
      expect(buf[0]).toBe(0x5A);
    });

    it('writes STRING', () => {
      const buf = Buffer.alloc(20);
      buf.writeUInt8(18, 0); // max length
      writeValue(buf, 0, 'STRING', 'Hi');
      expect(buf.readUInt8(1)).toBe(2); // actual length
      expect(buf.toString('ascii', 2, 4)).toBe('Hi');
    });

    it('writes USINT', () => {
      const buf = Buffer.alloc(1);
      writeValue(buf, 0, 'USINT', 200);
      expect(buf.readUInt8(0)).toBe(200);
    });

    it('writes UINT', () => {
      const buf = Buffer.alloc(2);
      writeValue(buf, 0, 'UINT', 50000);
      expect(buf.readUInt16BE(0)).toBe(50000);
    });

    it('writes UDINT', () => {
      const buf = Buffer.alloc(4);
      writeValue(buf, 0, 'UDINT', 3000000000);
      expect(buf.readUInt32BE(0)).toBe(3000000000);
    });

    it('writes LINT', () => {
      const buf = Buffer.alloc(8);
      writeValue(buf, 0, 'LINT', -1234567890);
      expect(buf.readBigInt64BE(0)).toBe(BigInt(-1234567890));
    });

    it('writes ULINT', () => {
      const buf = Buffer.alloc(8);
      writeValue(buf, 0, 'ULINT', 1234567890);
      expect(buf.readBigUInt64BE(0)).toBe(BigInt(1234567890));
    });

    it('writes WSTRING', () => {
      const buf = Buffer.alloc(byteLength('WSTRING')); // 512 bytes (default)
      writeValue(buf, 0, 'WSTRING', 'Hi!');
      expect(buf.readUInt16BE(2)).toBe(3); // actual length
      expect(buf.readUInt16BE(4)).toBe(0x0048); // 'H'
      expect(buf.readUInt16BE(6)).toBe(0x0069); // 'i'
      expect(buf.readUInt16BE(8)).toBe(0x0021); // '!'
    });

    it('writes DATE', () => {
      const buf = Buffer.alloc(2);
      writeValue(buf, 0, 'DATE', '1990-01-01');
      expect(buf.readUInt16BE(0)).toBe(0);
    });

    it('writes DATE with offset days', () => {
      const buf = Buffer.alloc(2);
      writeValue(buf, 0, 'DATE', '1991-01-01');
      expect(buf.readUInt16BE(0)).toBe(365);
    });

    it('writes TIME', () => {
      const buf = Buffer.alloc(4);
      writeValue(buf, 0, 'TIME', -5000);
      expect(buf.readInt32BE(0)).toBe(-5000);
    });

    it('writes TIME_OF_DAY', () => {
      const buf = Buffer.alloc(4);
      writeValue(buf, 0, 'TIME_OF_DAY', 43200000);
      expect(buf.readUInt32BE(0)).toBe(43200000);
    });

    it('writes DATE_AND_TIME', () => {
      const buf = Buffer.alloc(8);
      writeValue(buf, 0, 'DATE_AND_TIME', '2024-03-15T10:30:45.123Z');
      // Verify BCD encoding
      expect(buf.readUInt8(0)).toBe(0x24); // year
      expect(buf.readUInt8(1)).toBe(0x03); // month
      expect(buf.readUInt8(2)).toBe(0x15); // day
      expect(buf.readUInt8(3)).toBe(0x10); // hour
      expect(buf.readUInt8(4)).toBe(0x30); // minute
      expect(buf.readUInt8(5)).toBe(0x45); // second
      expect(buf.readUInt8(6)).toBe(0x12); // ms high (12 BCD)
      // ms low = 3, dow = Friday = 5
      expect(buf.readUInt8(7)).toBe(0x35);
    });

    it('writes DATE_AND_TIME for year >= 2000', () => {
      const buf = Buffer.alloc(8);
      writeValue(buf, 0, 'DATE_AND_TIME', '2000-01-01T00:00:00.000Z');
      expect(buf.readUInt8(0)).toBe(0x00); // year 2000 -> 0 BCD
    });

    it('writes S5TIME with base 0 (10ms)', () => {
      const buf = Buffer.alloc(2);
      writeValue(buf, 0, 'S5TIME', 1000); // 1000ms -> base 0, count 100
      const raw = buf.readUInt16BE(0);
      const base = (raw >> 12) & 0x03;
      expect(base).toBe(0);
      // Decode BCD count
      const bcdVal = raw & 0x0fff;
      const count = ((bcdVal >> 8) & 0x0f) * 100 + ((bcdVal >> 4) & 0x0f) * 10 + (bcdVal & 0x0f);
      expect(count).toBe(100);
    });

    it('writes S5TIME with base 1 (100ms)', () => {
      const buf = Buffer.alloc(2);
      writeValue(buf, 0, 'S5TIME', 50000); // 50000ms -> base 1, count 500
      const raw = buf.readUInt16BE(0);
      const base = (raw >> 12) & 0x03;
      expect(base).toBe(1);
    });

    it('writes S5TIME with base 2 (1000ms)', () => {
      const buf = Buffer.alloc(2);
      writeValue(buf, 0, 'S5TIME', 500000); // 500000ms -> base 2, count 500
      const raw = buf.readUInt16BE(0);
      const base = (raw >> 12) & 0x03;
      expect(base).toBe(2);
    });

    it('writes S5TIME with base 3 (10000ms)', () => {
      const buf = Buffer.alloc(2);
      writeValue(buf, 0, 'S5TIME', 5000000); // -> base 3
      const raw = buf.readUInt16BE(0);
      const base = (raw >> 12) & 0x03;
      expect(base).toBe(3);
    });

    it('writes and reads S5TIME roundtrip', () => {
      const buf = Buffer.alloc(2);
      writeValue(buf, 0, 'S5TIME', 5000);
      expect(readValue(buf, 0, 'S5TIME')).toBe(5000);
    });

    it('writes and reads DATE_AND_TIME roundtrip', () => {
      const buf = Buffer.alloc(8);
      const iso = '2024-03-15T10:30:45.123Z';
      writeValue(buf, 0, 'DATE_AND_TIME', iso);
      const result = readValue(buf, 0, 'DATE_AND_TIME') as string;
      expect(new Date(result).getTime()).toBe(new Date(iso).getTime());
    });

    it('throws S7Error on buffer too small for write', () => {
      const buf = Buffer.alloc(1);
      expect(() => writeValue(buf, 0, 'DWORD', 123)).toThrow(S7Error);
    });

    it('throws S7Error on buffer too small for WSTRING write', () => {
      const buf = Buffer.alloc(2); // need at least 4 for WSTRING header
      expect(() => writeValue(buf, 0, 'WSTRING', 'test')).toThrow(S7Error);
    });
  });
});
