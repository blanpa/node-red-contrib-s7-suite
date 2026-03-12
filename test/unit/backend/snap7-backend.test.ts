import { Snap7Backend } from '../../../src/backend/snap7-backend';

// Mock node-snap7
const mockConnect = jest.fn();
const mockConnectTo = jest.fn();
const mockDisconnect = jest.fn();
const mockSetParam = jest.fn();
const mockSetConnectionParams = jest.fn();
const mockReadArea = jest.fn();
const mockWriteArea = jest.fn();
const mockListBlocks = jest.fn();
const mockListBlocksOfType = jest.fn();
const mockGetAgBlockInfo = jest.fn();
const mockReadSZL = jest.fn();

jest.mock('node-snap7', () => ({
  S7Client: jest.fn().mockImplementation(() => ({
    Connect: mockConnect,
    ConnectTo: mockConnectTo,
    Disconnect: mockDisconnect,
    SetParam: mockSetParam,
    SetConnectionParams: mockSetConnectionParams,
    ReadArea: mockReadArea,
    WriteArea: mockWriteArea,
    ListBlocks: mockListBlocks,
    ListBlocksOfType: mockListBlocksOfType,
    GetAgBlockInfo: mockGetAgBlockInfo,
    ReadSZL: mockReadSZL,
    PingTimeout: 5,
  })),
}));

describe('Snap7Backend', () => {
  let backend: Snap7Backend;

  beforeEach(() => {
    backend = new Snap7Backend();
    jest.clearAllMocks();
  });

  describe('connect', () => {
    it('connects with rack/slot', async () => {
      mockConnectTo.mockImplementation((_h: unknown, _r: unknown, _s: unknown, cb: Function) => cb());

      await backend.connect({
        host: '192.168.1.100',
        port: 102,
        rack: 0,
        slot: 1,
        plcType: 'S7-1200',
        backend: 'snap7',
      });

      expect(backend.isConnected()).toBe(true);
      expect(mockConnectTo).toHaveBeenCalledWith('192.168.1.100', 0, 1, expect.any(Function));
    });

    it('connects with TSAP', async () => {
      mockConnect.mockImplementation((cb: Function) => cb());

      await backend.connect({
        host: '192.168.1.100',
        port: 102,
        rack: 0,
        slot: 1,
        plcType: 'LOGO',
        backend: 'snap7',
        localTSAP: 0x0100,
        remoteTSAP: 0x0200,
      });

      expect(mockSetConnectionParams).toHaveBeenCalledWith('192.168.1.100', 0x0100, 0x0200);
      expect(mockConnect).toHaveBeenCalled();
    });

    it('handles connection failure', async () => {
      mockConnectTo.mockImplementation((_h: unknown, _r: unknown, _s: unknown, cb: Function) =>
        cb(new Error('No route to host')),
      );

      await expect(
        backend.connect({
          host: '192.168.1.100', port: 102, rack: 0, slot: 1,
          plcType: 'S7-1200', backend: 'snap7',
        }),
      ).rejects.toThrow('snap7 connection failed');
    });

    it('handles TSAP connection failure', async () => {
      mockConnect.mockImplementation((cb: Function) => cb(new Error('TSAP error')));

      await expect(
        backend.connect({
          host: '192.168.1.100', port: 102, rack: 0, slot: 1,
          plcType: 'LOGO', backend: 'snap7',
          localTSAP: 0x0100, remoteTSAP: 0x0200,
        }),
      ).rejects.toThrow('snap7 connection failed');
    });

    it('sets connectionTimeout when provided', async () => {
      mockConnectTo.mockImplementation((_h: unknown, _r: unknown, _s: unknown, cb: Function) => cb());

      await backend.connect({
        host: '192.168.1.100', port: 102, rack: 0, slot: 1,
        plcType: 'S7-1200', backend: 'snap7',
        connectionTimeout: 5000,
      });

      expect(mockSetParam).toHaveBeenCalledWith(5, 5000);
    });
  });

  describe('disconnect', () => {
    it('disconnects', async () => {
      mockConnectTo.mockImplementation((_h: unknown, _r: unknown, _s: unknown, cb: Function) => cb());
      await backend.connect({
        host: '192.168.1.100', port: 102, rack: 0, slot: 1,
        plcType: 'S7-1200', backend: 'snap7',
      });

      await backend.disconnect();
      expect(backend.isConnected()).toBe(false);
      expect(mockDisconnect).toHaveBeenCalled();
    });

    it('handles disconnect when not connected (no client)', async () => {
      // backend never connected, client is null
      await backend.disconnect();
      expect(mockDisconnect).not.toHaveBeenCalled();
    });

    it('handles disconnect error gracefully', async () => {
      mockConnectTo.mockImplementation((_h: unknown, _r: unknown, _s: unknown, cb: Function) => cb());
      await backend.connect({
        host: '192.168.1.100', port: 102, rack: 0, slot: 1,
        plcType: 'S7-1200', backend: 'snap7',
      });

      mockDisconnect.mockImplementation(() => { throw new Error('disconnect error'); });

      await backend.disconnect();
      expect(backend.isConnected()).toBe(false);
    });
  });

  describe('read', () => {
    beforeEach(async () => {
      mockConnectTo.mockImplementation((_h: unknown, _r: unknown, _s: unknown, cb: Function) => cb());
      await backend.connect({
        host: '192.168.1.100', port: 102, rack: 0, slot: 1,
        plcType: 'S7-1200', backend: 'snap7',
      });
    });

    it('reads REAL value', async () => {
      const buf = Buffer.alloc(4);
      buf.writeFloatBE(3.14);
      mockReadArea.mockImplementation(
        (_a: unknown, _d: unknown, _s: unknown, _l: unknown, _w: unknown, cb: Function) => cb(undefined, buf),
      );

      const results = await backend.read([
        {
          name: 'temp',
          address: { area: 'DB', dbNumber: 1, dataType: 'REAL', offset: 0, bitOffset: 0 },
        },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].value).toBeCloseTo(3.14);
      expect(results[0].quality).toBe('good');
    });

    it('handles read failure gracefully', async () => {
      mockReadArea.mockImplementation(
        (_a: unknown, _d: unknown, _s: unknown, _l: unknown, _w: unknown, cb: Function) =>
          cb(new Error('Read error')),
      );

      const results = await backend.read([
        {
          name: 'temp',
          address: { area: 'DB', dbNumber: 1, dataType: 'REAL', offset: 0, bitOffset: 0 },
        },
      ]);

      expect(results[0].quality).toBe('bad');
      expect(results[0].error).toBeDefined();
    });

    it('throws when not connected', async () => {
      const freshBackend = new Snap7Backend();
      await expect(
        freshBackend.read([
          { name: 'x', address: { area: 'DB', dbNumber: 1, dataType: 'REAL', offset: 0, bitOffset: 0 } },
        ]),
      ).rejects.toThrow('Not connected');
    });

    it('returns bad quality for unsupported area', async () => {
      const results = await backend.read([
        {
          name: 'invalid',
          address: { // eslint-disable-next-line @typescript-eslint/no-explicit-any
          area: 'X' as any, dbNumber: 0, dataType: 'INT', offset: 0, bitOffset: 0 },
        },
      ]);

      expect(results[0].quality).toBe('bad');
      expect(results[0].error).toContain('Unsupported area');
    });

    it('reads array values', async () => {
      // 3 INT values = 3 * 2 bytes = 6 bytes
      const buf = Buffer.alloc(6);
      buf.writeInt16BE(10, 0);
      buf.writeInt16BE(20, 2);
      buf.writeInt16BE(30, 4);
      mockReadArea.mockImplementation(
        (_a: unknown, _d: unknown, _s: unknown, _l: unknown, _w: unknown, cb: Function) => cb(undefined, buf),
      );

      const results = await backend.read([
        {
          name: 'arr',
          address: { area: 'DB', dbNumber: 1, dataType: 'INT', offset: 0, bitOffset: 0, arrayLength: 3 },
        },
      ]);

      expect(results[0].quality).toBe('good');
      expect(results[0].value).toEqual([10, 20, 30]);
    });

    it('reads from M area', async () => {
      const buf = Buffer.alloc(2);
      buf.writeInt16BE(42, 0);
      mockReadArea.mockImplementation(
        (_a: unknown, _d: unknown, _s: unknown, _l: unknown, _w: unknown, cb: Function) => cb(undefined, buf),
      );

      const results = await backend.read([
        {
          name: 'mw',
          address: { area: 'M', dbNumber: 0, dataType: 'INT', offset: 0, bitOffset: 0 },
        },
      ]);

      expect(results[0].quality).toBe('good');
      expect(results[0].value).toBe(42);
    });
  });

  describe('write', () => {
    beforeEach(async () => {
      mockConnectTo.mockImplementation((_h: unknown, _r: unknown, _s: unknown, cb: Function) => cb());
      await backend.connect({
        host: '192.168.1.100', port: 102, rack: 0, slot: 1,
        plcType: 'S7-1200', backend: 'snap7',
      });
    });

    it('writes REAL value', async () => {
      mockWriteArea.mockImplementation(
        (_a: unknown, _d: unknown, _s: unknown, _l: unknown, _w: unknown, _b: unknown, cb: Function) => cb(),
      );

      await backend.write([
        {
          name: 'temp',
          address: { area: 'DB', dbNumber: 1, dataType: 'REAL', offset: 0, bitOffset: 0 },
          value: 25.5,
        },
      ]);

      expect(mockWriteArea).toHaveBeenCalled();
    });

    it('writes BOOL with read-modify-write', async () => {
      const readBuf = Buffer.from([0x00]);
      mockReadArea.mockImplementation(
        (_a: unknown, _d: unknown, _s: unknown, _l: unknown, _w: unknown, cb: Function) => cb(undefined, readBuf),
      );
      mockWriteArea.mockImplementation(
        (_a: unknown, _d: unknown, _s: unknown, _l: unknown, _w: unknown, _b: unknown, cb: Function) => cb(),
      );

      await backend.write([
        {
          name: 'bit',
          address: { area: 'DB', dbNumber: 1, dataType: 'BOOL', offset: 0, bitOffset: 3 },
          value: true,
        },
      ]);

      expect(mockReadArea).toHaveBeenCalled();
      expect(mockWriteArea).toHaveBeenCalled();
    });

    it('throws when not connected', async () => {
      const freshBackend = new Snap7Backend();
      await expect(
        freshBackend.write([
          { name: 'x', address: { area: 'DB', dbNumber: 1, dataType: 'REAL', offset: 0, bitOffset: 0 }, value: 1 },
        ]),
      ).rejects.toThrow('Not connected');
    });

    it('throws for unsupported area', async () => {
      await expect(
        backend.write([
          { name: 'x', address: { // eslint-disable-next-line @typescript-eslint/no-explicit-any
          area: 'X' as any, dbNumber: 0, dataType: 'INT', offset: 0, bitOffset: 0 }, value: 1 },
        ]),
      ).rejects.toThrow('Unsupported area');
    });

    it('handles write error from WriteArea callback', async () => {
      mockWriteArea.mockImplementation(
        (_a: unknown, _d: unknown, _s: unknown, _l: unknown, _w: unknown, _b: unknown, cb: Function) =>
          cb(new Error('Write failed')),
      );

      await expect(
        backend.write([
          { name: 'x', address: { area: 'DB', dbNumber: 1, dataType: 'REAL', offset: 0, bitOffset: 0 }, value: 1.0 },
        ]),
      ).rejects.toThrow('snap7 write failed');
    });
  });

  describe('browse', () => {
    beforeEach(async () => {
      mockConnectTo.mockImplementation((_h: unknown, _r: unknown, _s: unknown, cb: Function) => cb());
      await backend.connect({
        host: '192.168.1.100', port: 102, rack: 0, slot: 1,
        plcType: 'S7-1200', backend: 'snap7',
      });
    });

    it('lists blocks', async () => {
      const blockList = {
        OBCount: 1, DBCount: 5, SDBCount: 0, FCCount: 2,
        SFCCount: 0, FBCount: 1, SFBCount: 0,
      };
      mockListBlocks.mockImplementation((cb: Function) => cb(undefined, blockList));

      const result = await backend.listBlocks();
      expect(result.DBCount).toBe(5);
    });

    it('lists blocks of type', async () => {
      mockListBlocksOfType.mockImplementation((_t: unknown, cb: Function) =>
        cb(undefined, [1, 2, 3]),
      );

      const result = await backend.listBlocksOfType('DB');
      expect(result).toEqual([1, 2, 3]);
    });

    it('gets block info', async () => {
      mockGetAgBlockInfo.mockImplementation((_t: unknown, _n: unknown, cb: Function) =>
        cb(undefined, {
          MC7Size: 100,
          Author: 'TEST',
          Family: 'FAM',
        }),
      );

      const result = await backend.getBlockInfo('DB', 1);
      expect(result.sizeData).toBe(100);
      expect(result.author).toBe('TEST');
    });

    it('reads SZL', async () => {
      const szlBuf = Buffer.from([0x01, 0x02]);
      mockReadSZL.mockImplementation((_id: unknown, _idx: unknown, cb: Function) =>
        cb(undefined, szlBuf),
      );

      const result = await backend.readSZL(0x001c, 0);
      expect(result).toEqual(szlBuf);
    });

    it('handles listBlocks error', async () => {
      mockListBlocks.mockImplementation((cb: Function) =>
        cb(new Error('ListBlocks error')),
      );

      await expect(backend.listBlocks()).rejects.toThrow('ListBlocks failed');
    });

    it('handles listBlocksOfType error', async () => {
      mockListBlocksOfType.mockImplementation((_t: unknown, cb: Function) =>
        cb(new Error('ListBlocksOfType error')),
      );

      await expect(backend.listBlocksOfType('DB')).rejects.toThrow('ListBlocksOfType failed');
    });

    it('handles getBlockInfo error', async () => {
      mockGetAgBlockInfo.mockImplementation((_t: unknown, _n: unknown, cb: Function) =>
        cb(new Error('GetBlockInfo error')),
      );

      await expect(backend.getBlockInfo('DB', 1)).rejects.toThrow('GetBlockInfo failed');
    });

    it('gets block info with version', async () => {
      mockGetAgBlockInfo.mockImplementation((_t: unknown, _n: unknown, cb: Function) =>
        cb(undefined, {
          MC7Size: 200,
          Author: 'AUTH',
          Family: 'FAM',
          Header: 'HDR',
          Version: 0x31, // version 3.1
          CodeDate: '2024-01-01',
        }),
      );

      const result = await backend.getBlockInfo('DB', 2);
      expect(result.sizeData).toBe(200);
      expect(result.version).toBe('3.1');
      expect(result.name).toBe('HDR');
      expect(result.date).toBe('2024-01-01');
    });

    it('gets block info with SizeData fallback', async () => {
      mockGetAgBlockInfo.mockImplementation((_t: unknown, _n: unknown, cb: Function) =>
        cb(undefined, {
          SizeData: 150,
          Author: 'A',
          Family: 'F',
        }),
      );

      const result = await backend.getBlockInfo('FC', 1);
      expect(result.sizeData).toBe(150);
      expect(result.blockType).toBe('FC');
    });

    it('handles readSZL error', async () => {
      mockReadSZL.mockImplementation((_id: unknown, _idx: unknown, cb: Function) =>
        cb(new Error('ReadSZL error')),
      );

      await expect(backend.readSZL(0x001c, 0)).rejects.toThrow('ReadSZL failed');
    });

    it('throws when listBlocks called while disconnected', async () => {
      const freshBackend = new Snap7Backend();
      await expect(freshBackend.listBlocks()).rejects.toThrow('Not connected');
    });

    it('throws when listBlocksOfType called while disconnected', async () => {
      const freshBackend = new Snap7Backend();
      await expect(freshBackend.listBlocksOfType('DB')).rejects.toThrow('Not connected');
    });

    it('throws when getBlockInfo called while disconnected', async () => {
      const freshBackend = new Snap7Backend();
      await expect(freshBackend.getBlockInfo('DB', 1)).rejects.toThrow('Not connected');
    });

    it('throws when readSZL called while disconnected', async () => {
      const freshBackend = new Snap7Backend();
      await expect(freshBackend.readSZL(0x001c, 0)).rejects.toThrow('Not connected');
    });
  });

  describe('readRawArea', () => {
    it('throws when not connected', async () => {
      const freshBackend = new Snap7Backend();
      await expect(freshBackend.readRawArea(0x84, 1, 0, 4)).rejects.toThrow('Not connected');
    });

    it('handles ReadArea error callback', async () => {
      mockConnectTo.mockImplementation((_h: unknown, _r: unknown, _s: unknown, cb: Function) => cb());
      await backend.connect({
        host: '192.168.1.100', port: 102, rack: 0, slot: 1,
        plcType: 'S7-1200', backend: 'snap7',
      });

      mockReadArea.mockImplementation(
        (_a: unknown, _d: unknown, _s: unknown, _l: unknown, _w: unknown, cb: Function) =>
          cb(new Error('Area read error')),
      );

      await expect(backend.readRawArea(0x84, 1, 0, 4)).rejects.toThrow('snap7 read failed');
    });
  });
});
