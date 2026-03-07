import { ConnectionManager } from '../../../src/core/connection-manager';
import { MockBackend } from '../../helpers/mock-backend';
import { S7ConnectionConfig } from '../../../src/types/s7-connection';
import { S7Error, S7ErrorCode } from '../../../src/utils/error-codes';

describe('ConnectionManager - extra coverage', () => {
  let backend: MockBackend;
  let manager: ConnectionManager;
  const config: S7ConnectionConfig = {
    host: '192.168.1.100',
    port: 102,
    rack: 0,
    slot: 1,
    plcType: 'S7-1200',
    backend: 'nodes7',
    reconnectInterval: 50,
    maxReconnectInterval: 200,
  };

  beforeEach(() => {
    backend = new MockBackend();
    manager = new ConnectionManager(backend, config);
  });

  afterEach(async () => {
    await manager.disconnect();
  });

  it('does nothing when already connected', async () => {
    await manager.connect();
    await manager.connect(); // second call should be no-op
    expect(backend.connectCalls.length).toBe(1);
  });

  it('rejects write when disconnected', async () => {
    await expect(
      manager.write([{
        name: 'x',
        address: { area: 'DB', dbNumber: 1, dataType: 'INT', offset: 0, bitOffset: 0 },
        value: 1,
      }]),
    ).rejects.toThrow('Not connected');
  });

  it('rejects readRawArea when disconnected', async () => {
    await expect(manager.readRawArea(0x84, 1, 0, 4)).rejects.toThrow('Not connected');
  });

  it('readRawArea works when connected', async () => {
    backend.rawAreaData.set('132:1:0:4', Buffer.from([0, 0, 0, 0]));
    await manager.connect();
    const buf = await manager.readRawArea(0x84, 1, 0, 4);
    expect(buf.length).toBe(4);
  });

  it('returns backend via getBackend', () => {
    expect(manager.getBackend()).toBe(backend);
  });

  it('handles connection error during read and reconnects', async () => {
    await manager.connect();

    // Make read throw a connection error
    backend.read = async () => {
      throw new S7Error(S7ErrorCode.CONNECTION_FAILED, 'Connection lost');
    };

    await expect(
      manager.read([{
        name: 'x',
        address: { area: 'DB', dbNumber: 1, dataType: 'INT', offset: 0, bitOffset: 0 },
      }]),
    ).rejects.toThrow('Connection lost');

    expect(manager.getState()).toBe('reconnecting');

    // Allow reconnect
    backend.read = new MockBackend().read.bind(new MockBackend());
    await new Promise((r) => setTimeout(r, 200));
    expect(manager.getState()).toBe('connected');
  });

  it('rejects pending queue items when connection is lost', async () => {
    await manager.connect();

    // Slow read + connection error
    let callCount = 0;
    backend.read = async () => {
      callCount++;
      if (callCount === 1) {
        await new Promise((r) => setTimeout(r, 50));
        throw new S7Error(S7ErrorCode.DISCONNECTED, 'Disconnected');
      }
      return [];
    };

    const item = {
      name: 'x',
      address: { area: 'DB' as const, dbNumber: 1, dataType: 'INT' as const, offset: 0, bitOffset: 0 },
    };

    const p1 = manager.read([item]);
    const p2 = manager.read([item]);

    await expect(p1).rejects.toThrow();
    await expect(p2).rejects.toThrow('Connection lost');
  });

  it('handles non-S7Error during read without triggering reconnect', async () => {
    await manager.connect();

    backend.read = async () => {
      throw new Error('Generic error');
    };

    await expect(
      manager.read([{
        name: 'x',
        address: { area: 'DB', dbNumber: 1, dataType: 'INT', offset: 0, bitOffset: 0 },
      }]),
    ).rejects.toThrow('Generic error');

    // State should still be connected (not reconnecting)
    expect(manager.getState()).toBe('connected');
  });

  it('handles queue full scenario', async () => {
    await manager.connect();

    // Block the first read so the queue fills up
    let resolveFirst: (() => void) | null = null;
    let callCount = 0;
    backend.read = async (items) => {
      callCount++;
      if (callCount === 1) {
        await new Promise<void>((r) => { resolveFirst = r; });
      }
      return items.map((i) => ({
        name: i.name,
        address: i.address,
        value: 0,
        quality: 'good' as const,
        timestamp: Date.now(),
      }));
    };

    const item = {
      name: 'x',
      address: { area: 'DB' as const, dbNumber: 1, dataType: 'INT' as const, offset: 0, bitOffset: 0 },
    };

    // Fill queue (100 items + 1 processing = 101, so 102 should overflow)
    const promises = [];
    for (let i = 0; i < 102; i++) {
      promises.push(manager.read([item]).catch((e) => e));
    }

    // Unblock
    resolveFirst!();

    const results = await Promise.all(promises);
    const queueFullErrors = results.filter(
      (r) => r instanceof S7Error && r.code === S7ErrorCode.QUEUE_FULL,
    );
    expect(queueFullErrors.length).toBeGreaterThan(0);
  });
});
