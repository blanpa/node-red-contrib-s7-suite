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
  });
});
