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
      mockConnectTo.mockImplementation((_h: any, _r: any, _s: any, cb: Function) => cb());

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
      mockConnectTo.mockImplementation((_h: any, _r: any, _s: any, cb: Function) =>
        cb(new Error('No route to host')),
      );

      await expect(
        backend.connect({
          host: '192.168.1.100', port: 102, rack: 0, slot: 1,
          plcType: 'S7-1200', backend: 'snap7',
        }),
      ).rejects.toThrow('snap7 connection failed');
    });
  });

  describe('disconnect', () => {
    it('disconnects', async () => {
      mockConnectTo.mockImplementation((_h: any, _r: any, _s: any, cb: Function) => cb());
      await backend.connect({
        host: '192.168.1.100', port: 102, rack: 0, slot: 1,
        plcType: 'S7-1200', backend: 'snap7',
      });

      await backend.disconnect();
      expect(backend.isConnected()).toBe(false);
      expect(mockDisconnect).toHaveBeenCalled();
    });
  });

  describe('read', () => {
    beforeEach(async () => {
      mockConnectTo.mockImplementation((_h: any, _r: any, _s: any, cb: Function) => cb());
      await backend.connect({
        host: '192.168.1.100', port: 102, rack: 0, slot: 1,
        plcType: 'S7-1200', backend: 'snap7',
      });
    });

    it('reads REAL value', async () => {
      const buf = Buffer.alloc(4);
      buf.writeFloatBE(3.14);
      mockReadArea.mockImplementation(
        (_a: any, _d: any, _s: any, _l: any, _w: any, cb: Function) => cb(undefined, buf),
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
        (_a: any, _d: any, _s: any, _l: any, _w: any, cb: Function) =>
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
  });

  describe('write', () => {
    beforeEach(async () => {
      mockConnectTo.mockImplementation((_h: any, _r: any, _s: any, cb: Function) => cb());
      await backend.connect({
        host: '192.168.1.100', port: 102, rack: 0, slot: 1,
        plcType: 'S7-1200', backend: 'snap7',
      });
    });

    it('writes REAL value', async () => {
      mockWriteArea.mockImplementation(
        (_a: any, _d: any, _s: any, _l: any, _w: any, _b: any, cb: Function) => cb(),
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
        (_a: any, _d: any, _s: any, _l: any, _w: any, cb: Function) => cb(undefined, readBuf),
      );
      mockWriteArea.mockImplementation(
        (_a: any, _d: any, _s: any, _l: any, _w: any, _b: any, cb: Function) => cb(),
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
  });

  describe('browse', () => {
    beforeEach(async () => {
      mockConnectTo.mockImplementation((_h: any, _r: any, _s: any, cb: Function) => cb());
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
      mockListBlocksOfType.mockImplementation((_t: any, cb: Function) =>
        cb(undefined, [1, 2, 3]),
      );

      const result = await backend.listBlocksOfType('DB');
      expect(result).toEqual([1, 2, 3]);
    });

    it('gets block info', async () => {
      mockGetAgBlockInfo.mockImplementation((_t: any, _n: any, cb: Function) =>
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
      mockReadSZL.mockImplementation((_id: any, _idx: any, cb: Function) =>
        cb(undefined, szlBuf),
      );

      const result = await backend.readSZL(0x001c, 0);
      expect(result).toEqual(szlBuf);
    });
  });
});
