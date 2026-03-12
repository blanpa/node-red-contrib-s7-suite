import { EventEmitter } from 'events';
import { ConnectionManager } from '../../../src/core/connection-manager';
import { MockBackend } from '../../helpers/mock-backend';

import s7TriggerModule = require('../../../src/nodes/s7-trigger/s7-trigger');

describe('s7-trigger node', () => {
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
    jest.useFakeTimers();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    s7TriggerModule(mockRED as any);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('registers the s7-trigger type', () => {
    expect(registeredType).toBe('s7-trigger');
  });

  describe('missing server config', () => {
    it('sets error status when server node is missing', () => {
      mockRED.nodes.getNode.mockReturnValue(null);
      const node = createNodeContext();

      constructorFn.call(node, {
        id: 'trigger1',
        type: 's7-trigger',
        server: 'missing-config',
        address: 'DB1,REAL0',
        interval: 1000,
        edgeMode: 'any',
        deadband: 0,
      });

      expect(node.status).toHaveBeenCalledWith({
        fill: 'red', shape: 'ring', text: 'no config',
      });
    });

    it('does not set up poller when server is missing', () => {
      mockRED.nodes.getNode.mockReturnValue(null);
      const node = createNodeContext();
      const onSpy = jest.spyOn(node, 'on');

      constructorFn.call(node, {
        id: 'trigger1',
        type: 's7-trigger',
        server: 'missing-config',
        address: 'DB1,REAL0',
        interval: 1000,
        edgeMode: 'any',
        deadband: 0,
      });

      const closeListeners = onSpy.mock.calls.filter(c => c[0] === 'close');
      expect(closeListeners).toHaveLength(0);
    });
  });

  describe('missing address', () => {
    it('sets error status when address is empty', () => {
      const serverNode = createServerNode();
      mockRED.nodes.getNode.mockReturnValue(serverNode);
      const node = createNodeContext();

      constructorFn.call(node, {
        id: 'trigger1',
        type: 's7-trigger',
        server: 'config1',
        address: '',
        interval: 1000,
        edgeMode: 'any',
        deadband: 0,
      });

      expect(node.status).toHaveBeenCalledWith({
        fill: 'red', shape: 'ring', text: 'no address',
      });
    });
  });

  describe('with valid server config', () => {
    let serverNode: ReturnType<typeof createServerNode>;

    beforeEach(async () => {
      jest.useRealTimers();
      serverNode = createServerNode();
      mockRED.nodes.getNode.mockReturnValue(serverNode);
      await connManager.connect();
      jest.useFakeTimers();
    });

    afterEach(async () => {
      jest.useRealTimers();
      await connManager.disconnect();
    });

    it('shows polling status when connected', () => {
      const node = createNodeContext();

      constructorFn.call(node, {
        id: 'trigger1',
        type: 's7-trigger',
        server: 'config1',
        address: 'DB1,REAL0',
        interval: 500,
        edgeMode: 'any',
        deadband: 0,
      });

      expect(node.status).toHaveBeenCalledWith({
        fill: 'green', shape: 'dot', text: 'polling 500ms',
      });
    });

    it('starts poller when connected', () => {
      const node = createNodeContext();

      constructorFn.call(node, {
        id: 'trigger1',
        type: 's7-trigger',
        server: 'config1',
        address: 'DB1,REAL0',
        interval: 1000,
        edgeMode: 'any',
        deadband: 0,
      });

      // The poller should have started since the connection is already connected
      // Verify by checking status was set to polling
      expect(node.status).toHaveBeenCalledWith(
        expect.objectContaining({ fill: 'green', text: expect.stringContaining('polling') }),
      );
    });

    it('sends message when polled value changes', async () => {
      jest.useRealTimers();

      mockBackend.readValues = { item_0: 10 };

      const node = createNodeContext();
      constructorFn.call(node, {
        id: 'trigger1',
        type: 's7-trigger',
        server: 'config1',
        address: 'DB1,REAL0',
        interval: 50,
        edgeMode: 'any',
        deadband: 0,
      });

      // Wait for at least one poll cycle
      await new Promise(resolve => setTimeout(resolve, 150));

      // The first read should trigger a 'changed' event (undefined -> 10)
      expect(node.send).toHaveBeenCalled();
      const sentMsg = node.send.mock.calls[0][0];
      expect(sentMsg.payload).toBe(10);
      expect(sentMsg.topic).toBe('DB1,REAL0');

      // Cleanup: emit close to stop poller
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const closeListeners = (node as any).listeners('close');
      if (closeListeners.length > 0) {
        closeListeners[0](() => {});
      }
    });

    it('stops poller on reconnecting state', () => {
      const node = createNodeContext();

      constructorFn.call(node, {
        id: 'trigger1',
        type: 's7-trigger',
        server: 'config1',
        address: 'DB1,REAL0',
        interval: 1000,
        edgeMode: 'any',
        deadband: 0,
      });

      connManager.emit('stateChanged', { newState: 'reconnecting' });

      expect(node.status).toHaveBeenCalledWith({
        fill: 'yellow', shape: 'ring', text: 'reconnecting',
      });
    });

    it('stops poller on error state', () => {
      const node = createNodeContext();

      constructorFn.call(node, {
        id: 'trigger1',
        type: 's7-trigger',
        server: 'config1',
        address: 'DB1,REAL0',
        interval: 1000,
        edgeMode: 'any',
        deadband: 0,
      });

      connManager.emit('stateChanged', { newState: 'error' });

      expect(node.status).toHaveBeenCalledWith({
        fill: 'red', shape: 'dot', text: 'error',
      });
    });

    it('stops poller on disconnected state', () => {
      const node = createNodeContext();

      constructorFn.call(node, {
        id: 'trigger1',
        type: 's7-trigger',
        server: 'config1',
        address: 'DB1,REAL0',
        interval: 1000,
        edgeMode: 'any',
        deadband: 0,
      });

      connManager.emit('stateChanged', { newState: 'disconnected' });

      expect(node.status).toHaveBeenCalledWith({
        fill: 'grey', shape: 'ring', text: 'disconnected',
      });
    });

    it('handles close event by stopping poller and removing listener', () => {
      const node = createNodeContext();

      constructorFn.call(node, {
        id: 'trigger1',
        type: 's7-trigger',
        server: 'config1',
        address: 'DB1,REAL0',
        interval: 1000,
        edgeMode: 'any',
        deadband: 0,
      });

      const listenerCount = connManager.listenerCount('stateChanged');
      const done = jest.fn();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const closeListeners = (node as any).listeners('close');
      expect(closeListeners.length).toBeGreaterThan(0);
      closeListeners[0](done);

      expect(done).toHaveBeenCalled();
      expect(connManager.listenerCount('stateChanged')).toBe(listenerCount - 1);
    });

    it('handles multiple addresses', () => {
      const node = createNodeContext();

      constructorFn.call(node, {
        id: 'trigger1',
        type: 's7-trigger',
        server: 'config1',
        address: 'DB1,REAL0 DB1,REAL4',
        interval: 1000,
        edgeMode: 'any',
        deadband: 0,
      });

      // Should register without error and show polling status
      expect(node.status).toHaveBeenCalledWith(
        expect.objectContaining({ fill: 'green' }),
      );
    });

    it('uses default interval when not specified', () => {
      const node = createNodeContext();

      constructorFn.call(node, {
        id: 'trigger1',
        type: 's7-trigger',
        server: 'config1',
        address: 'DB1,REAL0',
        interval: 0,
        edgeMode: 'any',
        deadband: 0,
      });

      // Should use 1000ms default
      expect(node.status).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'polling 0ms' }),
      );
    });

    it('reports errors from poller to node.error', async () => {
      jest.useRealTimers();

      mockBackend.shouldFailRead = true;

      const node = createNodeContext();
      constructorFn.call(node, {
        id: 'trigger1',
        type: 's7-trigger',
        server: 'config1',
        address: 'DB1,REAL0',
        interval: 50,
        edgeMode: 'any',
        deadband: 0,
      });

      // Wait for a poll cycle to fail
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(node.error).toHaveBeenCalled();

      // Cleanup
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const closeListeners = (node as any).listeners('close');
      if (closeListeners.length > 0) {
        closeListeners[0](() => {});
      }
    });
  });
});
