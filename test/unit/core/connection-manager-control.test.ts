import { ConnectionManager } from '../../../src/core/connection-manager';
import { MockBackend } from '../../helpers/mock-backend';
import { S7ConnectionConfig } from '../../../src/types/s7-connection';
import { S7Error, S7ErrorCode } from '../../../src/utils/error-codes';

// connect / disconnect / reconnect / status as driven by msg.action, and Auto connect off
describe('ConnectionManager - connection control', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const config: S7ConnectionConfig = {
    host: '192.168.1.100',
    port: 102,
    rack: 0,
    slot: 1,
    plcType: 'S7-1200',
    backend: 'nodes7',
    reconnectInterval: 50,
    maxReconnectInterval: 200,
    healthCheckInterval: 0,
  };
  let backend: MockBackend;
  let manager: ConnectionManager;

  beforeEach(() => {
    backend = new MockBackend();
    manager = new ConnectionManager(backend, config);
  });

  afterEach(async () => {
    await manager.disconnect();
  });

  describe('getStatus()', () => {
    it('starts disconnected with no error', () => {
      expect(manager.getStatus()).toEqual({
        state: 'disconnected', since: expect.any(Number), lastError: null, lastErrorAt: null,
      });
    });

    it('records when the state changed and keeps the last error after recovering', async () => {
      backend.shouldFailConnect = true;
      const before = Date.now();
      await expect(manager.connect()).rejects.toThrow('Connection failed');
      const failed = manager.getStatus();
      expect(failed.state).toBe('error');
      expect(failed.lastError).toBe('Connection failed');
      expect(failed.lastErrorAt).toBeGreaterThanOrEqual(before);

      backend.shouldFailConnect = false;
      await manager.connect();
      const status = manager.getStatus();
      expect(status.state).toBe('connected');
      expect(status.since).toBeGreaterThanOrEqual(failed.since);
      expect(status.lastError).toBe('Connection failed');
    });
  });

  describe('connect()', () => {
    it('waits for an attempt already in flight instead of starting another', async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      const realConnect = backend.connect.bind(backend);
      backend.connect = async (cfg) => { await gate; return realConnect(cfg); };

      const first = manager.connect();
      const second = manager.connect();
      let secondDone = false;
      second.then(() => { secondDone = true; });
      await sleep(10);
      expect(secondDone).toBe(false); // used to resolve at once while still connecting

      release();
      await Promise.all([first, second]);
      expect(manager.getState()).toBe('connected');
      expect(backend.connectCalls).toHaveLength(1);
    });

    it('brings a pending retry forward', async () => {
      manager = new ConnectionManager(backend, { ...config, reconnectInterval: 10000 });
      backend.shouldFailConnect = true;
      await expect(manager.connect()).rejects.toThrow();
      backend.shouldFailConnect = false;

      await manager.connect(); // without waiting 10 s for the scheduled retry
      expect(manager.getState()).toBe('connected');
      expect(backend.connectCalls).toHaveLength(2);
    });
  });

  describe('reconnect()', () => {
    it('drops the connection and connects again', async () => {
      await manager.connect();
      const disconnect = jest.spyOn(backend, 'disconnect');
      const states: string[] = [];
      manager.on('stateChanged', ({ newState }) => states.push(newState));

      await manager.reconnect();
      expect(disconnect).toHaveBeenCalled();
      expect(states).toEqual(['disconnected', 'connecting', 'connected']);
      expect(backend.connectCalls).toHaveLength(2);
    });

    it('connects when disconnected, and keeps retrying when it fails', async () => {
      backend.shouldFailConnect = true;
      await expect(manager.reconnect()).rejects.toThrow('Connection failed');
      expect(manager.getState()).toBe('error');

      backend.shouldFailConnect = false;
      await sleep(120);
      expect(manager.getState()).toBe('connected');
    });

    it('waits for an attempt in flight to end before connecting again', async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      const realConnect = backend.connect.bind(backend);
      backend.connect = async (cfg) => { await gate; return realConnect(cfg); };

      const first = manager.connect();
      const again = manager.reconnect();
      await sleep(10);
      release();
      await first;
      await again;
      expect(manager.getState()).toBe('connected');
    });

    // A request still in flight when the connection is replaced can fail later: on the real PLC,
    // the old snap7 client reported "Connection timed out" about 3 s after the reconnect
    describe('a request in flight on the connection it replaces', () => {
      const inFlight = () => {
        const pending: { resolve?: (v: unknown) => void; reject?: (e: unknown) => void } = {};
        const realRead = backend.read.bind(backend);
        let first = true;
        backend.read = (items) => {
          if (!first) return realRead(items);
          first = false;
          return new Promise((resolve, reject) => Object.assign(pending, { resolve, reject }));
        };
        return pending;
      };

      it('does not take down the new connection when it fails late', async () => {
        await manager.connect();
        const pending = inFlight();
        const reading = manager.read([]);
        await sleep(5);
        await manager.reconnect();
        const states: string[] = [];
        manager.on('stateChanged', ({ newState }) => states.push(newState));

        pending.reject!(new S7Error(S7ErrorCode.DISCONNECTED, 'snap7 read failed: Connection timed out'));
        await expect(reading).rejects.toThrow('Connection timed out');
        await sleep(100);
        expect(states).toEqual([]);
        expect(manager.getState()).toBe('connected');
        expect(manager.getStatus().lastError).toBeNull();
        // The new connection keeps working
        await expect(manager.read([])).resolves.toEqual([]);
      });

      it('passes on a late success, and leaves the new queue to the new connection', async () => {
        await manager.connect();
        const pending = inFlight();
        const stale = manager.read([]);
        await sleep(5);
        await manager.reconnect();
        const fresh = manager.read([]);
        pending.resolve!([]);
        await expect(stale).resolves.toEqual([]);
        await expect(fresh).resolves.toEqual([]);
        expect(manager.getState()).toBe('connected');
      });

      it('still treats a failure on the current connection as a lost link', async () => {
        await manager.connect();
        const pending = inFlight();
        const reading = manager.read([]);
        pending.reject!(new S7Error(S7ErrorCode.DISCONNECTED, 'Connection lost'));
        await expect(reading).rejects.toThrow('Connection lost');
        expect(manager.getState()).toBe('reconnecting');
      });
    });
  });

  describe('with autoReconnect off (Auto connect off)', () => {
    beforeEach(() => {
      manager = new ConnectionManager(backend, { ...config, autoReconnect: false });
    });

    it('does not retry a failed connect', async () => {
      backend.shouldFailConnect = true;
      await expect(manager.connect()).rejects.toThrow();
      backend.shouldFailConnect = false;

      await sleep(150);
      expect(manager.getState()).toBe('error');
      expect(backend.connectCalls).toHaveLength(1);

      await manager.connect();
      expect(manager.getState()).toBe('connected');
    });

    it('leaves a lost link down until connect() is called', async () => {
      manager = new ConnectionManager(backend, { ...config, autoReconnect: false, healthCheckInterval: 20 });
      await manager.connect();
      const disconnect = jest.spyOn(backend, 'disconnect');
      backend.connected = false; // the PLC went away

      await sleep(150);
      expect(manager.getState()).toBe('error');
      expect(manager.getStatus().lastError).toBe('Connection lost');
      expect(disconnect).toHaveBeenCalled(); // the backend dropped its socket
      expect(backend.connectCalls).toHaveLength(1);

      await manager.connect();
      expect(manager.getState()).toBe('connected');
    });
  });
});
