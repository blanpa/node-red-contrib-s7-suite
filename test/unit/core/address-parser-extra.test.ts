import { parseAddress, toNodes7Address } from '../../../src/core/address-parser';
import { S7Address } from '../../../src/types';

describe('address-parser - extra coverage', () => {
  it('parses MX as BOOL', () => {
    const addr = parseAddress('MX0.1');
    expect(addr.area).toBe('M');
    expect(addr.dataType).toBe('BOOL');
    expect(addr.bitOffset).toBe(1);
  });

  it('parses C area', () => {
    const addr = parseAddress('C0');
    expect(addr.area).toBe('C');
    expect(addr.dataType).toBe('BYTE');
  });

  it('parses T area', () => {
    const addr = parseAddress('T0');
    expect(addr.area).toBe('T');
    expect(addr.dataType).toBe('BYTE');
  });

  it('toNodes7Address for INT uses W', () => {
    const addr: S7Address = {
      area: 'M', dbNumber: 0, dataType: 'INT', offset: 10, bitOffset: 0,
    };
    expect(toNodes7Address(addr)).toBe('MW10');
  });

  it('toNodes7Address for DINT uses D', () => {
    const addr: S7Address = {
      area: 'M', dbNumber: 0, dataType: 'DINT', offset: 0, bitOffset: 0,
    };
    expect(toNodes7Address(addr)).toBe('MD0');
  });

  it('toNodes7Address for REAL uses D', () => {
    const addr: S7Address = {
      area: 'Q', dbNumber: 0, dataType: 'REAL', offset: 0, bitOffset: 0,
    };
    expect(toNodes7Address(addr)).toBe('QD0');
  });

  it('toNodes7Address for Q BOOL', () => {
    const addr: S7Address = {
      area: 'Q', dbNumber: 0, dataType: 'BOOL', offset: 0, bitOffset: 3,
    };
    expect(toNodes7Address(addr)).toBe('Q0.3');
  });

  it('toNodes7Address for DB WORD', () => {
    const addr: S7Address = {
      area: 'DB', dbNumber: 5, dataType: 'WORD', offset: 10, bitOffset: 0,
    };
    expect(toNodes7Address(addr)).toBe('DB5,WORD10');
  });

  it('toNodes7Address for unsupported type falls back to B', () => {
    const addr: S7Address = {
      area: 'M', dbNumber: 0, dataType: 'STRING', offset: 0, bitOffset: 0,
    };
    expect(toNodes7Address(addr)).toBe('MB0');
  });
});
