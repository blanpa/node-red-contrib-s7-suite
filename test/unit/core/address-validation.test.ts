import { parseAddress } from '../../../src/core/address-parser';
import { AREA_CODE_MAP } from '../../../src/types/s7-address';

describe('address validation', () => {
  describe('bitOffset validation', () => {
    it('accepts bitOffset 0-7 for BOOL', () => {
      for (let bit = 0; bit <= 7; bit++) {
        const addr = parseAddress(`DB1,BOOL0.${bit}`);
        expect(addr.bitOffset).toBe(bit);
      }
    });

    it('rejects bitOffset > 7 for BOOL', () => {
      expect(() => parseAddress('DB1,BOOL0.8')).toThrow(/Bit offset must be 0-7/);
    });

    it('rejects bitOffset > 7 for area-style BOOL', () => {
      expect(() => parseAddress('M0.8')).toThrow(/Bit offset must be 0-7/);
    });
  });

  describe('dbNumber validation', () => {
    it('accepts dbNumber >= 1', () => {
      const addr = parseAddress('DB1,REAL0');
      expect(addr.dbNumber).toBe(1);
    });

    it('rejects dbNumber 0 for DB area', () => {
      expect(() => parseAddress('DB0,REAL0')).toThrow(/DB number must be >= 1/);
    });
  });

  describe('offset validation', () => {
    it('accepts offset 0', () => {
      const addr = parseAddress('DB1,REAL0');
      expect(addr.offset).toBe(0);
    });

    it('accepts positive offset', () => {
      const addr = parseAddress('DB1,REAL100');
      expect(addr.offset).toBe(100);
    });
  });
});

describe('AREA_CODE_MAP', () => {
  it('contains all expected area types', () => {
    expect(AREA_CODE_MAP.DB).toBe(0x84);
    expect(AREA_CODE_MAP.M).toBe(0x83);
    expect(AREA_CODE_MAP.I).toBe(0x81);
    expect(AREA_CODE_MAP.Q).toBe(0x82);
    expect(AREA_CODE_MAP.C).toBe(0x1c);
    expect(AREA_CODE_MAP.T).toBe(0x1d);
  });

  it('has codes for all S7AreaType values', () => {
    const expectedAreas = ['DB', 'M', 'I', 'Q', 'C', 'T'];
    for (const area of expectedAreas) {
      expect(AREA_CODE_MAP[area as keyof typeof AREA_CODE_MAP]).toBeDefined();
    }
  });
});
