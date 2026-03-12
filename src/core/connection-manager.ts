import { EventEmitter } from 'events';
import { IS7Backend } from '../backend/s7-backend.interface';
import { S7ConnectionConfig, ConnectionState } from '../types/s7-connection';
import { S7ReadItem, S7ReadResult, S7WriteItem } from '../types/s7-address';
import { S7Error, S7ErrorCode } from '../utils/error-codes';

interface QueueEntry {
  execute: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export class ConnectionManager extends EventEmitter {
  private backend: IS7Backend;
  private config: S7ConnectionConfig;
  private state: ConnectionState = 'disconnected';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay: number;
  private queue: QueueEntry[] = [];
  private processing = false;
  private maxQueueSize = 100;

  constructor(backend: IS7Backend, config: S7ConnectionConfig, maxQueueSize = 100) {
    super();
    this.setMaxListeners(50);
    this.backend = backend;
    this.config = config;
    this.maxQueueSize = maxQueueSize;
    this.reconnectDelay = config.reconnectInterval ?? 1000;
  }

  /** Returns the current connection state. */
  getState(): ConnectionState {
    return this.state;
  }

  /** Establishes a connection to the PLC, scheduling reconnection on failure. */
  async connect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') return;

    this.setState('connecting');

    try {
      await this.backend.connect(this.config);
      this.setState('connected');
      this.reconnectDelay = this.config.reconnectInterval ?? 1000;
    } catch (err) {
      this.setState('error');
      this.scheduleReconnect();
      throw err;
    }
  }

  /** Disconnects from the PLC, cancelling any pending reconnect and draining the queue. */
  async disconnect(): Promise<void> {
    this.clearReconnectTimer();
    this.rejectPendingQueue();

    if (this.backend.isConnected()) {
      await this.backend.disconnect();
    }
    this.setState('disconnected');
  }

  /** Queues a read request for one or more S7 items. */
  async read(items: S7ReadItem[]): Promise<S7ReadResult[]> {
    return this.enqueue(() => this.backend.read(items)) as Promise<S7ReadResult[]>;
  }

  /** Queues a write request for one or more S7 items. */
  async write(items: S7WriteItem[]): Promise<void> {
    return this.enqueue(() => this.backend.write(items)) as Promise<void>;
  }

  /** Queues a raw memory area read from the PLC. */
  async readRawArea(area: number, dbNumber: number, start: number, length: number): Promise<Buffer> {
    return this.enqueue(() => this.backend.readRawArea(area, dbNumber, start, length)) as Promise<Buffer>;
  }

  /** Returns the underlying S7 backend instance. */
  getBackend(): IS7Backend {
    return this.backend;
  }

  private enqueue(execute: () => Promise<unknown>): Promise<unknown> {
    if (this.state !== 'connected') {
      return Promise.reject(new S7Error(S7ErrorCode.DISCONNECTED, 'Not connected'));
    }

    if (this.queue.length >= this.maxQueueSize) {
      return Promise.reject(new S7Error(S7ErrorCode.QUEUE_FULL, 'Request queue is full'));
    }

    return new Promise((resolve, reject) => {
      this.queue.push({ execute, resolve, reject });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const entry = this.queue.shift();
      if (!entry) break;
      try {
        const timeoutMs = this.config.requestTimeout ?? 3000;
        const result = await Promise.race([
          entry.execute(),
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(new S7Error(S7ErrorCode.REQUEST_TIMEOUT, 'Request timed out')), timeoutMs);
          }),
        ]);
        entry.resolve(result);
      } catch (err) {
        entry.reject(err);
        if (this.isConnectionError(err)) {
          this.handleConnectionLoss();
          break;
        }
      }
    }

    this.processing = false;
  }

  private handleConnectionLoss(): void {
    this.setState('reconnecting');
    this.rejectPendingQueue();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();

    this.reconnectTimer = setTimeout(async () => {
      try {
        this.setState('connecting');
        await this.backend.connect(this.config);
        this.setState('connected');
        this.reconnectDelay = this.config.reconnectInterval ?? 1000;
      } catch {
        this.setState('error');
        // Exponential backoff
        const maxDelay = this.config.maxReconnectInterval ?? 30000;
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, maxDelay);
        this.scheduleReconnect();
      }
    }, this.reconnectDelay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private rejectPendingQueue(): void {
    const pending = this.queue.splice(0);
    for (const entry of pending) {
      entry.reject(new S7Error(S7ErrorCode.DISCONNECTED, 'Connection lost'));
    }
    this.processing = false;
  }

  private setState(newState: ConnectionState): void {
    const oldState = this.state;
    this.state = newState;
    if (oldState !== newState) {
      this.emit('stateChanged', { oldState, newState });
    }
  }

  private isConnectionError(err: unknown): boolean {
    if (err instanceof S7Error) {
      return (
        err.code === S7ErrorCode.CONNECTION_FAILED ||
        err.code === S7ErrorCode.DISCONNECTED ||
        err.code === S7ErrorCode.CONNECTION_TIMEOUT ||
        err.code === S7ErrorCode.REQUEST_TIMEOUT
      );
    }
    return false;
  }
}
