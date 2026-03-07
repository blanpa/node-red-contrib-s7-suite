import { splitAddresses } from '../../../src/core/address-parser';

describe('splitAddresses', () => {
  it('splits single address', () => {
    expect(splitAddresses('DB1,REAL0')).toEqual(['DB1,REAL0']);
  });

  it('splits space-separated addresses', () => {
    expect(splitAddresses('DB1,REAL0 DB1,INT4')).toEqual(['DB1,REAL0', 'DB1,INT4']);
  });

  it('splits three addresses', () => {
    expect(splitAddresses('DB1,REAL0 DB1,INT4 DB1,BOOL6.0')).toEqual([
      'DB1,REAL0', 'DB1,INT4', 'DB1,BOOL6.0',
    ]);
  });

  it('handles area-style addresses', () => {
    expect(splitAddresses('MB0 IB0 QB0')).toEqual(['MB0', 'IB0', 'QB0']);
  });

  it('handles mixed DB and area addresses', () => {
    expect(splitAddresses('DB1,REAL0 MB0')).toEqual(['DB1,REAL0', 'MB0']);
  });

  it('handles IEC-style addresses', () => {
    expect(splitAddresses('DB1.DBD0 DB2.DBW4')).toEqual(['DB1.DBD0', 'DB2.DBW4']);
  });

  it('handles single area address', () => {
    expect(splitAddresses('M0.1')).toEqual(['M0.1']);
  });

  it('handles empty string', () => {
    expect(splitAddresses('')).toEqual([]);
  });

  it('handles extra whitespace', () => {
    expect(splitAddresses('  DB1,REAL0   DB1,INT4  ')).toEqual(['DB1,REAL0', 'DB1,INT4']);
  });

  it('handles semicolons as separators', () => {
    expect(splitAddresses('DB1,REAL0;DB1,INT4')).toEqual(['DB1,REAL0', 'DB1,INT4']);
  });

  it('strips trailing semicolons', () => {
    expect(splitAddresses('DB1,REAL0; DB1,INT4;')).toEqual(['DB1,REAL0', 'DB1,INT4']);
  });
});
