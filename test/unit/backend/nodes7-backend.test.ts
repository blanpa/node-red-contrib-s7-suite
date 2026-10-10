import { NodeS7Backend } from '../../../src/backend/nodes7-backend';
import { ConnectionManager } from '../../../src/core/connection-manager';

// Mock nodes7 module
const mockInitiateConnection = jest.fn();
const mockDropConnection = jest.fn();
const mockAddItems = jest.fn();
const mockRemoveItems = jest.fn();
const mockReadAllItems = jest.fn();
const mockWriteItems = jest.fn();
// nodes7's isoConnectionState: 4 = link up, lower = down/reconnecting
const mockIso = { state: 4 };

jest.mock('nodes7', () => {
  return jest.fn().mockImplementation(() => ({
    get isoConnectionState() { return mockIso.state; },
    initiateConnection: mockInitiateConnection,
    dropConnection: mockDropConnection,
    addItems: mockAddItems,
    removeItems: mockRemoveItems,
    readAllItems: mockReadAllItems,
    writeItems: mockWriteItems,
  }));
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockNodes7 = require('nodes7') as jest.Mock;

describe('NodeS7Backend', () => {
  let backend: NodeS7Backend;

  beforeEach(() => {
    backend = new NodeS7Backend();
    jest.clearAllMocks();
    mockIso.state = 4;
  });

  describe('connect', () => {
    it('connects successfully', async () => {
      mockInitiateConnection.mockImplementation((_params: unknown, cb: Function) => cb());

      await backend.connect({
        host: '192.168.1.100',
        port: 102,
        rack: 0,
        slot: 1,
        plcType: 'S7-1200',
        backend: 'nodes7',
      });

      expect(backend.isConnected()).toBe(true);
      expect(mockInitiateConnection).toHaveBeenCalledTimes(1);
    });

    it('handles connection error', async () => {
      mockInitiateConnection.mockImplementation((_params: unknown, cb: Function) =>
        cb(new Error('Connection refused')),
      );

      await expect(
        backend.connect({
          host: '192.168.1.100',
          port: 102,
          rack: 0,
          slot: 1,
          plcType: 'S7-1200',
          backend: 'nodes7',
        }),
      ).rejects.toThrow('nodes7 connection failed');
    });

    it('includes a string connect error from nodes7 in the message', async () => {
      mockInitiateConnection.mockImplementation((_params: unknown, cb: Function) =>
        cb("Error - TCP connected, ISO didn't"),
      );

      await expect(
        backend.connect({
          host: '192.168.1.100', port: 102, rack: 0, slot: 1, plcType: 'S7-1200', backend: 'nodes7',
        }),
      ).rejects.toThrow("nodes7 connection failed: Error - TCP connected, ISO didn't");
    });

    it('constructs nodes7 in silent mode by default (no verbose protocol logging)', async () => {
      mockInitiateConnection.mockImplementation((_params: unknown, cb: Function) => cb());

      await backend.connect({
        host: '192.168.1.100', port: 102, rack: 0, slot: 1, plcType: 'S7-1200', backend: 'nodes7',
      });

      expect(mockNodes7).toHaveBeenCalledWith({ silent: true });
    });

    it('enables verbose logging when debug is true', async () => {
      mockInitiateConnection.mockImplementation((_params: unknown, cb: Function) => cb());

      await backend.connect({
        host: '192.168.1.100', port: 102, rack: 0, slot: 1, plcType: 'S7-1200', backend: 'nodes7',
        debug: true,
      });

      expect(mockNodes7).toHaveBeenCalledWith({ silent: false });
    });

    it('passes TSAP params', async () => {
      mockInitiateConnection.mockImplementation((params: Record<string, unknown>, cb: Function) => {
        expect(params.localTSAP).toBe(0x0100);
        expect(params.remoteTSAP).toBe(0x0200);
        cb();
      });

      await backend.connect({
        host: '192.168.1.100',
        port: 102,
        rack: 0,
        slot: 1,
        plcType: 'LOGO',
        backend: 'nodes7',
        localTSAP: 0x0100,
        remoteTSAP: 0x0200,
      });
    });
  });

  describe('connection loss', () => {
    const cfg = {
      host: '192.168.1.100', port: 102, rack: 0, slot: 1, plcType: 'S7-1200' as const, backend: 'nodes7' as const,
    };
    const item = {
      name: 'temp',
      address: { area: 'DB' as const, dbNumber: 1, dataType: 'REAL' as const, offset: 0, bitOffset: 0 },
      nodes7Address: 'DB1,REAL0',
    };

    beforeEach(async () => {
      mockInitiateConnection.mockImplementation((_p: unknown, cb: Function) => cb());
      await backend.connect(cfg);
    });

    it('reports not connected as soon as nodes7 drops isoConnectionState', () => {
      expect(backend.isConnected()).toBe(true);
      mockIso.state = 0; // socket closed by the PLC
      expect(backend.isConnected()).toBe(false);
    });

    it('rejects a read with DISCONNECTED when the link fails during the read', async () => {
      mockReadAllItems.mockImplementation((cb: Function) => {
        mockIso.state = 1; // nodes7 is retrying
        cb(true, { 'DB1,REAL0': 'BAD 255' });
      });

      await expect(backend.read([item])).rejects.toMatchObject({
        code: 'DISCONNECTED',
        message: 'nodes7 read failed: connection to the PLC was lost',
      });
    });

    it('still reports a bad address as READ_FAILED while the link is up', async () => {
      mockReadAllItems.mockImplementation((cb: Function) => cb(true, { 'DB1,REAL0': 'BAD 255' }));

      await expect(backend.read([item])).rejects.toMatchObject({ code: 'READ_FAILED' });
    });

    it('fails fast without asking nodes7 when the link is already down', async () => {
      mockIso.state = 0;

      await expect(backend.write([{ ...item, value: 1 }])).rejects.toMatchObject({ code: 'DISCONNECTED' });
      await expect(backend.readRawArea(0x84, 1, 0, 4)).rejects.toMatchObject({ code: 'DISCONNECTED' });
      expect(mockWriteItems).not.toHaveBeenCalled();
      expect(mockReadAllItems).not.toHaveBeenCalled();
    });

    it('drops the previous nodes7 connection when reconnecting', async () => {
      await backend.connect(cfg);

      expect(mockDropConnection).toHaveBeenCalledTimes(1);
      expect(mockNodes7).toHaveBeenCalledTimes(2);
    });

    // A stalled link: the connection manager times the request out and disconnects, then
    // nodes7's own packet timeout calls back on the connection that has been dropped
    describe('an answer that arrives after disconnect', () => {
      // Not DISCONNECTED: the connection manager dropped that connection itself, and a
      // connection-class code would make it tear down the one that replaced it
      const closed = (op: string) => ({
        code: op === 'write' ? 'WRITE_FAILED' : 'READ_FAILED',
        message: `nodes7 ${op} failed: the connection was closed before the PLC answered`,
      });
      const later = (mock: jest.Mock) => {
        const pending: { cb?: Function } = {};
        mock.mockImplementation((...args: unknown[]) => { pending.cb = args[args.length - 1] as Function; });
        return pending;
      };

      it('does not throw for a failed read, and reports it without a connection error code', async () => {
        const pending = later(mockReadAllItems);
        const reading = backend.read([item]);
        await backend.disconnect();
        expect(() => pending.cb!(true, { 'DB1,REAL0': 'BAD 255' })).not.toThrow();
        await expect(reading).rejects.toMatchObject(closed('read'));
        expect(mockRemoveItems).toHaveBeenCalledWith('DB1,REAL0');
      });

      it('does not throw for a failed write, and reports it without a connection error code', async () => {
        const pending = later(mockWriteItems);
        const writing = backend.write([{ ...item, value: 1.5 }]);
        await backend.disconnect();
        expect(() => pending.cb!(true)).not.toThrow();
        await expect(writing).rejects.toMatchObject(closed('write'));
      });

      it('does not throw for a failed raw read', async () => {
        const pending = later(mockReadAllItems);
        const reading = backend.readRawArea(0x84, 1, 0, 4);
        await backend.disconnect();
        expect(() => pending.cb!(true, { 'DB1,BYTE0.4': 'BAD 255' })).not.toThrow();
        await expect(reading).rejects.toMatchObject(closed('read'));
      });

      it('counts a write the PLC acknowledged as done, so a retry cannot write it twice', async () => {
        const pending = later(mockWriteItems);
        const writing = backend.write([{ ...item, value: 1.5 }]);
        await backend.disconnect();
        pending.cb!(false);
        await expect(writing).resolves.toBeUndefined();
      });

      it('returns the values of a read the PLC answered', async () => {
        const pending = later(mockReadAllItems);
        const reading = backend.readRawArea(0x84, 1, 0, 4);
        await backend.disconnect();
        pending.cb!(false, { 'DB1,BYTE0.4': [1, 2, 3, 4] });
        await expect(reading).resolves.toEqual(Buffer.from([1, 2, 3, 4]));
      });

      it('does not make the connection manager drop the connection a reconnect just made', async () => {
        const cm = new ConnectionManager(backend, { ...cfg, requestTimeout: 60000, healthCheckInterval: 0 });
        await cm.connect();
        const pending = later(mockReadAllItems);
        const reading = cm.read([item]);
        await new Promise((resolve) => setImmediate(resolve));
        await cm.reconnect();
        expect(cm.getState()).toBe('connected');
        // The old connection's read fails late, after the new connection is up
        pending.cb!(true, { 'DB1,REAL0': 'BAD 255' });
        await expect(reading).rejects.toMatchObject(closed('read'));
        expect(cm.getState()).toBe('connected');
        await cm.disconnect();
      });

      it('does not report a connection error for the connection that replaced it', async () => {
        const pending = later(mockReadAllItems);
        const reading = backend.read([item]);
        await backend.connect(cfg);
        mockIso.state = 4;
        pending.cb!(true, { 'DB1,REAL0': 'BAD 255' });
        await expect(reading).rejects.toMatchObject(closed('read'));
        expect(backend.isConnected()).toBe(true);
      });
    });

    it('refuses a string write when the link drops while its header is read', async () => {
      const str = {
        name: 's',
        address: { area: 'DB' as const, dbNumber: 1, dataType: 'STRING' as const, offset: 0, bitOffset: 0, stringLength: 10 },
        nodes7Address: 'DB1,STRING0.10',
        value: 'hi',
      };
      mockReadAllItems.mockImplementation((cb: Function) => {
        cb(false, { 'DB1,BYTE0.2': [10, 0] });
        void backend.disconnect();
      });

      await expect(backend.write([str])).rejects.toMatchObject({ code: 'DISCONNECTED', message: 'Not connected' });
      expect(mockWriteItems).not.toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('disconnects cleanly', async () => {
      mockInitiateConnection.mockImplementation((_p: unknown, cb: Function) => cb());
      await backend.connect({
        host: '192.168.1.100', port: 102, rack: 0, slot: 1, plcType: 'S7-1200', backend: 'nodes7',
      });

      await backend.disconnect();
      expect(backend.isConnected()).toBe(false);
      expect(mockDropConnection).toHaveBeenCalled();
    });
  });

  describe('read', () => {
    beforeEach(async () => {
      mockInitiateConnection.mockImplementation((_p: unknown, cb: Function) => cb());
      await backend.connect({
        host: '192.168.1.100', port: 102, rack: 0, slot: 1, plcType: 'S7-1200', backend: 'nodes7',
      });
    });

    it('reads values successfully', async () => {
      mockReadAllItems.mockImplementation((cb: Function) => {
        cb(undefined, { 'DB1,REAL0': 3.14 });
      });

      const results = await backend.read([
        {
          name: 'temp',
          address: { area: 'DB', dbNumber: 1, dataType: 'REAL', offset: 0, bitOffset: 0 },
          nodes7Address: 'DB1,REAL0',
        },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].value).toBe(3.14);
      expect(results[0].quality).toBe('good');
    });

    it('handles read error', async () => {
      mockReadAllItems.mockImplementation((cb: Function) => {
        cb(new Error('Read timeout'));
      });

      await expect(
        backend.read([
          {
            name: 'temp',
            address: { area: 'DB', dbNumber: 1, dataType: 'REAL', offset: 0, bitOffset: 0 },
            nodes7Address: 'DB1,REAL0',
          },
        ]),
      ).rejects.toThrow('nodes7 read failed');
    });

    it('names the addresses nodes7 marked bad (it passes true, not an Error)', async () => {
      mockReadAllItems.mockImplementation((cb: Function) => {
        cb(true, { 'DB1,REAL0': 'BAD 255', 'DB6,REAL0': 'BAD 255', 'DB1,BYTE0.4': ['BAD 255', 'BAD 255'] });
      });

      const read = backend.read(
        ['DB1,REAL0', 'DB6,REAL0', 'DB1,BYTE0.4'].map((a) => ({
          name: a,
          address: { area: 'DB' as const, dbNumber: 1, dataType: 'REAL' as const, offset: 0, bitOffset: 0 },
          nodes7Address: a,
        })),
      );

      await expect(read).rejects.toThrow(
        'nodes7 read failed: bad quality for DB1,REAL0, DB6,REAL0, DB1,BYTE0.4 (check that the address exists',
      );
    });

    it('does not mistake a good string value for a bad quality', async () => {
      mockReadAllItems.mockImplementation((cb: Function) => {
        cb(true, { 'DB1,STRING0.10': 'BAD BATCH', 'DB6,REAL0': 'BAD 10' });
      });

      const results = await backend.read(['DB1,STRING0.10', 'DB6,REAL0'].map((a) => ({
        name: a,
        address: { area: 'DB' as const, dbNumber: 1, dataType: 'STRING' as const, offset: 0, bitOffset: 0 },
        nodes7Address: a,
      })));

      expect(results[0]).toMatchObject({ value: 'BAD BATCH', quality: 'good' });
      expect(results[1]).toMatchObject({ value: null, quality: 'bad' });
    });

    it('still returns the good values when one address in the read is bad', async () => {
      mockReadAllItems.mockImplementation((cb: Function) => {
        cb(true, { 'DB1,INT0': 11, 'DB1,REAL200': 'BAD 255', 'DB1,BYTE0.2': ['BAD 255', 'BAD 255'] });
      });

      const results = await backend.read(['DB1,INT0', 'DB1,REAL200', 'DB1,BYTE0.2'].map((a) => ({
        name: a,
        address: { area: 'DB' as const, dbNumber: 1, dataType: 'INT' as const, offset: 0, bitOffset: 0 },
        nodes7Address: a,
      })));

      expect(results[0]).toMatchObject({ value: 11, quality: 'good', error: undefined });
      expect(results[1]).toMatchObject({ value: null, quality: 'bad' });
      expect(results[1].error).toContain('bad quality for DB1,REAL200 (check that the address exists');
      expect(results[2]).toMatchObject({ value: null, quality: 'bad' });
    });

    it('throws when not connected', async () => {
      await backend.disconnect();
      await expect(
        backend.read([
          {
            name: 'temp',
            address: { area: 'DB', dbNumber: 1, dataType: 'REAL', offset: 0, bitOffset: 0 },
          },
        ]),
      ).rejects.toThrow('Not connected');
    });
  });

  describe('write', () => {
    beforeEach(async () => {
      mockInitiateConnection.mockImplementation((_p: unknown, cb: Function) => cb());
      await backend.connect({
        host: '192.168.1.100', port: 102, rack: 0, slot: 1, plcType: 'S7-1200', backend: 'nodes7',
      });
    });

    it('writes values successfully', async () => {
      mockWriteItems.mockImplementation((_names: unknown, _values: unknown, cb: Function) => {
        cb();
      });

      await backend.write([
        {
          name: 'temp',
          address: { area: 'DB', dbNumber: 1, dataType: 'REAL', offset: 0, bitOffset: 0 },
          nodes7Address: 'DB1,REAL0',
          value: 25.5,
        },
      ]);

      expect(mockWriteItems).toHaveBeenCalled();
    });

    it('handles write error', async () => {
      mockWriteItems.mockImplementation((_n: unknown, _v: unknown, cb: Function) => {
        cb(new Error('Write failed'));
      });

      await expect(
        backend.write([
          {
            name: 'temp',
            address: { area: 'DB', dbNumber: 1, dataType: 'REAL', offset: 0, bitOffset: 0 },
            nodes7Address: 'DB1,REAL0',
            value: 25.5,
          },
        ]),
      ).rejects.toThrow('nodes7 write failed');
    });

    it('names the written addresses when nodes7 reports bad quality', async () => {
      mockWriteItems.mockImplementation((_n: unknown, _v: unknown, cb: Function) => cb(true));

      await expect(
        backend.write([
          {
            name: 'a',
            address: { area: 'DB', dbNumber: 6, dataType: 'INT', offset: 0, bitOffset: 0 },
            nodes7Address: 'DB6,INT0',
            value: 1,
          },
          {
            name: 'b',
            address: { area: 'DB', dbNumber: 6, dataType: 'INT', offset: 2, bitOffset: 0 },
            nodes7Address: 'DB6,INT2',
            value: 2,
          },
        ]),
      ).rejects.toThrow('nodes7 write failed: bad quality for DB6,INT0, DB6,INT2 (');
    });

    it('refuses an array of the wrong length instead of letting nodes7 pad it', async () => {
      const address = { area: 'DB' as const, dbNumber: 1, dataType: 'BYTE' as const, offset: 10, bitOffset: 0, arrayLength: 4 };
      await expect(backend.write([{ name: 'a', address, nodes7Address: 'DB1,BYTE10.4', value: [1, 2] }]))
        .rejects.toThrow('needs 4 values; got 2');
      expect(mockWriteItems).not.toHaveBeenCalled();

      mockWriteItems.mockImplementation((_n: unknown, _v: unknown, cb: Function) => cb());
      await backend.write([{ name: 'a', address, nodes7Address: 'DB1,BYTE10.4', value: Buffer.from([1, 2, 3, 4]) }]);
      expect(mockWriteItems.mock.calls[0][1]).toEqual([[1, 2, 3, 4]]);
    });

    // readAllItems answers the header read for whichever BYTE item was added
    const headerIs = (header: number[]): void => {
      mockReadAllItems.mockImplementation((cb: Function) => {
        const addr = mockAddItems.mock.calls[mockAddItems.mock.calls.length - 1][0];
        cb(undefined, { [addr]: header });
      });
    };

    it('writes a STRING as bytes, without touching its max length or anything after it', async () => {
      headerIs([20, 0]);
      mockWriteItems.mockImplementation((_n: unknown, _v: unknown, cb: Function) => cb());

      await backend.write([
        {
          name: 's',
          address: { area: 'DB', dbNumber: 1, dataType: 'STRING', offset: 50, bitOffset: 0, stringLength: 20 },
          nodes7Address: 'DB1,STRING50.20',
          value: 'hi',
        },
      ]);

      expect(mockAddItems).toHaveBeenCalledWith('DB1,BYTE50.2'); // the header read
      expect(mockWriteItems).toHaveBeenCalledWith(['DB1,BYTE51.3'], [[2, 0x68, 0x69]], expect.any(Function));
    });

    it('writes a WSTRING as bytes', async () => {
      headerIs([0, 10, 0, 0]);
      mockWriteItems.mockImplementation((_n: unknown, _v: unknown, cb: Function) => cb());

      await backend.write([
        { name: 'w', address: { area: 'DB', dbNumber: 1, dataType: 'WSTRING', offset: 10, bitOffset: 0 }, value: 'A' },
      ]);

      expect(mockAddItems).toHaveBeenCalledWith('DB1,BYTE10.4');
      expect(mockWriteItems).toHaveBeenCalledWith(['DB1,BYTE12.4'], [[0, 1, 0, 0x41]], expect.any(Function));
    });

    it('writes an empty STRING as a single BYTE', async () => {
      headerIs([20, 5]);
      mockWriteItems.mockImplementation((_n: unknown, _v: unknown, cb: Function) => cb());

      await backend.write([
        { name: 's', address: { area: 'DB', dbNumber: 1, dataType: 'STRING', offset: 0, bitOffset: 0 }, value: '' },
      ]);

      expect(mockWriteItems).toHaveBeenCalledWith(['DB1,BYTE1'], [0], expect.any(Function));
    });

    it('refuses a STRING longer than its max length without writing', async () => {
      headerIs([5, 0]);

      await expect(
        backend.write([
          { name: 's', address: { area: 'DB', dbNumber: 1, dataType: 'STRING', offset: 0, bitOffset: 0 }, value: 'too long' },
        ]),
      ).rejects.toThrow('STRING at DB1 offset 0 holds 5 characters; the value has 8');
      expect(mockWriteItems).not.toHaveBeenCalled();
    });
  });

  describe('browse methods', () => {
    it('listBlocks throws (not supported)', async () => {
      await expect(backend.listBlocks()).rejects.toThrow('nodes7 does not support');
    });

    it('listBlocksOfType throws', async () => {
      await expect(backend.listBlocksOfType('DB')).rejects.toThrow('nodes7 does not support');
    });

    it('getBlockInfo throws', async () => {
      await expect(backend.getBlockInfo('DB', 1)).rejects.toThrow('nodes7 does not support');
    });

    it('readSZL throws', async () => {
      await expect(backend.readSZL(0, 0)).rejects.toThrow('nodes7 does not support');
    });
  });
});
