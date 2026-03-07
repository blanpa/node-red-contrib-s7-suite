import { byteLength, readValue, writeValue } from '../../../src/core/data-converter';

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
  });
});
