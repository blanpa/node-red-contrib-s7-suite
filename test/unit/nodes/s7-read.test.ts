import { EventEmitter } from 'events';
import { ConnectionManager } from '../../../src/core/connection-manager';
import { MockBackend } from '../../helpers/mock-backend';

import s7ReadModule = require('../../../src/nodes/s7-read/s7-read');

describe('s7-read node', () => {
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

  // msg.s7 for a read
  const readDetails = (details: Record<string, unknown>) => ({
    op: 'read', server: 'PLC 1', ...details, timestamp: expect.any(Number), durationMs: expect.any(Number),
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
    s7ReadModule(mockRED as any);
  });

  it('registers the s7-read type', () => {
    expect(registeredType).toBe('s7-read');
  });

  describe('missing server config', () => {
    it('sets error status when server node is missing', () => {
      mockRED.nodes.getNode.mockReturnValue(null);
      const node = createNodeContext();

      constructorFn.call(node, {
        id: 'read1',
        type: 's7-read',
        server: 'missing-config',
        address: 'DB1,REAL0',
        outputMode: 'single',
        topic: '',
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
        id: 'read1',
        type: 's7-read',
        server: 'missing-config',
        address: 'DB1,REAL0',
        outputMode: 'single',
        topic: '',
      });

      // Only createNode is called, no 'input' or 'close' listeners should be registered
      const inputListeners = onSpy.mock.calls.filter(c => c[0] === 'input');
      expect(inputListeners).toHaveLength(0);
    });
  });

  describe('with valid server config', () => {
    let serverNode: ReturnType<typeof createServerNode>;

    beforeEach(async () => {
      serverNode = createServerNode();
      mockRED.nodes.getNode.mockReturnValue(serverNode);
      // Connect so the connection manager is ready
      await connManager.connect();
    });

    afterEach(async () => {
      await connManager.disconnect();
    });

    it('updates status based on connection state', () => {
      const node = createNodeContext();

      constructorFn.call(node, {
        id: 'read1',
        type: 's7-read',
        server: 'config1',
        address: 'DB1,REAL0',
        outputMode: 'single',
        topic: '',
      });

      // Should show connected since we called connect() in beforeEach
      expect(node.status).toHaveBeenCalledWith({
        fill: 'green', shape: 'dot', text: 'connected',
      });
    });

    it('reads a single value and sends it as payload', async () => {
      mockBackend.readValues = { item_0: 42.5 };

      const node = createNodeContext();
      constructorFn.call(node, {
        id: 'read1',
        type: 's7-read',
        server: 'config1',
        address: 'DB1,REAL0',
        outputMode: 'single',
        topic: '',
      });

      // Simulate an input message
      const msg = { _msgid: '123', payload: null };
      const send = jest.fn();
      const done = jest.fn();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inputHandler = (node as any).listeners('input')[0];
      await inputHandler(msg, send, done);

      expect(send).toHaveBeenCalledWith(expect.objectContaining({ payload: 42.5 }));
      expect(done).toHaveBeenCalledWith();
    });

    it('msg.action acts on the connection instead of reading when Dynamic control is on', async () => {
      Object.assign(serverNode, { allowDynamic: true, configError: null, getStatus: () => connManager.getStatus() });
      const node = createNodeContext();
      constructorFn.call(node, { id: 'read1', type: 's7-read', server: 'config1', address: 'DB1,REAL0', outputMode: 'single' });
      const send = jest.fn();
      const done = jest.fn();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (node as any).listeners('input')[0]({ _msgid: '1', action: 'status' }, send, done);
      expect(send).toHaveBeenCalledWith({
        _msgid: '1',
        payload: expect.objectContaining({ state: 'connected' }),
        s7: { op: 'status', server: 'PLC 1', timestamp: expect.any(Number), durationMs: expect.any(Number) },
      });
      expect(mockBackend.readCalls).toHaveLength(0);
      expect(done).toHaveBeenCalledWith();
    });

    describe('msg.s7', () => {
      const read = async (config: Record<string, unknown>, msg: Record<string, unknown> = { _msgid: '1' }) => {
        const node = createNodeContext();
        constructorFn.call(node, { id: 'read1', type: 's7-read', server: 'config1', ...config });
        const send = jest.fn();
        const done = jest.fn();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (node as any).listeners('input')[0](msg, send, done);
        expect(done).toHaveBeenCalledWith();
        return send.mock.calls[0][0];
      };

      it('names the address and server for a single read', async () => {
        mockBackend.readValues = { item_0: 42.5 };
        const out = await read({ address: 'DB1,REAL0', outputMode: 'single' });
        expect(out.s7).toEqual(readDetails({ source: 'config', address: 'DB1,REAL0' }));
      });

      it('keys msg.s7.addresses like the payload for several addresses', async () => {
        mockBackend.readValues = { item_0: 10, item_1: 20 };
        const out = await read({
          address: 'DB1,REAL0 DB1,REAL4', labels: JSON.stringify({ 'DB1,REAL4': 'temp' }), outputMode: 'single',
        });
        expect(out.payload).toEqual({ 'DB1,REAL0': 10, temp: 20 });
        expect(out.s7).toEqual(readDetails({
          source: 'config', addresses: { 'DB1,REAL0': 'DB1,REAL0', temp: 'DB1,REAL4' },
        }));
      });

      it('gives address and addresses for object output of one address', async () => {
        mockBackend.readValues = { item_0: 55 };
        const out = await read({ address: 'DB1,REAL0', outputMode: 'object' });
        expect(out.s7).toEqual(readDetails({
          source: 'config', address: 'DB1,REAL0', addresses: { 'DB1,REAL0': 'DB1,REAL0' },
        }));
      });

      it('names the property the addresses came from', async () => {
        mockBackend.readValues = { item_0: 1, item_1: 2 };
        const out = await read(
          { address: '', outputMode: 'object', addressType: 'msg', addressProp: 'request.addresses' },
          { _msgid: '1', request: { addresses: { speed: 'DB1,INT0', count: 'DB1,INT2' } } },
        );
        expect(out.s7).toEqual(readDetails({
          source: 'msg.request.addresses', addresses: { speed: 'DB1,INT0', count: 'DB1,INT2' },
        }));

        process.env.S7_TEST_READ_ADDRESS = 'DB1,INT4';
        mockBackend.readValues = { item_0: 3 };
        const fromEnv = await read({ address: '', outputMode: 'single', addressType: 'env', addressProp: 'S7_TEST_READ_ADDRESS' });
        expect(fromEnv.s7).toEqual(readDetails({ source: 'env.S7_TEST_READ_ADDRESS', address: 'DB1,INT4' }));
        delete process.env.S7_TEST_READ_ADDRESS;
      });

      it('names the address for buffer, bits and struct output', async () => {
        mockBackend.rawAreaData.set('132:1:0:2', Buffer.from([1, 2]));
        for (const outputMode of ['buffer', 'bits']) {
          const out = await read({ address: 'DB1,BYTE0.0.2', outputMode });
          expect(out.s7).toEqual(readDetails({ source: 'config', address: 'DB1,BYTE0.0.2' }));
        }
        const out = await read({
          address: 'DB1,BYTE0', outputMode: 'struct', schema: JSON.stringify([{ name: 'n', type: 'INT', offset: 0 }]),
        });
        expect(out.s7).toEqual(readDetails({ source: 'config', address: 'DB1,BYTE0' }));
      });

      it('replaces a msg.s7 that came in with the message', async () => {
        mockBackend.readValues = { item_0: 1 };
        const out = await read({ address: 'DB1,REAL0', outputMode: 'single' }, { _msgid: '1', s7: { op: 'write', x: 1 } });
        expect(out.s7).toEqual(readDetails({ source: 'config', address: 'DB1,REAL0' }));
      });

      it('times the read from the message arriving to it being sent', async () => {
        const now = jest.spyOn(Date, 'now');
        now.mockReturnValueOnce(1000).mockReturnValue(1012);
        mockBackend.readValues = { item_0: 1 };
        const out = await read({ address: 'DB1,REAL0', outputMode: 'single' });
        now.mockRestore();
        expect(out.s7).toMatchObject({ timestamp: 1012, durationMs: 12 });
      });
    });

    it('reads as usual when msg.action is set but Dynamic control is off', async () => {
      mockBackend.readValues = { item_0: 7 };
      const node = createNodeContext();
      constructorFn.call(node, { id: 'read1', type: 's7-read', server: 'config1', address: 'DB1,REAL0', outputMode: 'single' });
      const send = jest.fn();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (node as any).listeners('input')[0]({ _msgid: '1', action: 'disconnect' }, send, jest.fn());
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ payload: 7 }));
      expect(connManager.getState()).toBe('connected');
    });

    it('ignores msg.topic: the configured addresses are read', async () => {
      mockBackend.readValues = { item_0: 100 };

      const node = createNodeContext();
      constructorFn.call(node, {
        id: 'read1', type: 's7-read', server: 'config1', address: 'DB1,REAL0', outputMode: 'single', topic: '',
      });

      const done = jest.fn();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (node as any).listeners('input')[0]({ _msgid: '123', payload: null, topic: 'DB1,INT0' }, jest.fn(), done);

      expect(mockBackend.readCalls[0][0].address).toMatchObject({ dataType: 'REAL', offset: 0 });
      expect(done).toHaveBeenCalledWith();
    });

    it('reads the addresses from a msg property when told to', async () => {
      mockBackend.readValues = { item_0: 1, item_1: 2 };

      const node = createNodeContext();
      constructorFn.call(node, {
        id: 'read1', type: 's7-read', server: 'config1', address: 'DB1,REAL0', outputMode: 'object',
        addressType: 'msg', addressProp: 'request.addresses',
      });

      const send = jest.fn();
      const done = jest.fn();
      const msg = { _msgid: '1', request: { addresses: { speed: 'DB1,INT0', count: 'DB1,INT2' } } };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (node as any).listeners('input')[0](msg, send, done);

      expect(mockBackend.readCalls[0].map((i: { address: { offset: number } }) => i.address.offset)).toEqual([0, 2]);
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ payload: { speed: 1, count: 2 } }));
      expect(done).toHaveBeenCalledWith();
    });

    it('takes an array or a string of addresses from msg, and refuses anything else', async () => {
      const run = async (value: unknown) => {
        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'read1', type: 's7-read', server: 'config1', address: '', outputMode: 'object',
          addressType: 'msg', addressProp: 'addrs',
        });
        const done = jest.fn();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (node as any).listeners('input')[0]({ _msgid: '1', addrs: value }, jest.fn(), done);
        return done;
      };
      await run(['DB1,INT0', 'DB1,INT2']);
      expect(mockBackend.readCalls[mockBackend.readCalls.length - 1]).toHaveLength(2);
      await run('DB1,INT0 DB1,INT2; DB1,INT4');
      expect(mockBackend.readCalls[mockBackend.readCalls.length - 1]).toHaveLength(3);
      const done = await run(42);
      expect(done.mock.calls[0][0].message).toBe(
        'msg.addrs must be an address string, an array of addresses or an object of { label: address } (got number)',
      );
      expect((await run(undefined)).mock.calls[0][0].message).toBe('No address in msg.addrs');
    });

    it('reads multiple addresses and returns object payload', async () => {
      mockBackend.readValues = { item_0: 10, item_1: 20 };

      const node = createNodeContext();
      constructorFn.call(node, {
        id: 'read1',
        type: 's7-read',
        server: 'config1',
        address: 'DB1,REAL0 DB1,REAL4',
        outputMode: 'single',
        topic: '',
      });

      const msg = { _msgid: '123', payload: null };
      const send = jest.fn();
      const done = jest.fn();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inputHandler = (node as any).listeners('input')[0];
      await inputHandler(msg, send, done);

      // Multiple addresses should return object payload
      const sentPayload = send.mock.calls[0][0].payload;
      expect(sentPayload).toEqual({
        'DB1,REAL0': 10,
        'DB1,REAL4': 20,
      });
      expect(done).toHaveBeenCalledWith();
    });

    it('returns object payload when outputMode is object', async () => {
      mockBackend.readValues = { item_0: 55 };

      const node = createNodeContext();
      constructorFn.call(node, {
        id: 'read1',
        type: 's7-read',
        server: 'config1',
        address: 'DB1,REAL0',
        outputMode: 'object',
        topic: '',
      });

      const msg = { _msgid: '123', payload: null };
      const send = jest.fn();
      const done = jest.fn();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inputHandler = (node as any).listeners('input')[0];
      await inputHandler(msg, send, done);

      const sentPayload = send.mock.calls[0][0].payload;
      expect(sentPayload).toEqual({ 'DB1,REAL0': 55 });
    });

    it('calls done with error when no address is specified', async () => {
      const node = createNodeContext();
      constructorFn.call(node, {
        id: 'read1',
        type: 's7-read',
        server: 'config1',
        address: '',
        outputMode: 'single',
        topic: '',
      });

      const msg = { _msgid: '123', payload: null };
      const send = jest.fn();
      const done = jest.fn();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inputHandler = (node as any).listeners('input')[0];
      await inputHandler(msg, send, done);

      expect(done).toHaveBeenCalledWith(expect.any(Error));
      expect(done.mock.calls[0][0].message).toBe('No address specified');
      expect(send).not.toHaveBeenCalled();
    });

    describe('when the backend marks addresses bad', () => {
      const result = (name: string, value: unknown, bad = false): Record<string, unknown> => ({
        name, address: {}, value, quality: bad ? 'bad' : 'good', timestamp: 0, error: bad ? 'BAD 255' : undefined,
      });

      async function run(address: string, results: Record<string, unknown>[]) {
        mockBackend.read = jest.fn(async () => results) as unknown as MockBackend['read'];
        const node = Object.assign(createNodeContext(), { warn: jest.fn() });
        constructorFn.call(node, { id: 'read1', type: 's7-read', server: 'config1', address, outputMode: 'object', topic: '' });
        const send = jest.fn();
        const done = jest.fn();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (node as any).listeners('input')[0]({ _msgid: '1', payload: null }, send, done);
        return { node, send, done };
      }

      it('sends what was read and warns about the rest', async () => {
        const { node, send, done } = await run('DB1,INT0 DB1,REAL200', [result('item_0', 11), result('item_1', null, true)]);
        expect(send).toHaveBeenCalledWith(expect.objectContaining({ payload: { 'DB1,INT0': 11, 'DB1,REAL200': null } }));
        expect(node.warn).toHaveBeenCalledWith('Read failed, sent as null: DB1,REAL200 (BAD 255)');
        expect(done).toHaveBeenCalledWith();
      });

      it('fails without sending when nothing could be read', async () => {
        const { send, done } = await run('DB1,REAL200', [result('item_0', null, true)]);
        expect(send).not.toHaveBeenCalled();
        expect(done.mock.calls[0][0].message).toBe('Read failed: DB1,REAL200 (BAD 255)');
      });
    });

    it('calls done with error when read fails', async () => {
      mockBackend.shouldFailRead = true;

      const node = createNodeContext();
      constructorFn.call(node, {
        id: 'read1',
        type: 's7-read',
        server: 'config1',
        address: 'DB1,REAL0',
        outputMode: 'single',
        topic: '',
      });

      const msg = { _msgid: '123', payload: null };
      const send = jest.fn();
      const done = jest.fn();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inputHandler = (node as any).listeners('input')[0];
      await inputHandler(msg, send, done);

      expect(done).toHaveBeenCalledWith(expect.any(Error));
      expect(send).not.toHaveBeenCalled();
    });

    it('uses node.send fallback when _send is null', async () => {
      mockBackend.readValues = { item_0: 99 };

      const node = createNodeContext();
      constructorFn.call(node, {
        id: 'read1',
        type: 's7-read',
        server: 'config1',
        address: 'DB1,REAL0',
        outputMode: 'single',
        topic: '',
      });

      const msg = { _msgid: '123', payload: null };
      const done = jest.fn();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inputHandler = (node as any).listeners('input')[0];
      await inputHandler(msg, null, done);

      expect(node.send).toHaveBeenCalledWith(expect.objectContaining({ payload: 99 }));
      expect(done).toHaveBeenCalledWith();
    });

    it('removes stateChanged listener on close', () => {
      const node = createNodeContext();
      constructorFn.call(node, {
        id: 'read1',
        type: 's7-read',
        server: 'config1',
        address: 'DB1,REAL0',
        outputMode: 'single',
        topic: '',
      });

      const listenerCount = connManager.listenerCount('stateChanged');
      node.emit('close');
      expect(connManager.listenerCount('stateChanged')).toBe(listenerCount - 1);
    });

    it('updates status to yellow for connecting state', () => {
      const node = createNodeContext();
      constructorFn.call(node, {
        id: 'read1',
        type: 's7-read',
        server: 'config1',
        address: 'DB1,REAL0',
        outputMode: 'single',
        topic: '',
      });

      // Simulate state change to 'reconnecting'
      connManager.emit('stateChanged', { newState: 'reconnecting' });

      expect(node.status).toHaveBeenCalledWith({
        fill: 'yellow', shape: 'ring', text: 'reconnecting',
      });
    });

    it('updates status to red for error state', () => {
      const node = createNodeContext();
      constructorFn.call(node, {
        id: 'read1',
        type: 's7-read',
        server: 'config1',
        address: 'DB1,REAL0',
        outputMode: 'single',
        topic: '',
      });

      connManager.emit('stateChanged', { newState: 'error' });

      expect(node.status).toHaveBeenCalledWith({
        fill: 'red', shape: 'dot', text: 'error',
      });
    });

    it('updates status to grey for disconnected state', () => {
      const node = createNodeContext();
      constructorFn.call(node, {
        id: 'read1',
        type: 's7-read',
        server: 'config1',
        address: 'DB1,REAL0',
        outputMode: 'single',
        topic: '',
      });

      connManager.emit('stateChanged', { newState: 'disconnected' });

      expect(node.status).toHaveBeenCalledWith({
        fill: 'grey', shape: 'ring', text: 'disconnected',
      });
    });

    describe('buffer output mode', () => {
      it('reads raw buffer and sends it as payload', async () => {
        const testBuffer = Buffer.from([0x41, 0x42, 0x43, 0x44]);
        mockBackend.rawAreaData.set('132:1:0:4', testBuffer);

        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'read1',
          type: 's7-read',
          server: 'config1',
          address: 'DB1,BYTE0.0.4',
          outputMode: 'buffer',
          topic: '',
          schema: '[]',
        });

        const msg = { _msgid: '123', payload: null };
        const send = jest.fn();
        const done = jest.fn();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputHandler = (node as any).listeners('input')[0];
        await inputHandler(msg, send, done);

        expect(send).toHaveBeenCalledTimes(1);
        const payload = send.mock.calls[0][0].payload;
        expect(Buffer.isBuffer(payload)).toBe(true);
        expect(Buffer.from(payload)).toEqual(testBuffer);
        expect(done).toHaveBeenCalledWith();
      });

      it('reads the address from msg.topic when told to', async () => {
        const testBuffer = Buffer.from([0x01, 0x02]);
        mockBackend.rawAreaData.set('132:2:0:2', testBuffer);

        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'read1',
          type: 's7-read',
          server: 'config1',
          address: 'DB1,BYTE0.0.4',
          outputMode: 'buffer',
          topic: '',
          schema: '[]',
          addressType: 'msg',
          addressProp: 'topic',
        });

        const msg = { _msgid: '123', payload: null, topic: 'DB2,BYTE0.0.2' };
        const send = jest.fn();
        const done = jest.fn();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputHandler = (node as any).listeners('input')[0];
        await inputHandler(msg, send, done);

        expect(send).toHaveBeenCalledTimes(1);
        expect(done).toHaveBeenCalledWith();
      });

      it('calls done with error when no address specified', async () => {
        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'read1',
          type: 's7-read',
          server: 'config1',
          address: '',
          outputMode: 'buffer',
          topic: '',
          schema: '[]',
        });

        const msg = { _msgid: '123', payload: null };
        const send = jest.fn();
        const done = jest.fn();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputHandler = (node as any).listeners('input')[0];
        await inputHandler(msg, send, done);

        expect(done).toHaveBeenCalledWith(expect.any(Error));
        expect(send).not.toHaveBeenCalled();
      });
    });

    describe('bits output mode', () => {
      it('reads bytes and returns boolean array (LSB first)', async () => {
        // 0b10100011 = 0xA3, 0b00000001 = 0x01
        const testBuffer = Buffer.from([0xA3, 0x01]);
        mockBackend.rawAreaData.set('132:1:0:2', testBuffer);

        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'read1',
          type: 's7-read',
          server: 'config1',
          address: 'DB1,BYTE0.0.2',
          outputMode: 'bits',
          topic: '',
          schema: '[]',
        });

        const msg = { _msgid: '123', payload: null };
        const send = jest.fn();
        const done = jest.fn();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputHandler = (node as any).listeners('input')[0];
        await inputHandler(msg, send, done);

        expect(send).toHaveBeenCalledTimes(1);
        const bits = send.mock.calls[0][0].payload;
        expect(bits).toHaveLength(16);
        // 0xA3 = 10100011 -> LSB first: [true,true,false,false,false,true,false,true]
        expect(bits[0]).toBe(true);
        expect(bits[1]).toBe(true);
        expect(bits[2]).toBe(false);
        expect(bits[5]).toBe(true);
        expect(bits[7]).toBe(true);
        // 0x01 = 00000001 -> LSB first: [true,false,false,false,false,false,false,false]
        expect(bits[8]).toBe(true);
        expect(bits[9]).toBe(false);
        expect(done).toHaveBeenCalledWith();
      });
    });

    describe('struct output mode', () => {
      it('reads buffer and extracts typed fields from schema', async () => {
        const buf = Buffer.alloc(7);
        buf.writeFloatBE(23.5, 0);  // REAL at offset 0
        buf.writeInt16BE(42, 4);     // INT at offset 4
        buf.writeUInt8(0x01, 6);     // BOOL bit 0 at offset 6

        mockBackend.rawAreaData.set('132:1:0:7', buf);

        const schema = JSON.stringify([
          { name: 'temp', type: 'REAL', offset: 0 },
          { name: 'count', type: 'INT', offset: 4 },
          { name: 'active', type: 'BOOL', offset: 6, bit: 0 },
        ]);

        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'read1',
          type: 's7-read',
          server: 'config1',
          address: 'DB1,BYTE0',
          outputMode: 'struct',
          topic: '',
          schema,
        });

        const msg = { _msgid: '123', payload: null };
        const send = jest.fn();
        const done = jest.fn();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputHandler = (node as any).listeners('input')[0];
        await inputHandler(msg, send, done);

        expect(send).toHaveBeenCalledTimes(1);
        const payload = send.mock.calls[0][0].payload;
        expect(payload.temp).toBeCloseTo(23.5);
        expect(payload.count).toBe(42);
        expect(payload.active).toBe(true);
        expect(done).toHaveBeenCalledWith();
      });

      // The editor keeps a named field whose offset was left empty and saves it without one (#83)
      it('reports a schema field saved without an offset and reads nothing', async () => {
        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'read1',
          type: 's7-read',
          server: 'config1',
          address: 'DB1,BYTE0',
          outputMode: 'struct',
          topic: '',
          schema: JSON.stringify([
            { name: 'temp', type: 'REAL', offset: 0 },
            { name: 'count', type: 'INT' },
          ]),
        });

        const send = jest.fn();
        const done = jest.fn();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputHandler = (node as any).listeners('input')[0];
        await inputHandler({ _msgid: '123', payload: null }, send, done);

        expect(done).toHaveBeenCalledWith(expect.any(Error));
        expect(done.mock.calls[0][0].message).toBe('Schema field "count" has invalid offset: undefined');
        expect(send).not.toHaveBeenCalled();
        expect(mockBackend.rawReadCalls).toHaveLength(0);
      });

      it('takes the schema from msg.schema when told to', async () => {
        const buf = Buffer.alloc(4);
        buf.writeFloatBE(99.9, 0);
        mockBackend.rawAreaData.set('132:1:0:4', buf);

        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'read1',
          type: 's7-read',
          server: 'config1',
          address: 'DB1,BYTE0',
          outputMode: 'struct',
          topic: '',
          schema: '[]',
          schemaType: 'msg',
          schemaProp: 'schema',
        });

        const msg = {
          _msgid: '123',
          payload: null,
          schema: [{ name: 'value', type: 'REAL', offset: 0 }],
        };
        const send = jest.fn();
        const done = jest.fn();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputHandler = (node as any).listeners('input')[0];
        await inputHandler(msg, send, done);

        expect(send).toHaveBeenCalledTimes(1);
        const payload = send.mock.calls[0][0].payload;
        expect(payload.value).toBeCloseTo(99.9);
        expect(done).toHaveBeenCalledWith();
      });

      it('ignores msg.schema and msg.outputMode by default', async () => {
        mockBackend.rawAreaData.set('132:1:0:4', Buffer.alloc(4));
        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'read1', type: 's7-read', server: 'config1', address: 'DB1,BYTE0', outputMode: 'struct',
          schema: JSON.stringify([{ name: 'configured', type: 'REAL', offset: 0 }]),
        });
        const send = jest.fn();
        const msg = { _msgid: '1', schema: [{ name: 'fromMsg', type: 'REAL', offset: 0 }], outputMode: 'buffer' };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (node as any).listeners('input')[0](msg, send, jest.fn());
        expect(Object.keys(send.mock.calls[0][0].payload)).toEqual(['configured']);
      });

      it('calls done with error when no schema specified', async () => {
        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'read1',
          type: 's7-read',
          server: 'config1',
          address: 'DB1,BYTE0',
          outputMode: 'struct',
          topic: '',
          schema: '',
        });

        const msg = { _msgid: '123', payload: null };
        const send = jest.fn();
        const done = jest.fn();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputHandler = (node as any).listeners('input')[0];
        await inputHandler(msg, send, done);

        expect(done).toHaveBeenCalledWith(expect.any(Error));
        expect(done.mock.calls[0][0].message).toBe('No schema specified');
        expect(send).not.toHaveBeenCalled();
      });

      it('calls done with error for empty schema array', async () => {
        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'read1',
          type: 's7-read',
          server: 'config1',
          address: 'DB1,BYTE0',
          outputMode: 'struct',
          topic: '',
          schema: '[]',
        });

        const msg = { _msgid: '123', payload: null };
        const send = jest.fn();
        const done = jest.fn();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputHandler = (node as any).listeners('input')[0];
        await inputHandler(msg, send, done);

        expect(done).toHaveBeenCalledWith(expect.any(Error));
        expect(done.mock.calls[0][0].message).toBe('Schema must be a non-empty array');
        expect(send).not.toHaveBeenCalled();
      });
    });
  });
});
