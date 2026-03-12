import { NodeS7Backend } from '../../../src/backend/nodes7-backend';

const mockInitiateConnection = jest.fn();
const mockDropConnection = jest.fn();
const mockAddItems = jest.fn();
const mockRemoveItems = jest.fn();
const mockReadAllItems = jest.fn();
const mockWriteItems = jest.fn();

jest.mock('nodes7', () => {
  return jest.fn().mockImplementation(() => ({
    initiateConnection: mockInitiateConnection,
    dropConnection: mockDropConnection,
    addItems: mockAddItems,
    removeItems: mockRemoveItems,
    readAllItems: mockReadAllItems,
    writeItems: mockWriteItems,
  }));
});

describe('NodeS7Backend - rawArea and edge cases', () => {
  let backend: NodeS7Backend;

  beforeEach(async () => {
    backend = new NodeS7Backend();
    jest.clearAllMocks();
    mockInitiateConnection.mockImplementation((_p: unknown, cb: Function) => cb());
    await backend.connect({
      host: '192.168.1.100', port: 102, rack: 0, slot: 1,
      plcType: 'S7-1200', backend: 'nodes7',
    });
  });

  it('readRawArea with DB area returns buffer', async () => {
    const buf = Buffer.from([0x01, 0x02, 0x03]);
    mockReadAllItems.mockImplementation((cb: Function) => {
      cb(undefined, { 'DB1,BYTE0.3': buf });
    });

    const result = await backend.readRawArea(0x84, 1, 0, 3);
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('readRawArea with M area', async () => {
    mockReadAllItems.mockImplementation((cb: Function) => {
      cb(undefined, { 'MB0.1': 42 });
    });

    const result = await backend.readRawArea(0x83, 0, 0, 1);
    expect(result.readUInt8(0)).toBe(42);
  });

  it('readRawArea with I area', async () => {
    mockReadAllItems.mockImplementation((cb: Function) => {
      cb(undefined, { 'IB0.1': 5 });
    });

    const result = await backend.readRawArea(0x81, 0, 0, 1);
    expect(result.readUInt8(0)).toBe(5);
  });

  it('readRawArea with Q area', async () => {
    mockReadAllItems.mockImplementation((cb: Function) => {
      cb(undefined, { 'QB0.1': 7 });
    });

    const result = await backend.readRawArea(0x82, 0, 0, 1);
    expect(result.readUInt8(0)).toBe(7);
  });

  it('readRawArea throws for unsupported area', async () => {
    await expect(backend.readRawArea(0x99, 0, 0, 1)).rejects.toThrow('Unsupported area code');
  });

  it('readRawArea handles array result', async () => {
    mockReadAllItems.mockImplementation((cb: Function) => {
      cb(undefined, { 'DB1,BYTE0.3': [1, 2, 3] });
    });

    const result = await backend.readRawArea(0x84, 1, 0, 3);
    expect(result).toEqual(Buffer.from([1, 2, 3]));
  });

  it('readRawArea handles unexpected value type', async () => {
    mockReadAllItems.mockImplementation((cb: Function) => {
      cb(undefined, { 'DB1,BYTE0.3': 'unexpected' });
    });

    await expect(backend.readRawArea(0x84, 1, 0, 3)).rejects.toThrow('Unexpected value type');
  });

  it('readRawArea handles read error', async () => {
    mockReadAllItems.mockImplementation((cb: Function) => {
      cb(new Error('Read timeout'));
    });

    await expect(backend.readRawArea(0x84, 1, 0, 1)).rejects.toThrow('Raw read failed');
  });

  it('readRawArea throws when not connected', async () => {
    await backend.disconnect();
    await expect(backend.readRawArea(0x84, 1, 0, 1)).rejects.toThrow('Not connected');
  });

  it('read marks null values as bad quality', async () => {
    mockReadAllItems.mockImplementation((cb: Function) => {
      cb(undefined, { 'DB1,REAL0': null });
    });

    const results = await backend.read([{
      name: 'test',
      address: { area: 'DB', dbNumber: 1, dataType: 'REAL', offset: 0, bitOffset: 0 },
      nodes7Address: 'DB1,REAL0',
    }]);

    expect(results[0].quality).toBe('bad');
    expect(results[0].value).toBeNull();
  });

  it('read generates nodes7Address from address when not provided', async () => {
    mockReadAllItems.mockImplementation((cb: Function) => {
      cb(undefined, { 'DB1,REAL0': 42.0 });
    });

    const results = await backend.read([{
      name: 'test',
      address: { area: 'DB', dbNumber: 1, dataType: 'REAL', offset: 0, bitOffset: 0 },
      // no nodes7Address
    }]);

    expect(results[0].value).toBe(42.0);
  });

  it('write generates nodes7Address from address when not provided', async () => {
    mockWriteItems.mockImplementation((_n: unknown, _v: unknown, cb: Function) => cb());

    await backend.write([{
      name: 'test',
      address: { area: 'DB', dbNumber: 1, dataType: 'REAL', offset: 0, bitOffset: 0 },
      value: 1.0,
    }]);

    expect(mockAddItems).toHaveBeenCalledWith('DB1,REAL0');
  });

  it('write throws when not connected', async () => {
    await backend.disconnect();
    await expect(backend.write([{
      name: 'test',
      address: { area: 'DB', dbNumber: 1, dataType: 'REAL', offset: 0, bitOffset: 0 },
      value: 1.0,
    }])).rejects.toThrow('Not connected');
  });

  it('connect passes timeout when configured', async () => {
    const backend2 = new NodeS7Backend();
    mockInitiateConnection.mockImplementation((params: Record<string, unknown>, cb: Function) => {
      expect(params.timeout).toBe(3000);
      cb();
    });

    await backend2.connect({
      host: '192.168.1.100', port: 102, rack: 0, slot: 1,
      plcType: 'S7-1200', backend: 'nodes7',
      connectionTimeout: 3000,
    });
  });
});
