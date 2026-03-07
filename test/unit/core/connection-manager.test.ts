import { ConnectionManager } from '../../../src/core/connection-manager';
import { MockBackend } from '../../helpers/mock-backend';
import { S7ConnectionConfig } from '../../../src/types/s7-connection';

describe('ConnectionManager', () => {
  let backend: MockBackend;
  let manager: ConnectionManager;
  const config: S7ConnectionConfig = {
    host: '192.168.1.100',
    port: 102,
    rack: 0,
    slot: 1,
    plcType: 'S7-1200',
    backend: 'nodes7',
    reconnectInterval: 100,
    maxReconnectInterval: 500,
  };

  beforeEach(() => {
    backend = new MockBackend();
    manager = new ConnectionManager(backend, config);
  });

  afterEach(async () => {
    await manager.disconnect();
  });

  it('starts in disconnected state', () => {
    expect(manager.getState()).toBe('disconnected');
  });

  it('connects successfully', async () => {
    await manager.connect();
    expect(manager.getState()).toBe('connected');
    expect(backend.connectCalls.length).toBe(1);
  });

  it('emits stateChanged events', async () => {
    const states: string[] = [];
    manager.on('stateChanged', ({ newState }) => states.push(newState));

    await manager.connect();
    expect(states).toContain('connecting');
    expect(states).toContain('connected');
  });

  it('handles connection failure', async () => {
    backend.shouldFailConnect = true;
    await expect(manager.connect()).rejects.toThrow('Connection failed');
    expect(manager.getState()).toBe('error');
  });

  it('reads through queue when connected', async () => {
    backend.readValues = { item_0: 42 };
    await manager.connect();

    const items = [
      {
        name: 'item_0',
        address: {
          area: 'DB' as const,
          dbNumber: 1,
          dataType: 'REAL' as const,
          offset: 0,
          bitOffset: 0,
        },
      },
    ];

    const results = await manager.read(items);
    expect(results[0].value).toBe(42);
  });

  it('rejects read when disconnected', async () => {
    const items = [
      {
        name: 'item_0',
        address: {
          area: 'DB' as const,
          dbNumber: 1,
          dataType: 'REAL' as const,
          offset: 0,
          bitOffset: 0,
        },
      },
    ];

    await expect(manager.read(items)).rejects.toThrow('Not connected');
  });

  it('writes through queue when connected', async () => {
    await manager.connect();

    const items = [
      {
        name: 'item_0',
        address: {
          area: 'DB' as const,
          dbNumber: 1,
          dataType: 'REAL' as const,
          offset: 0,
          bitOffset: 0,
        },
        value: 3.14,
      },
    ];

    await manager.write(items);
    expect(backend.writeCalls.length).toBe(1);
  });

  it('disconnects cleanly', async () => {
    await manager.connect();
    await manager.disconnect();
    expect(manager.getState()).toBe('disconnected');
    expect(backend.connected).toBe(false);
  });

  it('does not reconnect after manual disconnect', async () => {
    await manager.connect();
    await manager.disconnect();

    // Wait to confirm no reconnect attempt
    await new Promise((r) => setTimeout(r, 200));
    expect(manager.getState()).toBe('disconnected');
    expect(backend.connectCalls.length).toBe(1);
  });

  it('schedules reconnect on connection failure', async () => {
    backend.shouldFailConnect = true;

    try {
      await manager.connect();
    } catch {
      // expected
    }

    expect(manager.getState()).toBe('error');

    // Let reconnect attempt happen
    backend.shouldFailConnect = false;
    await new Promise((r) => setTimeout(r, 300));
    expect(manager.getState()).toBe('connected');
  });

  it('serializes concurrent reads', async () => {
    let concurrentReads = 0;
    let maxConcurrentReads = 0;

    const originalRead = backend.read.bind(backend);
    backend.read = async (items) => {
      concurrentReads++;
      maxConcurrentReads = Math.max(maxConcurrentReads, concurrentReads);
      await new Promise((r) => setTimeout(r, 50));
      const result = await originalRead(items);
      concurrentReads--;
      return result;
    };

    await manager.connect();

    const items = [
      {
        name: 'item_0',
        address: {
          area: 'DB' as const,
          dbNumber: 1,
          dataType: 'INT' as const,
          offset: 0,
          bitOffset: 0,
        },
      },
    ];

    await Promise.all([manager.read(items), manager.read(items), manager.read(items)]);

    expect(maxConcurrentReads).toBe(1);
  });
});
