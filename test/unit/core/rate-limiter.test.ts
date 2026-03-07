import { RateLimiter } from '../../../src/core/rate-limiter';

describe('RateLimiter', () => {
  it('creates with default config', () => {
    const limiter = new RateLimiter();
    expect(limiter.getAvailableTokens()).toBe(10);
  });

  it('creates with custom config', () => {
    const limiter = new RateLimiter({ tokensPerInterval: 5, interval: 500, minDelay: 20 });
    expect(limiter.getAvailableTokens()).toBe(5);
  });

  it('decrements tokens on acquire', async () => {
    const limiter = new RateLimiter({ tokensPerInterval: 5, interval: 10000, minDelay: 0 });
    await limiter.acquire();
    expect(limiter.getAvailableTokens()).toBe(4);
  });

  it('allows multiple acquires until exhausted', async () => {
    const limiter = new RateLimiter({ tokensPerInterval: 3, interval: 10000, minDelay: 0 });
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(limiter.getAvailableTokens()).toBe(0);
  });

  it('waits when tokens are exhausted', async () => {
    const limiter = new RateLimiter({ tokensPerInterval: 1, interval: 100, minDelay: 0 });
    await limiter.acquire();
    expect(limiter.getAvailableTokens()).toBe(0);

    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(50); // some wait happened
  });

  it('enforces minimum delay between requests', async () => {
    const limiter = new RateLimiter({ tokensPerInterval: 100, interval: 10000, minDelay: 50 });

    const start = Date.now();
    await limiter.acquire();
    await limiter.acquire();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(40); // minDelay enforced (with tolerance)
  });
});
