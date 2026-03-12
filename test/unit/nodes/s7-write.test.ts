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
      expect(send).toHaveBeenCalledWith(msg);
      expect(done).toHaveBeenCalledWith();
    });

    it('uses msg.topic as address when provided', async () => {
      const node = createNodeContext();
      constructorFn.call(node, {
        id: 'write1',
        type: 's7-write',
        server: 'config1',
        address: 'DB1,REAL0',
      });

      const msg = { _msgid: '123', payload: 10, topic: 'DB1,INT0' };
      const send = jest.fn();
      const done = jest.fn();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inputHandler = (node as any).listeners('input')[0];
      await inputHandler(msg, send, done);

      // Should have used the topic address (INT0)
      expect(mockBackend.writeCalls).toHaveLength(1);
      expect(send).toHaveBeenCalledWith(msg);
      expect(done).toHaveBeenCalledWith();
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

      expect(node.send).toHaveBeenCalledWith(msg);
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
        expect(send).toHaveBeenCalledWith(msg);
        expect(done).toHaveBeenCalledWith();
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
        expect(send).toHaveBeenCalledWith(msg);
        expect(done).toHaveBeenCalledWith();
      });

      it('uses msg.topic as base address', async () => {
        // DB2 area code = 0x84 = 132, dbNumber = 2, offset = 0
        const buf = Buffer.alloc(6);
        mockBackend.rawAreaData.set('132:2:0:6', buf);

        const node = createNodeContext();
        constructorFn.call(node, {
          id: 'write1',
          type: 's7-write',
          server: 'config1',
          address: 'DB1,BYTE0',
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
        expect(send).toHaveBeenCalledWith(msg);
        expect(done).toHaveBeenCalledWith();
      });

      it('uses msg.schema to override config schema', async () => {
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
