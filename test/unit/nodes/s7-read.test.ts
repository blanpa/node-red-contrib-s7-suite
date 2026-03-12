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
  };

  function createServerNode() {
    mockBackend = new MockBackend();
    connManager = new ConnectionManager(mockBackend, {
      host: '192.168.1.100', port: 102, rack: 0, slot: 1,
      plcType: 'S7-1200', backend: 'nodes7',
    });
    return { connectionManager: connManager, registerChildNode: jest.fn(), deregisterChildNode: jest.fn() };
  }

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

    it('uses msg.topic as address when provided', async () => {
      mockBackend.readValues = { item_0: 100 };

      const node = createNodeContext();
      constructorFn.call(node, {
        id: 'read1',
        type: 's7-read',
        server: 'config1',
        address: 'DB1,REAL0',
        outputMode: 'single',
        topic: '',
      });

      const msg = { _msgid: '123', payload: null, topic: 'DB1,INT0' };
      const send = jest.fn();
      const done = jest.fn();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inputHandler = (node as any).listeners('input')[0];
      await inputHandler(msg, send, done);

      expect(send).toHaveBeenCalled();
      expect(done).toHaveBeenCalledWith();
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

      it('uses msg.topic as address override', async () => {
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

      it('accepts msg.schema as runtime override', async () => {
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
