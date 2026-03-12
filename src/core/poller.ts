import { EventEmitter } from 'events';

export type EdgeMode = 'any' | 'rising' | 'falling';

export interface PollerConfig {
  interval: number;
  edgeMode: EdgeMode;
  deadband: number;
}

export interface PollerItem {
  name: string;
  lastValue?: unknown;
}

export class Poller extends EventEmitter {
  private timer: ReturnType<typeof setInterval> | null = null;
  private items: Map<string, PollerItem> = new Map();
  private config: PollerConfig;
  private readFn: (() => Promise<Map<string, unknown>>) | null = null;

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
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.removeAllListeners();
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

    try {
      const values = await this.readFn();
      for (const [name, value] of values) {
        const item = this.items.get(name);
        if (!item) continue;

        const changed = this.hasChanged(item, value);
        if (changed) {
          const oldValue = item.lastValue;
          item.lastValue = value;
          this.emit('changed', { name, value, oldValue });
        }
      }
    } catch (err) {
      this.emit('error', err);
    }
  }

  private hasChanged(item: PollerItem, newValue: unknown): boolean {
    if (item.lastValue === undefined) return true;

    const oldVal = item.lastValue;

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
        return Math.abs(newValue - oldVal) > this.config.deadband;
      }
      return newValue !== oldVal;
    }

    return newValue !== oldVal;
  }
}
