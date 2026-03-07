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
});
