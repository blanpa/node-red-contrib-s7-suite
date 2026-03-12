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
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    httpGetHandlers = {};
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
  });
});
