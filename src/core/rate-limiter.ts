export interface RateLimiterConfig {
  tokensPerInterval: number;
  interval: number;
  minDelay: number;
}

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private lastRequest: number = 0;
  private readonly config: RateLimiterConfig;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = {
      tokensPerInterval: config.tokensPerInterval ?? 10,
      interval: config.interval ?? 1000,
      minDelay: config.minDelay ?? 50,
    };
    this.tokens = this.config.tokensPerInterval;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    const now = Date.now();

    const elapsed = now - this.lastRefill;
    if (elapsed >= this.config.interval) {
      const periods = Math.floor(elapsed / this.config.interval);
      this.tokens = Math.min(
        this.config.tokensPerInterval,
        this.tokens + periods * this.config.tokensPerInterval,
      );
      this.lastRefill += periods * this.config.interval;
    }

    const timeSinceLast = now - this.lastRequest;
    if (timeSinceLast < this.config.minDelay) {
      await this.delay(this.config.minDelay - timeSinceLast);
    }

    if (this.tokens <= 0) {
      const waitTime = this.config.interval - (Date.now() - this.lastRefill);
      if (waitTime > 0) {
        await this.delay(waitTime);
      }
      this.tokens = this.config.tokensPerInterval;
      this.lastRefill = Date.now();
    }

    this.tokens--;
    this.lastRequest = Date.now();
  }

  getAvailableTokens(): number {
    return this.tokens;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
