import { Poller } from '../../../src/core/poller';

describe('Poller', () => {
  let poller: Poller;

  afterEach(() => {
    if (poller) poller.stop();
  });

  it('emits changed on first read', (done) => {
    poller = new Poller({ interval: 50, edgeMode: 'any', deadband: 0 });
    poller.addItem('test');
    poller.setReadFunction(async () => new Map([['test', 42]]));

    poller.on('changed', ({ name, value }) => {
      expect(name).toBe('test');
      expect(value).toBe(42);
      done();
    });

    poller.start();
  });

  it('emits changed when value changes', (done) => {
    let callCount = 0;
    poller = new Poller({ interval: 50, edgeMode: 'any', deadband: 0 });
    poller.addItem('test');
    poller.setReadFunction(async () => {
      callCount++;
      return new Map([['test', callCount]]);
    });

    const values: number[] = [];
    poller.on('changed', ({ value }) => {
      values.push(value as number);
      if (values.length >= 3) {
        expect(values).toEqual([1, 2, 3]);
        done();
      }
    });

    poller.start();
  });

  it('does not emit when value stays the same', (done) => {
    poller = new Poller({ interval: 50, edgeMode: 'any', deadband: 0 });
    poller.addItem('test');
    poller.setReadFunction(async () => new Map([['test', 42]]));

    let changeCount = 0;
    poller.on('changed', () => {
      changeCount++;
    });

    poller.start();

    setTimeout(() => {
      expect(changeCount).toBe(1); // only initial
      done();
    }, 250);
  });

  it('respects rising edge mode', (done) => {
    let callCount = 0;
    poller = new Poller({ interval: 50, edgeMode: 'rising', deadband: 0 });
    poller.addItem('test');
    // Sequence: false, true, false, true
    const sequence = [false, true, false, true];
    poller.setReadFunction(async () => {
      const val = sequence[Math.min(callCount++, sequence.length - 1)];
      return new Map([['test', val]]);
    });

    const changes: boolean[] = [];
    poller.on('changed', ({ value }) => {
      changes.push(value as boolean);
    });

    setTimeout(() => {
      poller.stop();
      // Should have: initial false, then rising to true (x2 possibly)
      expect(changes[0]).toBe(false); // first read
      const risingEdges = changes.filter((v, i) => i > 0 && v === true);
      expect(risingEdges.length).toBeGreaterThanOrEqual(1);
      done();
    }, 400);

    poller.start();
  });

  it('respects falling edge mode', (done) => {
    let callCount = 0;
    poller = new Poller({ interval: 50, edgeMode: 'falling', deadband: 0 });
    poller.addItem('test');
    const sequence = [true, false, true, false];
    poller.setReadFunction(async () => {
      const val = sequence[Math.min(callCount++, sequence.length - 1)];
      return new Map([['test', val]]);
    });

    const changes: boolean[] = [];
    poller.on('changed', ({ value }) => {
      changes.push(value as boolean);
    });

    setTimeout(() => {
      poller.stop();
      expect(changes[0]).toBe(true); // first read
      const fallingEdges = changes.filter((v, i) => i > 0 && v === false);
      expect(fallingEdges.length).toBeGreaterThanOrEqual(1);
      done();
    }, 400);

    poller.start();
  });

  it('respects deadband for numeric values', (done) => {
    let callCount = 0;
    poller = new Poller({ interval: 50, edgeMode: 'any', deadband: 5 });
    poller.addItem('test');
    // Values: 10, 12, 16 (within deadband=5: no change from 10 to 12, change from 10 to 16)
    const sequence = [10, 12, 16];
    poller.setReadFunction(async () => {
      const val = sequence[Math.min(callCount++, sequence.length - 1)];
      return new Map([['test', val]]);
    });

    const changes: number[] = [];
    poller.on('changed', ({ value }) => {
      changes.push(value as number);
    });

    setTimeout(() => {
      poller.stop();
      expect(changes).toContain(10); // initial
      expect(changes).toContain(16); // exceeds deadband
      expect(changes).not.toContain(12); // within deadband
      done();
    }, 400);

    poller.start();
  });

  it('stops polling', () => {
    poller = new Poller({ interval: 50, edgeMode: 'any', deadband: 0 });
    poller.start();
    expect(poller.isRunning()).toBe(true);
    poller.stop();
    expect(poller.isRunning()).toBe(false);
  });

  it('emits error on read failure', (done) => {
    poller = new Poller({ interval: 50, edgeMode: 'any', deadband: 0 });
    poller.addItem('test');
    poller.setReadFunction(async () => {
      throw new Error('Read failed');
    });

    poller.on('error', (err) => {
      expect(err.message).toBe('Read failed');
      done();
    });

    poller.start();
  });

  it('can add and remove items', () => {
    poller = new Poller({ interval: 1000, edgeMode: 'any', deadband: 0 });
    poller.addItem('a');
    poller.addItem('b');
    poller.removeItem('a');
    // No direct way to check items, but should not throw
  });

  describe('updateConfig', () => {
    it('updates edgeMode without restarting timer', () => {
      poller = new Poller({ interval: 100, edgeMode: 'any', deadband: 0 });
      poller.addItem('test');
      poller.setReadFunction(async () => new Map([['test', true]]));
      poller.start();

      expect(poller.isRunning()).toBe(true);
      poller.updateConfig({ edgeMode: 'rising' });
      expect(poller.isRunning()).toBe(true);
    });

    it('updates deadband without restarting timer', () => {
      poller = new Poller({ interval: 100, edgeMode: 'any', deadband: 0 });
      poller.start();

      poller.updateConfig({ deadband: 5 });
      expect(poller.isRunning()).toBe(true);
    });

    it('restarts timer when interval changes while running', (done) => {
      let readCount = 0;
      poller = new Poller({ interval: 2000, edgeMode: 'any', deadband: 0 });
      poller.addItem('test');
      poller.setReadFunction(async () => {
        readCount++;
        return new Map([['test', readCount]]);
      });
      poller.start();

      // Change to a much shorter interval
      poller.updateConfig({ interval: 50 });

      // With 50ms interval, should get reads within 200ms
      setTimeout(() => {
        expect(readCount).toBeGreaterThan(0);
        done();
      }, 200);
    });

    it('does not restart timer when interval is unchanged', () => {
      poller = new Poller({ interval: 100, edgeMode: 'any', deadband: 0 });
      poller.start();

      poller.updateConfig({ interval: 100 });
      expect(poller.isRunning()).toBe(true);
    });

    it('does not restart timer when not running', () => {
      poller = new Poller({ interval: 100, edgeMode: 'any', deadband: 0 });

      poller.updateConfig({ interval: 200 });
      expect(poller.isRunning()).toBe(false);
    });

    it('applies updated deadband to change detection', (done) => {
      let readCount = 0;
      poller = new Poller({ interval: 50, edgeMode: 'any', deadband: 0 });
      poller.addItem('test');
      poller.setReadFunction(async () => {
        readCount++;
        // Values: 10, 11, 12, ...
        return new Map([['test', 10 + readCount]]);
      });

      const changes: number[] = [];
      poller.on('changed', ({ value }) => {
        changes.push(value as number);
      });

      poller.start();

      // After first read, update deadband to 100 so small changes are ignored
      setTimeout(() => {
        poller.updateConfig({ deadband: 100 });
      }, 80);

      setTimeout(() => {
        // Should have initial value but not many more due to high deadband
        expect(changes.length).toBeGreaterThan(0);
        expect(changes.length).toBeLessThan(readCount);
        done();
      }, 350);
    });
  });
});
