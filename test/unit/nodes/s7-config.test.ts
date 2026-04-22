import { EventEmitter } from 'events';
import { ConnectionManager } from '../../../src/core/connection-manager';
import { MockBackend } from '../../helpers/mock-backend';

// Mock the backend-factory module
jest.mock('../../../src/backend/backend-factory', () => ({
  createBackend: jest.fn(() => new MockBackend()),
  isSnap7Available: jest.fn(() => false),
}));

import { createBackend } from '../../../src/backend/backend-factory';

// Import the node module (it exports a function that takes RED)
import s7ConfigModule = require('../../../src/nodes/s7-config/s7-config');

describe('s7-config node', () => {
  let registeredType: string;
  let constructorFn: Function;
  let httpGetHandlers: Record<string, Function>;
  let httpPostHandlers: Record<string, Function>;

  // Mock RED API
  const mockRED = {
    nodes: {
      createNode: jest.fn(),
      registerType: jest.fn((type: string, constructor: Function) => {
        registeredType = type;
        constructorFn = constructor;
      }),
      getNode: jest.fn(),
    },
    httpAdmin: {
      get: jest.fn((path: string, handler: Function) => {
        httpGetHandlers[path] = handler;
      }),
      post: jest.fn((path: string, handler: Function) => {
        httpPostHandlers[path] = handler;
      }),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    httpGetHandlers = {};
    httpPostHandlers = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    s7ConfigModule(mockRED as any);
  });

  it('registers the s7-config type', () => {
    expect(registeredType).toBe('s7-config');
    expect(mockRED.nodes.registerType).toHaveBeenCalledWith('s7-config', expect.any(Function), { credentials: { password: { type: 'password' } } });
  });

  it('registers HTTP admin endpoints', () => {
    expect(mockRED.httpAdmin.get).toHaveBeenCalledWith('/s7-suite/snap7-available', expect.any(Function));
    expect(mockRED.httpAdmin.get).toHaveBeenCalledWith('/s7-suite/plc-defaults', expect.any(Function));
    expect(mockRED.httpAdmin.get).toHaveBeenCalledWith('/s7-suite/connection-state/:id', expect.any(Function));
    expect(mockRED.httpAdmin.get).toHaveBeenCalledWith('/s7-suite/browse/:id', expect.any(Function));
    expect(mockRED.httpAdmin.post).toHaveBeenCalledWith('/s7-suite/cfg-import', expect.any(Function));
  });

  describe('/s7-suite/cfg-import', () => {
    function invoke(body: unknown): { status: number; payload: unknown } {
      const handler = httpPostHandlers['/s7-suite/cfg-import'];
      let status = 200;
      let payload: unknown = null;
      const req = { body };
      const res = {
        status(code: number) { status = code; return this; },
        json(p: unknown) { payload = p; return this; },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler(req as any, res as any);
      return { status, payload };
    }

    it('returns 400 when no content is provided', () => {
      const { status, payload } = invoke({});
      expect(status).toBe(400);
      expect((payload as { error: string }).error).toMatch(/content/);
    });

    it('parses a minimal cfg snippet into tags', () => {
      const cfg = [
        'STATION S7300 , "Demo"',
        'DPSUBSYSTEM 1, DPADDRESS 10, SLOT 7, "75x-430 8DI/24V DC", "8DE"',
        'LOCAL_IN_ADDRESSES ',
        '  ADDRESS  0, 0, 1, 0, 2, 0',
        'SYMBOL  I , 3, "NA_INT", "Not-Aus"',
      ].join('\n');
      const { status, payload } = invoke({ content: cfg });
      expect(status).toBe(200);
      const result = payload as { station: { name: string }; tags: Array<{ address: string; name: string }> };
      expect(result.station.name).toBe('Demo');
      expect(result.tags).toHaveLength(1);
      expect(result.tags[0]).toMatchObject({ address: 'I0.3', name: 'NA_INT' });
    });
  });

  describe('constructor', () => {
    it('creates a config node with default values', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nodeContext: any = Object.assign(new EventEmitter(), {
        log: jest.fn(),
        error: jest.fn(),
        status: jest.fn(),
      });

      constructorFn.call(nodeContext, {
        id: 'config1',
        type: 's7-config',
        name: 'test',
        host: '192.168.1.100',
        port: 102,
        rack: 0,
        slot: 1,
        plcType: 'S7-1200',
        backend: 'nodes7',
        connectionTimeout: 5000,
        requestTimeout: 3000,
        reconnectInterval: 1000,
        maxReconnectInterval: 30000,
      });

      expect(mockRED.nodes.createNode).toHaveBeenCalledWith(nodeContext, expect.any(Object));
      expect(nodeContext.s7Config).toBeDefined();
      expect(nodeContext.s7Config.host).toBe('192.168.1.100');
      expect(nodeContext.s7Config.port).toBe(102);
      expect(nodeContext.s7Config.rack).toBe(0);
      expect(nodeContext.s7Config.slot).toBe(1);
      expect(nodeContext.s7Config.plcType).toBe('S7-1200');
      expect(nodeContext.connectionManager).toBeInstanceOf(ConnectionManager);
    });

    it('applies defaults for missing config values', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nodeContext: any = Object.assign(new EventEmitter(), {
        log: jest.fn(),
        error: jest.fn(),
        status: jest.fn(),
      });

      constructorFn.call(nodeContext, {
        id: 'config2',
        type: 's7-config',
        name: 'test',
      });

      expect(nodeContext.s7Config.host).toBe('192.168.0.1');
      expect(nodeContext.s7Config.port).toBe(102);
      expect(nodeContext.s7Config.backend).toBe('nodes7');
    });

    it('calls connect on initialization', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nodeContext: any = Object.assign(new EventEmitter(), {
        log: jest.fn(),
        error: jest.fn(),
        status: jest.fn(),
      });

      constructorFn.call(nodeContext, {
        id: 'config3',
        type: 's7-config',
        name: 'test',
        host: '192.168.1.100',
        port: 102,
        rack: 0,
        slot: 1,
        plcType: 'S7-1200',
        backend: 'nodes7',
      });

      // ConnectionManager.connect is called, wait for it
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(createBackend).toHaveBeenCalledWith('nodes7');
    });

    it('logs state changes', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nodeContext: any = Object.assign(new EventEmitter(), {
        log: jest.fn(),
        error: jest.fn(),
        status: jest.fn(),
      });

      constructorFn.call(nodeContext, {
        id: 'config4',
        type: 's7-config',
        name: 'test',
        host: '192.168.1.100',
        port: 102,
        rack: 0,
        slot: 1,
        plcType: 'S7-1200',
        backend: 'nodes7',
      });

      // Wait for async connect
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(nodeContext.log).toHaveBeenCalled();
    });

    it('handles close event by disconnecting', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nodeContext: any = Object.assign(new EventEmitter(), {
        log: jest.fn(),
        error: jest.fn(),
        status: jest.fn(),
      });

      constructorFn.call(nodeContext, {
        id: 'config5',
        type: 's7-config',
        name: 'test',
        host: '192.168.1.100',
        port: 102,
        rack: 0,
        slot: 1,
        plcType: 'S7-1200',
        backend: 'nodes7',
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const disconnectSpy = jest.spyOn(nodeContext.connectionManager, 'disconnect');
      const done = jest.fn();
      nodeContext.emit('close', done);

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(disconnectSpy).toHaveBeenCalled();
    });

    it('parses TSAP values from hex strings', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nodeContext: any = Object.assign(new EventEmitter(), {
        log: jest.fn(),
        error: jest.fn(),
        status: jest.fn(),
      });

      constructorFn.call(nodeContext, {
        id: 'config6',
        type: 's7-config',
        name: 'test',
        host: '192.168.1.100',
        port: 102,
        rack: 0,
        slot: 1,
        plcType: 'LOGO',
        backend: 'nodes7',
        localTSAP: '0100',
        remoteTSAP: '0200',
      });

      expect(nodeContext.s7Config.localTSAP).toBe(0x0100);
      expect(nodeContext.s7Config.remoteTSAP).toBe(0x0200);
    });
  });

  describe('HTTP admin endpoints', () => {
    it('/s7-suite/snap7-available returns availability', () => {
      const handler = httpGetHandlers['/s7-suite/snap7-available'];
      const res = { json: jest.fn() };
      handler({}, res);
      expect(res.json).toHaveBeenCalledWith({ available: false });
    });

    it('/s7-suite/plc-defaults returns default slots', () => {
      const handler = httpGetHandlers['/s7-suite/plc-defaults'];
      const res = { json: jest.fn() };
      handler({}, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        'S7-1200': 1,
        'S7-300': 2,
        'S7-400': 3,
      }));
    });

    it('/s7-suite/connection-state/:id returns unknown for missing node', () => {
      const handler = httpGetHandlers['/s7-suite/connection-state/:id'];
      mockRED.nodes.getNode.mockReturnValue(null);
      const res = { json: jest.fn() };
      handler({ params: { id: 'nonexistent' } }, res);
      expect(res.json).toHaveBeenCalledWith({ state: 'unknown' });
    });

    it('/s7-suite/connection-state/:id returns state for valid node', () => {
      const handler = httpGetHandlers['/s7-suite/connection-state/:id'];
      const mockBackend = new MockBackend();
      const connMgr = new ConnectionManager(mockBackend, {
        host: '192.168.1.100', port: 102, rack: 0, slot: 1,
        plcType: 'S7-1200' as const, backend: 'nodes7' as const,
      });
      mockRED.nodes.getNode.mockReturnValue({ connectionManager: connMgr });
      const res = { json: jest.fn() };
      handler({ params: { id: 'config1' } }, res);
      expect(res.json).toHaveBeenCalledWith({ state: 'disconnected' });
    });

    it('/s7-suite/browse/:id returns 404 for missing node', async () => {
      const handler = httpGetHandlers['/s7-suite/browse/:id'];
      mockRED.nodes.getNode.mockReturnValue(null);
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await handler({ params: { id: 'nonexistent' } }, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('/s7-suite/browse/:id returns 503 when not connected', async () => {
      const handler = httpGetHandlers['/s7-suite/browse/:id'];
      const mockBackend = new MockBackend();
      const connMgr = new ConnectionManager(mockBackend, {
        host: '192.168.1.100', port: 102, rack: 0, slot: 1,
        plcType: 'S7-1200' as const, backend: 'nodes7' as const,
      });
      mockRED.nodes.getNode.mockReturnValue({
        connectionManager: connMgr,
        s7Config: { backend: 'nodes7' },
      });
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await handler({ params: { id: 'config1' } }, res);
      expect(res.status).toHaveBeenCalledWith(503);
    });

    describe('browse endpoint when connected', () => {
      let handler: Function;
      let mockBackend: MockBackend;
      let connMgr: ConnectionManager;

      beforeEach(async () => {
        handler = httpGetHandlers['/s7-suite/browse/:id'];
        mockBackend = new MockBackend();
        connMgr = new ConnectionManager(mockBackend, {
          host: '192.168.1.100', port: 102, rack: 0, slot: 1,
          plcType: 'S7-1200' as const, backend: 'nodes7' as const,
          requestTimeout: 3000,
        });
        await connMgr.connect();
      });

      afterEach(async () => {
        await connMgr.disconnect();
      });

      it('browses with snap7 backend using listBlocksOfType and getBlockInfo', async () => {
        mockBackend.blockNumbers['DB'] = [1];
        mockBackend.blockInfos.set('DB:1', {
          blockType: 'DB',
          blockNumber: 1,
          sizeData: 4,
        });
        // Raw area data for DB1 (area 0x84, dbNumber 1)
        const dbBuf = Buffer.alloc(4);
        dbBuf.writeFloatBE(3.14, 0);
        mockBackend.rawAreaData.set('132:1:0:4', dbBuf);
        // Merker area fails (no access)
        // Inputs area fails (no access)
        // Outputs area fails (no access)

        mockRED.nodes.getNode.mockReturnValue({
          connectionManager: connMgr,
          s7Config: { backend: 'snap7' },
        });

        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        await handler({ params: { id: 'config1' } }, res);

        expect(res.json).toHaveBeenCalled();
        const result = res.json.mock.calls[0][0];
        expect(result.addresses).toBeDefined();
        expect(result.addresses.length).toBeGreaterThan(0);
        // DB1 with 4 bytes should have REAL, DINT, INT, WORD, BYTE, BOOL addresses
        const db1Addresses = result.addresses.filter((a: any) => a.address.startsWith('DB1,'));
        expect(db1Addresses.length).toBeGreaterThan(0);
        expect(db1Addresses.some((a: any) => a.type === 'REAL')).toBe(true);
        expect(db1Addresses.some((a: any) => a.type === 'BYTE')).toBe(true);
      });

      it('browses with nodes7 backend using probe-based approach', async () => {
        // DB1 exists: area 0x84 (132), dbNumber 1
        const dbBuf = Buffer.alloc(4);
        dbBuf.writeInt16BE(42, 0);
        mockBackend.rawAreaData.set('132:1:0:4', dbBuf);

        // Merker area: area 0x83 (131), dbNumber 0
        const merkerBuf = Buffer.alloc(32);
        merkerBuf.writeUInt8(0xFF, 0);
        mockBackend.rawAreaData.set('131:0:0:32', merkerBuf);

        // Input area: area 0x81 (129), dbNumber 0
        const inputBuf = Buffer.alloc(8);
        inputBuf.writeUInt8(0xAA, 0);
        mockBackend.rawAreaData.set('129:0:0:8', inputBuf);

        // Output area: area 0x82 (130), dbNumber 0
        const outputBuf = Buffer.alloc(8);
        outputBuf.writeUInt8(0x55, 0);
        mockBackend.rawAreaData.set('130:0:0:8', outputBuf);

        mockRED.nodes.getNode.mockReturnValue({
          connectionManager: connMgr,
          s7Config: { backend: 'nodes7' },
        });

        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        await handler({ params: { id: 'config1' } }, res);

        expect(res.json).toHaveBeenCalled();
        const result = res.json.mock.calls[0][0];
        expect(result.addresses).toBeDefined();
        expect(result.addresses.length).toBeGreaterThan(0);

        // Should have DB addresses
        const dbAddresses = result.addresses.filter((a: any) => a.address.startsWith('DB1,'));
        expect(dbAddresses.length).toBeGreaterThan(0);

        // Should have Merker addresses
        const merkerAddresses = result.addresses.filter((a: any) => a.info === 'Merker');
        expect(merkerAddresses.length).toBeGreaterThan(0);
        expect(merkerAddresses.some((a: any) => a.address.startsWith('MB'))).toBe(true);
        expect(merkerAddresses.some((a: any) => a.address.startsWith('MW'))).toBe(true);
        expect(merkerAddresses.some((a: any) => a.address.startsWith('M') && a.type === 'BOOL')).toBe(true);

        // Should have Input addresses
        const inputAddresses = result.addresses.filter((a: any) => a.info === 'Input');
        expect(inputAddresses.length).toBeGreaterThan(0);
        expect(inputAddresses.some((a: any) => a.address.startsWith('IB'))).toBe(true);

        // Should have Output addresses
        const outputAddresses = result.addresses.filter((a: any) => a.info === 'Output');
        expect(outputAddresses.length).toBeGreaterThan(0);
        expect(outputAddresses.some((a: any) => a.address.startsWith('QB'))).toBe(true);
      });

      it('browses with nodes7 and reads current values from PLC', async () => {
        // DB1 with 4 bytes containing a REAL value
        const dbBuf = Buffer.alloc(4);
        dbBuf.writeFloatBE(1.5, 0);
        mockBackend.rawAreaData.set('132:1:0:4', dbBuf);

        mockRED.nodes.getNode.mockReturnValue({
          connectionManager: connMgr,
          s7Config: { backend: 'nodes7' },
        });

        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        await handler({ params: { id: 'config1' } }, res);

        const result = res.json.mock.calls[0][0];
        // Find the REAL address and check its value was read
        const realAddr = result.addresses.find((a: any) => a.address === 'DB1,REAL0');
        expect(realAddr).toBeDefined();
        expect(realAddr.value).toBeCloseTo(1.5, 1);
      });

      it('browse returns 500 when an unexpected error occurs', async () => {
        // Make getBackend throw an error to hit the catch block on line 240
        const failConnMgr = new ConnectionManager(mockBackend, {
          host: '192.168.1.100', port: 102, rack: 0, slot: 1,
          plcType: 'S7-1200' as const, backend: 'nodes7' as const,
        });
        await failConnMgr.connect();

        // Override getBackend to throw
        jest.spyOn(failConnMgr, 'getBackend').mockImplementation(() => {
          throw new Error('Unexpected backend error');
        });

        mockRED.nodes.getNode.mockReturnValue({
          connectionManager: failConnMgr,
          s7Config: { backend: 'nodes7' },
        });

        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        await handler({ params: { id: 'config1' } }, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ error: 'Unexpected backend error' });

        await failConnMgr.disconnect();
      });

      it('browse returns 500 with stringified error for non-Error throws', async () => {
        const failConnMgr = new ConnectionManager(mockBackend, {
          host: '192.168.1.100', port: 102, rack: 0, slot: 1,
          plcType: 'S7-1200' as const, backend: 'nodes7' as const,
        });
        await failConnMgr.connect();

        jest.spyOn(failConnMgr, 'getBackend').mockImplementation(() => {
          throw 'string error';  // eslint-disable-line no-throw-literal
        });

        mockRED.nodes.getNode.mockReturnValue({
          connectionManager: failConnMgr,
          s7Config: { backend: 'nodes7' },
        });

        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        await handler({ params: { id: 'config1' } }, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ error: 'string error' });

        await failConnMgr.disconnect();
      });
    });
  });

  describe('registerChildNode / deregisterChildNode', () => {
    it('registers and deregisters child nodes', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nodeContext: any = Object.assign(new EventEmitter(), {
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        status: jest.fn(),
      });

      constructorFn.call(nodeContext, {
        id: 'config-child-test',
        type: 's7-config',
        name: 'test',
        host: '192.168.1.100',
        port: 102,
        rack: 0,
        slot: 1,
        plcType: 'S7-1200',
        backend: 'nodes7',
      });

      expect(nodeContext.registerChildNode).toBeDefined();
      expect(nodeContext.deregisterChildNode).toBeDefined();

      // Should not throw when registering/deregistering
      const childNode = { id: 'child1' } as any;
      nodeContext.registerChildNode(childNode);
      nodeContext.deregisterChildNode(childNode);
      // Deregistering again should not throw
      nodeContext.deregisterChildNode(childNode);
    });
  });

  describe('connect failure', () => {
    it('logs error when connect fails', async () => {
      // Make the mock backend fail on connect
      (createBackend as jest.Mock).mockReturnValueOnce((() => {
        const mb = new MockBackend();
        mb.shouldFailConnect = true;
        return mb;
      })());

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nodeContext: any = Object.assign(new EventEmitter(), {
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        status: jest.fn(),
      });

      constructorFn.call(nodeContext, {
        id: 'config-fail',
        type: 's7-config',
        name: 'test',
        host: '192.168.1.100',
        port: 102,
        rack: 0,
        slot: 1,
        plcType: 'S7-1200',
        backend: 'nodes7',
      });

      // Wait for the async connect rejection to be handled
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(nodeContext.error).toHaveBeenCalledWith(
        expect.stringContaining('Connection failed'),
      );
    });
  });
});
