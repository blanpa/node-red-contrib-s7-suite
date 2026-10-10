import { EventEmitter } from 'events';
import { ConnectionManager } from '../../../src/core/connection-manager';
import { MockBackend } from '../../helpers/mock-backend';
import { S7Error, S7ErrorCode } from '../../../src/utils/error-codes';

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
    util: {
      // Node-RED resolves 'env' from flow/global env vars, then the process environment
      evaluateNodeProperty: jest.fn((value: string, type: string) => (type === 'env' ? process.env[value] : value)),
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

  describe('invalid address', () => {
    it('sets error status instead of throwing when the address cannot be parsed', () => {
      const serverNode = createServerNode();
      mockRED.nodes.getNode.mockReturnValue(serverNode);
      const node = createNodeContext();

      expect(() => {
        constructorFn.call(node, {
          id: 'trigger-bad-addr',
          type: 's7-trigger',
          server: 'config1',
          address: 'NOT_AN_ADDRESS',
          interval: 1000,
          edgeMode: 'any',
          deadband: 0,
        });
      }).not.toThrow();

      expect(node.status).toHaveBeenCalledWith({
        fill: 'red', shape: 'ring', text: 'invalid address',
      });
      expect(node.error).toHaveBeenCalledWith(expect.stringContaining('Invalid address'));
      expect(serverNode.deregisterChildNode).toHaveBeenCalled();
    });

    it('coerces interval and deadband delivered as strings by the editor', () => {
      const serverNode = createServerNode();
      mockRED.nodes.getNode.mockReturnValue(serverNode);
      const node = createNodeContext();

      expect(() => {
        constructorFn.call(node, {
          id: 'trigger-str-num',
          type: 's7-trigger',
          server: 'config1',
          address: 'DB1,REAL0',
          interval: '500',
          edgeMode: 'any',
          deadband: '0.5',
        });
      }).not.toThrow();

      expect(node.status).not.toHaveBeenCalledWith(
        expect.objectContaining({ fill: 'red' }),
      );
      node.emit('close', jest.fn());
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

    it('reports a poll that times out, though the timeout also stops the poller', async () => {
      jest.useRealTimers();
      // A timeout is a connection error: the connection manager goes to reconnecting in the same
      // tick it rejects the read, which stops the trigger's poller before the poll sees the error
      mockBackend.read = async () => {
        throw new S7Error(S7ErrorCode.REQUEST_TIMEOUT, 'Request timed out');
      };

      const node = createNodeContext();
      constructorFn.call(node, {
        id: 'trigger1', type: 's7-trigger', server: 'config1', address: 'DB1,REAL0',
        interval: 50, edgeMode: 'any', deadband: 0,
      });
      await new Promise((resolve) => setTimeout(resolve, 120));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (node as any).listeners('close')[0](() => {});

      expect(connManager.getState()).not.toBe('connected');
      expect(node.error).toHaveBeenCalledWith('Request timed out');
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
        expect.objectContaining({ text: 'polling 1000ms' }),
      );
    });

    it('has no input handler: the node has no input port', () => {
      const node = createNodeContext();
      constructorFn.call(node, { id: 'trigger1', type: 's7-trigger', server: 'config1', address: 'DB1,REAL0', interval: 1000, edgeMode: 'any', deadband: 0 });
      expect(node.listeners('input')).toHaveLength(0);
    });

    describe('interval and deadband from environment variables', () => {
      const base = { id: 'trigger1', type: 's7-trigger', server: 'config1', address: 'DB1,REAL0', edgeMode: 'any' };

      beforeEach(() => {
        process.env.S7_TRIG_INTERVAL = '2500';
        process.env.S7_TRIG_DEADBAND = '0.5';
        process.env.S7_TRIG_BAD = 'fast';
        process.env.S7_TRIG_FRACTION = '250.5';
        process.env.S7_TRIG_NEGATIVE = '-1';
        delete process.env.S7_TRIG_MISSING;
      });

      afterEach(() => {
        for (const name of ['S7_TRIG_INTERVAL', 'S7_TRIG_DEADBAND', 'S7_TRIG_BAD', 'S7_TRIG_FRACTION', 'S7_TRIG_NEGATIVE']) {
          delete process.env[name];
        }
      });

      it('reads env-typed fields from the environment', () => {
        const node = createNodeContext();
        constructorFn.call(node, {
          ...base, interval: 'S7_TRIG_INTERVAL', intervalType: 'env', deadband: 'S7_TRIG_DEADBAND', deadbandType: 'env',
        });
        expect(node.error).not.toHaveBeenCalled();
        expect(node.status).toHaveBeenCalledWith(expect.objectContaining({ text: 'polling 2500ms' }));
        node.emit('close', jest.fn());
      });

      it('keeps num-typed fields as before', () => {
        const node = createNodeContext();
        constructorFn.call(node, { ...base, interval: '750', intervalType: 'num', deadband: '0', deadbandType: 'num' });
        expect(node.status).toHaveBeenCalledWith(expect.objectContaining({ text: 'polling 750ms' }));
        node.emit('close', jest.fn());
      });

      it('stops with an error when a variable is not set, instead of using a default', () => {
        const node = createNodeContext();
        constructorFn.call(node, { ...base, interval: 'S7_TRIG_MISSING', intervalType: 'env', deadband: 0 });
        expect(node.error).toHaveBeenCalledWith(
          'Invalid setting: interval: environment variable "S7_TRIG_MISSING" is not set',
        );
        expect(node.status).toHaveBeenLastCalledWith({ fill: 'red', shape: 'ring', text: 'invalid setting' });
        expect(serverNode.deregisterChildNode).toHaveBeenCalledWith(node);
      });

      it('stops with an error when a variable is not a usable number', () => {
        for (const [interval, deadband, message] of [
          ['S7_TRIG_BAD', '0', 'interval: environment variable "S7_TRIG_BAD" is "fast", not a whole number of ms, 1 or more'],
          ['S7_TRIG_FRACTION', '0', 'interval: environment variable "S7_TRIG_FRACTION" is "250.5", not a whole number of ms, 1 or more'],
          ['S7_TRIG_INTERVAL', 'S7_TRIG_NEGATIVE', 'deadband: environment variable "S7_TRIG_NEGATIVE" is "-1", not a number, 0 or more'],
        ]) {
          const node = createNodeContext();
          constructorFn.call(node, {
            ...base, interval, intervalType: 'env', deadband, deadbandType: deadband === '0' ? 'num' : 'env',
          });
          expect(node.error).toHaveBeenCalledWith(`Invalid setting: ${message}`);
        }
      });

      it('reports both settings when both are wrong', () => {
        const node = createNodeContext();
        constructorFn.call(node, {
          ...base, interval: 'S7_TRIG_MISSING', intervalType: 'env', deadband: 'S7_TRIG_BAD', deadbandType: 'env',
        });
        expect(node.error.mock.calls[0][0]).toMatch(/^Invalid setting: interval: .*; deadband: /);
      });
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

    it('says in msg.s7 which address changed, keeping msg.oldValue', async () => {
      jest.useRealTimers();
      mockBackend.readValues = { item_0: 10, item_1: 20 };

      const node = createNodeContext();
      constructorFn.call(node, {
        id: 'trigger1', type: 's7-trigger', server: 'config1', address: 'DB1,REAL0 DB1,INT4',
        interval: 50, edgeMode: 'any', deadband: 0,
      });
      await new Promise(resolve => setTimeout(resolve, 150));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (node as any).listeners('close')[0](() => {});

      const sent = node.send.mock.calls.map((c: Array<Record<string, unknown>>) => c[0]);
      expect(sent).toHaveLength(2);
      const details = (address: string) => ({
        op: 'trigger', server: 'PLC 1', source: 'config', address,
        timestamp: expect.any(Number), durationMs: expect.any(Number),
      });
      expect(sent[0]).toMatchObject({ topic: 'DB1,REAL0', payload: 10, oldValue: undefined, s7: details('DB1,REAL0') });
      expect(sent[1]).toMatchObject({ topic: 'DB1,INT4', payload: 20, s7: details('DB1,INT4') });
      expect('oldValue' in sent[0]).toBe(true);
      expect(sent[0].s7).toEqual(details('DB1,REAL0'));
    });

    it('times a slow read from its own start, not from a poll that started while it waited', async () => {
      jest.useRealTimers();
      // The first read takes 250 ms; polls keep starting every 50 ms behind it
      let calls = 0;
      const realRead = mockBackend.read.bind(mockBackend);
      mockBackend.read = async (items) => {
        calls++;
        if (calls === 1) await new Promise((resolve) => setTimeout(resolve, 250));
        return realRead(items);
      };
      mockBackend.readValues = { item_0: 10 };

      const node = createNodeContext();
      constructorFn.call(node, {
        id: 'trigger1', type: 's7-trigger', server: 'config1', address: 'DB1,REAL0',
        interval: 50, edgeMode: 'any', deadband: 0,
      });
      await new Promise((resolve) => setTimeout(resolve, 400));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (node as any).listeners('close')[0](() => {});

      // Only the first read changes the value, so there is one message, timed from that read's start
      expect(node.send).toHaveBeenCalledTimes(1);
      expect(node.send.mock.calls[0][0].s7.durationMs).toBeGreaterThanOrEqual(240);
    });
  });
});
