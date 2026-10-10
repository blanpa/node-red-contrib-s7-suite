import { EventEmitter } from 'events';

export type EdgeMode = 'any' | 'rising' | 'falling';

export interface PollerConfig {
  interval: number;
  edgeMode: EdgeMode;
  deadband: number;
}

export interface PollerItem {
  name: string;
  // Every value read, so an edge is measured from the previous read
  lastSeen?: unknown;
  // The value last sent, so a deadband is measured from it and a slow drift still fires
  lastEmitted?: unknown;
}

export class Poller extends EventEmitter {
  private timer: ReturnType<typeof setInterval> | null = null;
  private items: Map<string, PollerItem> = new Map();
  private config: PollerConfig;
  private readFn: (() => Promise<Map<string, unknown>>) | null = null;
  // Bumped by stop(), so values from a read still in flight when the poller stops are dropped
  private run = 0;

  constructor(config: PollerConfig) {
    super();
    this.config = config;
  }

  addItem(name: string): void {
    this.items.set(name, { name });
  }

  removeItem(name: string): void {
    this.items.delete(name);
  }

  setReadFunction(fn: () => Promise<Map<string, unknown>>): void {
    this.readFn = fn;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), this.config.interval);
  }

  stop(): void {
    this.run++;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  updateConfig(update: Partial<PollerConfig>): void {
    const restartNeeded = update.interval !== undefined && update.interval !== this.config.interval && this.isRunning();
    this.config = { ...this.config, ...update };
    if (restartNeeded) {
      clearInterval(this.timer!);
      this.timer = setInterval(() => this.poll(), this.config.interval);
    }
  }

  private async poll(): Promise<void> {
    if (!this.readFn) return;
    const run = this.run;

    try {
      const values = await this.readFn();
      if (run !== this.run) return;
      for (const [name, value] of values) {
        const item = this.items.get(name);
        if (!item) continue;

        const oldValue = typeof value === 'boolean' ? item.lastSeen : item.lastEmitted;
        item.lastSeen = value;
        if (this.hasChanged(oldValue, value)) {
          item.lastEmitted = value;
          this.emit('changed', { name, value, oldValue });
        }
      }
    } catch (err) {
      // Report the failure even if the poller has stopped: a timeout or lost link stops it (the
      // connection goes to reconnecting) in the same tick the read is rejected, and that error is
      // the one the user needs to see. Only skip it when nobody is listening: s7-trigger removes
      // its listeners on close, and an 'error' event with no listener throws, which would take
      // Node-RED down.
      if (this.listenerCount('error') > 0) this.emit('error', err);
    }
  }

  private hasChanged(oldVal: unknown, newValue: unknown): boolean {
    // First read: send the starting value, except in rising/falling mode, where a boolean's
    // first value is not an edge
    if (oldVal === undefined) {
      return typeof newValue !== 'boolean' || this.config.edgeMode === 'any';
    }

    if (typeof newValue === 'boolean' && typeof oldVal === 'boolean') {
      switch (this.config.edgeMode) {
        case 'rising':
          return !oldVal && newValue;
        case 'falling':
          return oldVal && !newValue;
        case 'any':
          return oldVal !== newValue;
      }
    }

    if (typeof newValue === 'number' && typeof oldVal === 'number') {
      if (this.config.deadband > 0) {
        return Math.abs(newValue - oldVal) >= this.config.deadband;
      }
      return newValue !== oldVal;
    }

    // LINT/ULINT when the config returns them as BigInt
    if (typeof newValue === 'bigint' && typeof oldVal === 'bigint') {
      if (this.config.deadband > 0) {
        return Math.abs(Number(newValue - oldVal)) >= this.config.deadband;
      }
      return newValue !== oldVal;
    }

    // Dates, arrays and Buffers are new objects on every read, so compare what they hold
    return !sameValue(newValue, oldVal);
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }
  if (Buffer.isBuffer(a) && Buffer.isBuffer(b)) {
    return a.equals(b);
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  }
  return a === b;
}
