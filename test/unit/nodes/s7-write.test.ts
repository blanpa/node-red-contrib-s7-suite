import { EventEmitter } from 'events';
import { ConnectionManager } from '../../../src/core/connection-manager';
import { MockBackend } from '../../helpers/mock-backend';

import s7WriteModule = require('../../../src/nodes/s7-write/s7-write');

describe('s7-write node', () => {
  let registeredType: string;
  let constructorFn: Function;
  let mockBackend: MockBackend;
  let connManager: ConnectionManager;

  const mockRED = {
    nodes: {
      createNode: jest.fn(),
      registerType: jest.fn((type: string, constructor: Function) => {
        registeredType = type;
        constructorFn = constructor;
      }),
      getNode: jest.fn(),
    },
    util: {
      // msg and env, as Node-RED's evaluateNodeProperty resolves them
      evaluateNodeProperty: jest.fn((value: string, type: string, _n: unknown, msg: Record<string, unknown>, cb: Function) => {
        if (type === 'msg') cb(null, value.split('.').reduce((o: unknown, k) => (o as Record<string, unknown>)?.[k], msg));
        else if (type === 'env') cb(null, process.env[value]);
        else cb(new Error(`unsupported type ${type}`));
      }),
    },
  };
  function createServerNode() {
    mockBackend = new MockBackend();
    connManager = new ConnectionManager(mockBackend, {
      host: '192.168.1.100', port: 102, rack: 0, slot: 1,
      plcType: 'S7-1200', backend: 'nodes7',
    });
    return { name: 'PLC 1', connectionManager: connManager, registerChildNode: jest.fn(), deregisterChildNode: jest.fn() };
  }

  // The input message passed on, with msg.s7 for a write
  const written = (msg: object, details: Record<string, unknown>) => ({
    ...msg,
    s7: { op: 'write', server: 'PLC 1', ...details, timestamp: expect.any(Number), durationMs: expect.any(Number) },
  });

  function createNodeContext() {
    return Object.assign(new EventEmitter(), {
      status: jest.fn(),
      send: jest.fn(),
      error: jest.fn(),
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    s7WriteModule(mockRED as any);
  });

  it('registers the s7-write type', () => {
    expect(registeredType).toBe('s7-write');
  });

  describe('missing server config', () => {
    it('sets error status when server node is missing', () => {
      mockRED.nodes.getNode.mockReturnValue(null);
      const node = createNodeContext();

      constructorFn.call(node, {
        id: 'write1',
        type: 's7-write',
        server: 'missing-config',
        address: 'DB1,REAL0',
      });

      expect(node.status).toHaveBeenCalledWith({
        fill: 'red', shape: 'ring', text: 'no config',
      });
    });

    it('does not register input handler when server is missing', () => {
      mockRED.nodes.getNode.mockReturnValue(null);
      const node = createNodeContext();
      const onSpy = jest.spyOn(node, 'on');

      constructorFn.call(node, {
        id: 'write1',
        type: 's7-write',
        server: 'missing-config',
        address: 'DB1,REAL0',
      });

      const inputListeners = onSpy.mock.calls.filter(c => c[0] === 'input');
      expect(inputListeners).toHaveLength(0);
    });
  });

  describe('with valid server config', () => {
    let serverNode: ReturnType<typeof createServerNode>;

    beforeEach(async () => {
      serverNode = createServerNode();
      mockRED.nodes.getNode.mockReturnValue(serverNode);
      await connManager.connect();
    });

    afterEach(async () => {
      await connManager.disconnect();
    });

    it('updates status based on connection state', () => {
      const node = createNodeContext();

      constructorFn.call(node, {
        id: 'write1',
        type: 's7-write',
        server: 'config1',
        address: 'DB1,REAL0',
      });

      expect(node.status).toHaveBeenCalledWith({
        fill: 'green', shape: 'dot', text: 'connected',
      });
    });

    it('writes a value and passes through the message', async () => {
      const node = createNodeContext();
      constructorFn.call(node, {
        id: 'write1',
        type: 's7-write',
        server: 'config1',
        address: 'DB1,REAL0',
      });

      const msg = { _msgid: '123', payload: 42.5 };
      const send = jest.fn();
      const done = jest.fn();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inputHandler = (node as any).listeners('input')[0];
      await inputHandler(msg, send, done);

      expect(mockBackend.writeCalls).toHaveLength(1);
      expect(mockBackend.writeCalls[0][0].value).toBe(42.5);
      expect(send).toHaveBeenCalledWith(written(msg, { source: 'config', address: 'DB1,REAL0' }));
      expect(done).toHaveBeenCalledWith();
    });

    it('passes an array or Buffer on to an address with a length', async () => {
      for (const payload of [[1, 2, 3, 4], Buffer.from([1, 2, 3, 4])]) {
        const node = createNodeContext();
        constructorFn.call(node, { id: 'write1', type: 's7-write', server: 'config1', address: 'DB1,BYTE10.4' });
        const done = jest.fn();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (node as any).listeners('input')[0]({ _msgid: '1', payload }, jest.fn(), done);
        expect(done).toHaveBeenCalledWith();
        expect(mockBackend.writeCalls[mockBackend.writeCalls.length - 1][0].value).toBe(payload);
      }
    });

    it('refuses an array for an address without a length', async () => {
      const node = createNodeContext();
      constructorFn.call(node, { id: 'write1', type: 's7-write', server: 'config1', address: 'DB1,BYTE10' });
      const done = jest.fn();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (node as any).listeners('input')[0]({ _msgid: '1', payload: [1, 2] }, jest.fn(), done);
      expect(done.mock.calls[0][0].message).toBe(
        'An array or Buffer needs an address with a length, e.g. DB1,BYTE0.4 (got DB1,BYTE10)',
      );
      expect(mockBackend.writeCalls).toHaveLength(0);
    });

    it('msg.action disconnects instead of writing when Dynamic control is on', async () => {
      Object.assign(serverNode, { allowDynamic: true, configError: null, getStatus: () => connManager.getStatus() });
      const node = createNodeContext();
      constructorFn.call(node, { id: 'write1', type: 's7-write', server: 'config1', address: 'DB1,REAL0' });
      const send = jest.fn();
      const done = jest.fn();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (node as any).listeners('input')[0]({ _msgid: '1', action: 'disconnect', payload: 1.5 }, send, done);
      expect(connManager.getState()).toBe('disconnected');
      expect(mockBackend.writeCalls).toHaveLength(0);
      // Nothing is sent on, so a reply can't reach the next S7 node as an ordinary message
      expect(send).not.toHaveBeenCalled();
      expect(done).toHaveBeenCalledWith();
    });

    it('ignores msg.topic and msg.mode: the configured address and mode are used', async () => {
      const node = createNodeContext();
      constructorFn.call(node, { id: 'write1', type: 's7-write', server: 'config1', address: 'DB1,REAL0' });

      const msg = { _msgid: '123', payload: 10, topic: 'DB1,INT0', mode: 'multi' };
      const done = jest.fn();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (node as any).listeners('input')[0](msg, jest.fn(), done);

      expect(mockBackend.writeCalls[0][0].address).toMatchObject({ dataType: 'REAL', offset: 0 });
      expect(done).toHaveBeenCalledWith();
    });

    it('takes the address from a msg property or env var when told to', async () => {
      process.env.S7_TEST_ADDRESS = 'DB1,DINT8';
      for (const [addressType, address, msg] of [
        ['msg', 'topic', { _msgid: '1', payload: 10, topic: 'DB1,INT0' }],
        ['env', 'S7_TEST_ADDRESS', { _msgid: '2', payload: 10 }],
      ] as const) {
        const node = createNodeContext();
        constructorFn.call(node, { id: 'write1', type: 's7-write', server: 'config1', address, addressType });
        const done = jest.fn();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (node as any).listeners('input')[0](msg, jest.fn(), done);
        expect(done).toHaveBeenCalledWith();
      }
      expect(mockBackend.writeCalls.map((c: Array<{ address: { dataType: string } }>) => c[0].address.dataType))
        .toEqual(['INT', 'DINT']);
      delete process.env.S7_TEST_ADDRESS;
    });

    it('says in msg.s7 which address it wrote and where that came from', async () => {
      process.env.S7_TEST_ADDRESS = 'DB1,DINT8';
      for (const [addressType, address, msg, expected] of [
        ['msg', 'topic', { _msgid: '1', payload: 10, topic: 'DB1,INT0' }, { source: 'msg.topic', address: 'DB1,INT0' }],
        ['env', 'S7_TEST_ADDRESS', { _msgid: '2', payload: 10 }, { source: 'env.S7_TEST_ADDRESS', address: 'DB1,DINT8' }],
      ] as const) {
        const node = createNodeContext();
        constructorFn.call(node, { id: 'write1', type: 's7-write', server: 'config1', address, addressType });
        const send = jest.fn();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (node as any).listeners('input')[0](msg, send, jest.fn());
        expect(send).toHaveBeenCalledWith(written(msg, expected));
      }
      delete process.env.S7_TEST_ADDRESS;
    });

    it('replaces a msg.s7 that came in with the message', async () => {
      const node = createNodeContext();
      constructorFn.call(node, { id: 'write1', type: 's7-write', server: 'config1', address: 'DB1,REAL0' });
      const send = jest.fn();
      const msg = { _msgid: '1', payload: 1.5, s7: { op: 'read', address: 'DB9,INT0', extra: true } };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (node as any).listeners('input')[0](msg, send, jest.fn());
      expect(send).toHaveBeenCalledWith(written(msg, { source: 'config', address: 'DB1,REAL0' }));
      // The caller's message is left as it was
      expect(msg.s7).toEqual({ op: 'read', address: 'DB9,INT0', extra: true });
    });

    it('sends nothing, and so no msg.s7, when the write fails', async () => {
      mockBackend.shouldFailWrite = true;
      const node = createNodeContext();
      constructorFn.call(node, { id: 'write1', type: 's7-write', server: 'config1', address: 'DB1,REAL0' });
      const send = jest.fn();
      const done = jest.fn();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (node as any).listeners('input')[0]({ _msgid: '1', payload: 1.5 }, send, done);
      expect(send).not.toHaveBeenCalled();
      expect(done.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it('refuses an address source that is not a string', async () => {
      const node = createNodeContext();
      constructorFn.call(node, { id: 'write1', type: 's7-write', server: 'config1', address: 'topic', addressType: 'msg' });
      const done = jest.fn();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (node as any).listeners('input')[0]({ _msgid: '1', payload: 1, topic: ['DB1,INT0'] }, jest.fn(), done);
      expect(done.mock.calls[0][0].message).toBe('msg.topic must be an address string (got object)');
      expect(mockBackend.writeCalls).toHaveLength(0);
    });

    it('says which property was empty when the address source has nothing', async () => {
      const node = createNodeContext();
      constructorFn.call(node, { id: 'write1', type: 's7-write', server: 'config1', address: 'topic', addressType: 'msg' });
      const done = jest.fn();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (node as any).listeners('input')[0]({ _msgid: '1', payload: 1 }, jest.fn(), done);
      expect(done.mock.calls[0][0].message).toBe('No address in msg.topic');
    });

    it('calls done with error when no address is specified', async () => {
      const node = createNodeContext();
      constructorFn.call(node, {
        id: 'write1',
        type: 's7-write',
        server: 'config1',
        address: '',
      });

      const msg = { _msgid: '123', payload: 42 };
      const send = jest.fn();
      const done = jest.fn();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inputHandler = (node as any).listeners('input')[0];
      await inputHandler(msg, send, done);

      expect(done).toHaveBeenCalledWith(expect.any(Error));
      expect(done.mock.calls[0][0].message).toBe('No address specified');
      expect(send).not.toHaveBeenCalled();
    });

    it('calls done with error when write fails', async () => {
      mockBackend.shouldFailWrite = true;

      const node = createNodeContext();
      constructorFn.call(node, {
        id: 'write1',
        type: 's7-write',
        server: 'config1',
        address: 'DB1,REAL0',
      });

      const msg = { _msgid: '123', payload: 42 };
      const send = jest.fn();
      const done = jest.fn();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inputHandler = (node as any).listeners('input')[0];
      await inputHandler(msg, send, done);

      expect(done).toHaveBeenCalledWith(expect.any(Error));
      expect(send).not.toHaveBeenCalled();
    });

    it('uses node.send fallback when _send is null', async () => {
      const node = createNodeContext();
      constructorFn.call(node, {
        id: 'write1',
        type: 's7-write',
        server: 'config1',
        address: 'DB1,REAL0',
      });

      const msg = { _msgid: '123', payload: 55 };
      const done = jest.fn();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inputHandler = (node as any).listeners('input')[0];
      await inputHandler(msg, null, done);

      expect(node.send).toHaveBeenCalledWith(written(msg, { source: 'config', address: 'DB1,REAL0' }));
      expect(done).toHaveBeenCalledWith();
    });

    it('removes stateChanged listener on close', () => {
      const node = createNodeContext();
      constructorFn.call(node, {
        id: 'write1',
        type: 's7-write',
        server: 'config1',
        address: 'DB1,REAL0',
      });

      const listenerCount = connManager.listenerCount('stateChanged');
      node.emit('close');
      expect(connManager.listenerCount('stateChanged')).toBe(listenerCount - 1);
    });

    it('updates status for connecting state', () => {
      const node = createNodeContext();
      constructorFn.call(node, {
        id: 'write1',
        type: 's7-write',
        server: 'config1',
        address: 'DB1,REAL0',
      });

      connManager.emit('stateChanged', { newState: 'connecting' });
      expect(node.status).toHaveBeenCalledWith({
        fill: 'yellow', shape: 'ring', text: 'connecting',
      });
    });

    it('updates status for error state', () => {
      const node = createNodeContext();
      constructorFn.call(node, {
        id: 'write1',
        type: 's7-write',
        server: 'config1',
        address: 'DB1,REAL0',
      });

      connManager.emit('stateChanged', { newState: 'error' });
      expect(node.status).toHaveBeenCalledWith({
        fill: 'red', shape: 'dot', text: 'error',
      });
    });

    it('updates status for disconnected state', () => {
      const node = createNodeContext();
      constructorFn.call(node, {
        id: 'write1',
        type: 's7-write',
        server: 'config1',
        address: 'DB1,REAL0',
      });

      connManager.emit('stateChanged', { newState: 'disconnected' });
      expect(node.status).toHaveBeenCalledWith({
        fill: 'grey', shape: 'ring', text: 'disconnected',
      });
    });

    describe('multi mode', () => {
      it('writes multiple addresses from object payload', async () => {
        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'write1',
          type: 's7-write',
          server: 'config1',
          address: '',
          mode: 'multi',
        });

        const msg = { _msgid: '123', payload: { 'DB1,REAL0': 42.5, 'DB1,INT4': 100 } };
        const send = jest.fn();
        const done = jest.fn();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputHandler = (node as any).listeners('input')[0];
        await inputHandler(msg, send, done);

        expect(mockBackend.writeCalls).toHaveLength(1);
        expect(mockBackend.writeCalls[0]).toHaveLength(2);
        expect(mockBackend.writeCalls[0][0].value).toBe(42.5);
        expect(mockBackend.writeCalls[0][1].value).toBe(100);
        expect(send).toHaveBeenCalledWith(written(msg, {
          source: 'msg.payload',
          addresses: { 'DB1,REAL0': 'DB1,REAL0', 'DB1,INT4': 'DB1,INT4' },
        }));
        expect(done).toHaveBeenCalledWith();
      });

      it('sets msg.s7.address too when the payload has one address', async () => {
        const node = createNodeContext();
        constructorFn.call(node, { id: 'write1', type: 's7-write', server: 'config1', address: '', mode: 'multi' });
        const msg = { _msgid: '1', payload: { 'DB1,INT4': 7 } };
        const send = jest.fn();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (node as any).listeners('input')[0](msg, send, jest.fn());
        expect(send).toHaveBeenCalledWith(written(msg, {
          source: 'msg.payload', address: 'DB1,INT4', addresses: { 'DB1,INT4': 'DB1,INT4' },
        }));
      });

      it('errors when payload is a string', async () => {
        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'write1',
          type: 's7-write',
          server: 'config1',
          address: '',
          mode: 'multi',
        });

        const msg = { _msgid: '123', payload: 'not an object' };
        const send = jest.fn();
        const done = jest.fn();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputHandler = (node as any).listeners('input')[0];
        await inputHandler(msg, send, done);

        expect(done).toHaveBeenCalledWith(expect.any(Error));
        expect(done.mock.calls[0][0].message).toContain('object');
        expect(send).not.toHaveBeenCalled();
      });

      it('errors when payload is an array', async () => {
        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'write1',
          type: 's7-write',
          server: 'config1',
          address: '',
          mode: 'multi',
        });

        const msg = { _msgid: '123', payload: [1, 2, 3] };
        const send = jest.fn();
        const done = jest.fn();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputHandler = (node as any).listeners('input')[0];
        await inputHandler(msg, send, done);

        expect(done).toHaveBeenCalledWith(expect.any(Error));
        expect(done.mock.calls[0][0].message).toContain('object');
        expect(send).not.toHaveBeenCalled();
      });

      it('errors when payload is null', async () => {
        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'write1',
          type: 's7-write',
          server: 'config1',
          address: '',
          mode: 'multi',
        });

        const msg = { _msgid: '123', payload: null };
        const send = jest.fn();
        const done = jest.fn();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputHandler = (node as any).listeners('input')[0];
        await inputHandler(msg, send, done);

        expect(done).toHaveBeenCalledWith(expect.any(Error));
        expect(done.mock.calls[0][0].message).toContain('object');
        expect(send).not.toHaveBeenCalled();
      });

      it('errors when payload is empty object', async () => {
        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'write1',
          type: 's7-write',
          server: 'config1',
          address: '',
          mode: 'multi',
        });

        const msg = { _msgid: '123', payload: {} };
        const send = jest.fn();
        const done = jest.fn();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputHandler = (node as any).listeners('input')[0];
        await inputHandler(msg, send, done);

        expect(done).toHaveBeenCalledWith(expect.any(Error));
        expect(done.mock.calls[0][0].message).toContain('empty');
        expect(send).not.toHaveBeenCalled();
      });

      it('propagates write failure as error', async () => {
        mockBackend.shouldFailWrite = true;

        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'write1',
          type: 's7-write',
          server: 'config1',
          address: '',
          mode: 'multi',
        });

        const msg = { _msgid: '123', payload: { 'DB1,REAL0': 42.5 } };
        const send = jest.fn();
        const done = jest.fn();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputHandler = (node as any).listeners('input')[0];
        await inputHandler(msg, send, done);

        expect(done).toHaveBeenCalledWith(expect.any(Error));
        expect(send).not.toHaveBeenCalled();
      });
    });

    describe('struct mode', () => {
      const validSchema = JSON.stringify([
        { name: 'temperature', type: 'REAL', offset: 0 },
        { name: 'count', type: 'INT', offset: 4 },
      ]);

      function setupRawAreaData() {
        // DB1 area code = 0x84 = 132, dbNumber = 1, offset = 0
        // REAL=4 bytes at offset 0 + INT=2 bytes at offset 4 = 6 bytes total
        const buf = Buffer.alloc(6);
        buf.writeFloatBE(0, 0);     // temperature = 0.0
        buf.writeInt16BE(0, 4);     // count = 0
        mockBackend.rawAreaData.set('132:1:0:6', buf);
      }

      it('successfully writes struct fields', async () => {
        setupRawAreaData();
        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'write1',
          type: 's7-write',
          server: 'config1',
          address: 'DB1,BYTE0',
          mode: 'struct',
          schema: validSchema,
        });

        const msg = { _msgid: '123', payload: { temperature: 25.5, count: 10 } };
        const send = jest.fn();
        const done = jest.fn();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputHandler = (node as any).listeners('input')[0];
        await inputHandler(msg, send, done);

        expect(mockBackend.rawReadCalls).toHaveLength(1);
        expect(mockBackend.writeCalls).toHaveLength(1);
        expect(mockBackend.writeCalls[0]).toHaveLength(2);
        expect(send).toHaveBeenCalledWith(written(msg, { source: 'config', address: 'DB1,BYTE0' }));
        expect(done).toHaveBeenCalledWith();
      });

      it('accepts the wider types in a schema, like s7-read does', async () => {
        mockBackend.rawAreaData.set('132:1:0:32', Buffer.alloc(32));
        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'write1',
          type: 's7-write',
          server: 'config1',
          address: 'DB1,BYTE0',
          mode: 'struct',
          schema: JSON.stringify([
            { name: 'stamp', type: 'DTLZ', offset: 0 },
            { name: 'big', type: 'ULINT', offset: 12 },
            { name: 'label', type: 'WSTRING', offset: 20, length: 4 },
          ]),
        });

        const when = new Date('2024-03-17T10:30:45.123Z');
        const msg = { _msgid: '123', payload: { stamp: when, big: 18446744073709551615n, label: 'Hi' } };
        const done = jest.fn();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (node as any).listeners('input')[0](msg, jest.fn(), done);

        expect(done).toHaveBeenCalledWith();
        expect(mockBackend.writeCalls[0].map((i: { address: { dataType: string } }) => i.address.dataType))
          .toEqual(['DTLZ', 'ULINT', 'WSTRING']);
      });

      it('takes the base address from msg.topic when told to', async () => {
        // DB2 area code = 0x84 = 132, dbNumber = 2, offset = 0
        const buf = Buffer.alloc(6);
        mockBackend.rawAreaData.set('132:2:0:6', buf);

        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'write1',
          type: 's7-write',
          server: 'config1',
          address: 'topic',
          addressType: 'msg',
          mode: 'struct',
          schema: validSchema,
        });

        const msg = { _msgid: '123', payload: { temperature: 30.0 }, topic: 'DB2,BYTE0' };
        const send = jest.fn();
        const done = jest.fn();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputHandler = (node as any).listeners('input')[0];
        await inputHandler(msg, send, done);

        // Should have read from DB2
        expect(mockBackend.rawReadCalls[0].dbNumber).toBe(2);
        expect(send).toHaveBeenCalledWith(written(msg, { source: 'msg.topic', address: 'DB2,BYTE0' }));
        expect(done).toHaveBeenCalledWith();
      });

      it('ignores msg.topic and msg.schema in struct mode by default', async () => {
        mockBackend.rawAreaData.set('132:1:0:6', Buffer.alloc(6));
        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'write1', type: 's7-write', server: 'config1', address: 'DB1,BYTE0', mode: 'struct', schema: validSchema,
        });
        const msg = { _msgid: '1', payload: { temperature: 1 }, topic: 'DB2,BYTE0', schema: [{ name: 'x', type: 'BYTE', offset: 0 }] };
        const done = jest.fn();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (node as any).listeners('input')[0](msg, jest.fn(), done);
        expect(mockBackend.rawReadCalls[0].dbNumber).toBe(1);
        expect(mockBackend.writeCalls[0][0].address).toMatchObject({ dataType: 'REAL' });
        expect(done).toHaveBeenCalledWith();
      });

      it('takes the schema from msg.schema when told to', async () => {
        // Only a BYTE field at offset 0 => 1 byte needed
        const buf = Buffer.alloc(1);
        mockBackend.rawAreaData.set('132:1:0:1', buf);

        const overrideSchema = [
          { name: 'status', type: 'BYTE', offset: 0 },
        ];

        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'write1',
          type: 's7-write',
          server: 'config1',
          address: 'DB1,BYTE0',
          mode: 'struct',
          schema: validSchema,
          schemaType: 'msg',
          schemaProp: 'schema',
        });

        const msg = { _msgid: '123', payload: { status: 1 }, schema: overrideSchema } as Record<string, unknown>;
        const send = jest.fn();
        const done = jest.fn();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputHandler = (node as any).listeners('input')[0];
        await inputHandler(msg, send, done);

        expect(mockBackend.writeCalls).toHaveLength(1);
        expect(mockBackend.writeCalls[0]).toHaveLength(1);
        expect(send).toHaveBeenCalled();
        expect(done).toHaveBeenCalledWith();
      });

      it('errors when no base address specified', async () => {
        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'write1',
          type: 's7-write',
          server: 'config1',
          address: '',
          mode: 'struct',
          schema: validSchema,
        });

        const msg = { _msgid: '123', payload: { temperature: 25.5 } };
        const send = jest.fn();
        const done = jest.fn();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputHandler = (node as any).listeners('input')[0];
        await inputHandler(msg, send, done);

        expect(done).toHaveBeenCalledWith(expect.any(Error));
        expect(done.mock.calls[0][0].message).toBe('No base address specified');
        expect(send).not.toHaveBeenCalled();
      });

      it('errors when no schema specified', async () => {
        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'write1',
          type: 's7-write',
          server: 'config1',
          address: 'DB1,BYTE0',
          mode: 'struct',
          schema: '',
        });

        const msg = { _msgid: '123', payload: { temperature: 25.5 } };
        const send = jest.fn();
        const done = jest.fn();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputHandler = (node as any).listeners('input')[0];
        await inputHandler(msg, send, done);

        expect(done).toHaveBeenCalledWith(expect.any(Error));
        expect(done.mock.calls[0][0].message).toBe('No schema specified');
        expect(send).not.toHaveBeenCalled();
      });

      it('errors when schema is invalid JSON', async () => {
        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'write1',
          type: 's7-write',
          server: 'config1',
          address: 'DB1,BYTE0',
          mode: 'struct',
          schema: '{not valid json',
        });

        const msg = { _msgid: '123', payload: { temperature: 25.5 } };
        const send = jest.fn();
        const done = jest.fn();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputHandler = (node as any).listeners('input')[0];
        await inputHandler(msg, send, done);

        expect(done).toHaveBeenCalledWith(expect.any(Error));
        expect(done.mock.calls[0][0].message).toBe('Invalid JSON in schema');
        expect(send).not.toHaveBeenCalled();
      });

      it('errors when schema is empty array', async () => {
        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'write1',
          type: 's7-write',
          server: 'config1',
          address: 'DB1,BYTE0',
          mode: 'struct',
          schema: '[]',
        });

        const msg = { _msgid: '123', payload: { temperature: 25.5 } };
        const send = jest.fn();
        const done = jest.fn();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputHandler = (node as any).listeners('input')[0];
        await inputHandler(msg, send, done);

        expect(done).toHaveBeenCalledWith(expect.any(Error));
        expect(done.mock.calls[0][0].message).toBe('Schema must be a non-empty array');
        expect(send).not.toHaveBeenCalled();
      });

      it('errors when payload is not an object', async () => {
        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'write1',
          type: 's7-write',
          server: 'config1',
          address: 'DB1,BYTE0',
          mode: 'struct',
          schema: validSchema,
        });

        const msg = { _msgid: '123', payload: 'not an object' };
        const send = jest.fn();
        const done = jest.fn();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputHandler = (node as any).listeners('input')[0];
        await inputHandler(msg, send, done);

        expect(done).toHaveBeenCalledWith(expect.any(Error));
        expect(done.mock.calls[0][0].message).toContain('object');
        expect(send).not.toHaveBeenCalled();
      });

      it('errors when schema field has invalid type', async () => {
        const badSchema = JSON.stringify([
          { name: 'field1', type: 'INVALID_TYPE', offset: 0 },
        ]);

        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'write1',
          type: 's7-write',
          server: 'config1',
          address: 'DB1,BYTE0',
          mode: 'struct',
          schema: badSchema,
        });

        const msg = { _msgid: '123', payload: { field1: 42 } };
        const send = jest.fn();
        const done = jest.fn();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputHandler = (node as any).listeners('input')[0];
        await inputHandler(msg, send, done);

        expect(done).toHaveBeenCalledWith(expect.any(Error));
        expect(done.mock.calls[0][0].message).toContain('invalid type');
        expect(send).not.toHaveBeenCalled();
      });

      it('errors when schema field missing name', async () => {
        const badSchema = JSON.stringify([
          { type: 'REAL', offset: 0 },
        ]);

        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'write1',
          type: 's7-write',
          server: 'config1',
          address: 'DB1,BYTE0',
          mode: 'struct',
          schema: badSchema,
        });

        const msg = { _msgid: '123', payload: { temperature: 25.5 } };
        const send = jest.fn();
        const done = jest.fn();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputHandler = (node as any).listeners('input')[0];
        await inputHandler(msg, send, done);

        expect(done).toHaveBeenCalledWith(expect.any(Error));
        expect(done.mock.calls[0][0].message).toContain('missing required "name"');
        expect(send).not.toHaveBeenCalled();
      });

      // The editor keeps a named field whose offset was left empty and saves it without one (#83).
      // It must not be written at offset 0.
      it('reports a schema field saved without an offset and writes nothing', async () => {
        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'write1',
          type: 's7-write',
          server: 'config1',
          address: 'DB1,BYTE0',
          mode: 'struct',
          schema: JSON.stringify([
            { name: 'temp', type: 'REAL', offset: 0 },
            { name: 'count', type: 'INT' },
          ]),
        });

        const send = jest.fn();
        const done = jest.fn();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputHandler = (node as any).listeners('input')[0];
        await inputHandler({ _msgid: '123', payload: { temp: 25.5, count: 7 } }, send, done);

        expect(done).toHaveBeenCalledWith(expect.any(Error));
        expect(done.mock.calls[0][0].message).toBe('Schema field "count" has invalid offset: undefined');
        expect(send).not.toHaveBeenCalled();
        expect(mockBackend.rawReadCalls).toHaveLength(0);
        expect(mockBackend.writeCalls).toHaveLength(0);
      });

      it('errors when schema field has invalid offset', async () => {
        const badSchema = JSON.stringify([
          { name: 'field1', type: 'REAL', offset: -1 },
        ]);

        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'write1',
          type: 's7-write',
          server: 'config1',
          address: 'DB1,BYTE0',
          mode: 'struct',
          schema: badSchema,
        });

        const msg = { _msgid: '123', payload: { field1: 25.5 } };
        const send = jest.fn();
        const done = jest.fn();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputHandler = (node as any).listeners('input')[0];
        await inputHandler(msg, send, done);

        expect(done).toHaveBeenCalledWith(expect.any(Error));
        expect(done.mock.calls[0][0].message).toContain('invalid offset');
        expect(send).not.toHaveBeenCalled();
      });

      it('errors when no fields in payload match schema', async () => {
        setupRawAreaData();
        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'write1',
          type: 's7-write',
          server: 'config1',
          address: 'DB1,BYTE0',
          mode: 'struct',
          schema: validSchema,
        });

        const msg = { _msgid: '123', payload: { unknownField: 42 } };
        const send = jest.fn();
        const done = jest.fn();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputHandler = (node as any).listeners('input')[0];
        await inputHandler(msg, send, done);

        expect(done).toHaveBeenCalledWith(expect.any(Error));
        expect(done.mock.calls[0][0].message).toContain('No fields');
        expect(send).not.toHaveBeenCalled();
      });

      it('propagates write failure as error', async () => {
        setupRawAreaData();
        mockBackend.shouldFailWrite = true;

        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'write1',
          type: 's7-write',
          server: 'config1',
          address: 'DB1,BYTE0',
          mode: 'struct',
          schema: validSchema,
        });

        const msg = { _msgid: '123', payload: { temperature: 25.5 } };
        const send = jest.fn();
        const done = jest.fn();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputHandler = (node as any).listeners('input')[0];
        await inputHandler(msg, send, done);

        expect(done).toHaveBeenCalledWith(expect.any(Error));
        expect(send).not.toHaveBeenCalled();
      });
    });
  });
});
