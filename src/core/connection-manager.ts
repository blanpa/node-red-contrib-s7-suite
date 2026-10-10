import { EventEmitter } from 'events';
import { IS7Backend } from '../backend/s7-backend.interface';
import { S7ConnectionConfig, ConnectionState, ConnectionStatus } from '../types/s7-connection';
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
  private manualDisconnect = false;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private healthCheckInterval: number;
  private lastActivity = 0;
  // The connect attempt in progress, from connect() or a scheduled reconnect
  private inflight: Promise<void> | null = null;
  // The backend clean-up after a lost link when nothing will retry
  private cleanup: Promise<void> | null = null;
  private stateSince = Date.now();
  // Bumped whenever the connection stops being connected. A request sent on an earlier connection
  // can still fail later (its socket is gone), and that says nothing about the current one.
  private epoch = 0;
  private lastError: string | null = null;
  private lastErrorAt: number | null = null;

  constructor(backend: IS7Backend, config: S7ConnectionConfig, maxQueueSize = 100) {
    super();
    this.setMaxListeners(50);
    this.backend = backend;
    this.config = config;
    this.maxQueueSize = maxQueueSize;
    this.reconnectDelay = config.reconnectInterval ?? 1000;
    this.healthCheckInterval = config.healthCheckInterval ?? 2000;
  }

  /** Returns the current connection state. */
  getState(): ConnectionState {
    return this.state;
  }

  /** Returns the connection state, when it began, and the most recent error. */
  getStatus(): ConnectionStatus {
    return { state: this.state, since: this.stateSince, lastError: this.lastError, lastErrorAt: this.lastErrorAt };
  }

  /**
   * Establishes a connection to the PLC, scheduling reconnection on failure. A pending
   * reconnect is brought forward; an attempt already in progress is waited for, not repeated.
   */
  async connect(): Promise<void> {
    if (this.state === 'connected') return;
    if (this.inflight) return this.inflight;

    this.manualDisconnect = false;
    this.clearReconnectTimer();
    this.inflight = this.attempt(false).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** Drops the connection and connects again straight away, with the reconnect backoff reset. */
  async reconnect(): Promise<void> {
    await this.disconnect();
    // An attempt that was in flight ends as disconnected; let it finish before starting afresh
    if (this.inflight) await this.inflight.catch(() => undefined);
    this.reconnectDelay = this.config.reconnectInterval ?? 1000;
    await this.connect();
  }

  /** One connect attempt. On failure it schedules the next (unless retrying is off) and rethrows. */
  private async attempt(scheduled: boolean): Promise<void> {
    this.setState('connecting');
    // A lost link's clean-up must finish first, or it could drop the new connection
    if (this.cleanup) await this.cleanup;
    try {
      await this.backend.connect(this.config);
    } catch (err) {
      this.recordError(err);
      if (this.manualDisconnect) {
        // disconnect() was called while this attempt was in flight
        this.setState('disconnected');
        throw err;
      }
      this.setState('error');
      if (scheduled) {
        // Exponential backoff
        const maxDelay = this.config.maxReconnectInterval ?? 30000;
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, maxDelay);
      }
      this.scheduleReconnect();
      throw err;
    }
    if (this.manualDisconnect) {
      // disconnect() was called while this attempt was in flight
      await this.backend.disconnect();
      this.setState('disconnected');
      return;
    }
    this.setState('connected');
    this.reconnectDelay = this.config.reconnectInterval ?? 1000;
  }

  /** Disconnects from the PLC, cancelling any pending reconnect and draining the queue. */
  async disconnect(): Promise<void> {
    this.manualDisconnect = true;
    // Before the backend is awaited, so a request failing meanwhile already counts as stale
    this.epoch++;
    this.clearReconnectTimer();
    this.rejectPendingQueue();

    // Always let the backend clean up: after a lost link isConnected() is false, but the
    // library may still hold a socket or its own reconnect timers.
    await this.backend.disconnect();
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
    const epoch = this.epoch;

    while (this.queue.length > 0) {
      const entry = this.queue.shift();
      if (!entry) break;
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeoutMs = this.config.requestTimeout ?? 3000;
        const result = await Promise.race([
          entry.execute(),
          new Promise((_resolve, reject) => {
            timeoutHandle = setTimeout(() => reject(new S7Error(S7ErrorCode.REQUEST_TIMEOUT, 'Request timed out')), timeoutMs);
          }),
        ]);
        entry.resolve(result);
        // The connection this loop worked on has gone (a reconnect, or disconnect()), which also
        // cleared the queue; leave anything queued since to the loop for the new connection
        if (epoch !== this.epoch) return;
        this.lastActivity = Date.now();
      } catch (err) {
        entry.reject(err);
        // A late failure from a connection that has since been dropped or replaced (a timeout,
        // or the old socket closing) must not take down the connection that replaced it
        if (epoch !== this.epoch) return;
        if (this.isConnectionError(err)) {
          this.recordError(err);
          this.handleConnectionLoss();
          break;
        }
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
    }

    this.processing = false;
  }

  private handleConnectionLoss(): void {
    this.rejectPendingQueue();
    if (this.config.autoReconnect === false) {
      // Nothing will retry, so the link stays down until connect(). Let the backend drop its
      // socket and any timers of its own.
      this.setState('error');
      this.cleanup = this.backend.disconnect().catch(() => undefined).then(() => {
        this.cleanup = null;
      });
      return;
    }
    this.setState('reconnecting');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.manualDisconnect || this.config.autoReconnect === false) return;
    this.clearReconnectTimer();

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.manualDisconnect || this.inflight) return;
      this.inflight = this.attempt(true).finally(() => {
        this.inflight = null;
      });
      // A failed attempt has already scheduled the next one; nobody awaits a scheduled attempt
      this.inflight.catch(() => undefined);
    }, this.reconnectDelay);
  }

  private recordError(err: unknown): void {
    this.lastError = err instanceof Error ? err.message : String(err);
    this.lastErrorAt = Date.now();
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
    if (oldState !== newState) this.stateSince = Date.now();
    if (oldState === 'connected' && newState !== 'connected') this.epoch++;
    if (newState === 'connected') {
      this.startHealthCheck();
    } else {
      this.stopHealthCheck();
    }
    if (oldState !== newState) {
      this.emit('stateChanged', { oldState, newState });
    }
  }

  /**
   * While connected and idle, check the link every healthCheckInterval ms so a lost PLC shows
   * up without waiting for the next read or write. Any successful request counts as a check.
   */
  private startHealthCheck(): void {
    if (this.healthCheckInterval <= 0 || this.healthTimer) return;
    this.lastActivity = Date.now();
    this.healthTimer = setInterval(() => this.checkHealth(), this.healthCheckInterval);
    this.healthTimer.unref?.();
  }

  private stopHealthCheck(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  private checkHealth(): void {
    if (this.state !== 'connected') return;

    // Free check (no traffic), so run it every tick
    if (!this.backend.isConnected()) {
      this.recordError(new Error('Connection lost'));
      this.handleConnectionLoss();
      return;
    }

    // Only ping when idle; a recent successful request already proves the link
    if (this.processing || this.queue.length > 0) return;
    if (Date.now() - this.lastActivity < this.healthCheckInterval) return;
    if (this.backend.ping) {
      // Goes through the queue like any request; a connection-class failure triggers the
      // usual reconnect in processQueue(). Other failures (e.g. a PLC that rejects the
      // status request) are ignored.
      this.enqueue(() => this.backend.ping!()).catch(() => undefined);
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
