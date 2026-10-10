import { Poller } from '../../../src/core/poller';
import { S7Error, S7ErrorCode } from '../../../src/utils/error-codes';

describe('Poller', () => {
  let poller: Poller;

  afterEach(() => {
    if (poller) poller.stop();
  });

  describe('change detection', () => {
    // hasChanged() is private; call it directly rather than wait on timers
    const changed = (p: Poller, oldValue: unknown, newValue: unknown): boolean =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (p as any).hasChanged(oldValue, newValue);

    it('compares dates by the time they hold, not by object', () => {
      poller = new Poller({ interval: 50, edgeMode: 'any', deadband: 0 });
      const t = Date.UTC(2024, 2, 17);
      expect(changed(poller, new Date(t), new Date(t))).toBe(false);
      expect(changed(poller, new Date(t), new Date(t + 1))).toBe(true);
    });

    it('compares arrays and Buffers by what they hold, not by object', () => {
      poller = new Poller({ interval: 50, edgeMode: 'any', deadband: 0 });
      expect(changed(poller, [11, 22, 33], [11, 22, 33])).toBe(false);
      expect(changed(poller, [11, 22, 33], [11, 22, 34])).toBe(true);
      expect(changed(poller, [11, 22], [11, 22, 33])).toBe(true);
      expect(changed(poller, [true, false], [true, false])).toBe(false);
      expect(changed(poller, Buffer.from([1, 2]), Buffer.from([1, 2]))).toBe(false);
      expect(changed(poller, Buffer.from([1, 2]), Buffer.from([1, 3]))).toBe(true);
    });

    it('applies the deadband to BigInt values', () => {
      poller = new Poller({ interval: 50, edgeMode: 'any', deadband: 5 });
      expect(changed(poller, 9007199254740993n, 9007199254740996n)).toBe(false);
      expect(changed(poller, 9007199254740993n, 9007199254741000n)).toBe(true);
      expect(changed(poller, 9007199254740993n, 9007199254740998n)).toBe(true); // exactly the deadband
    });
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

  describe('edges and deadband', () => {
    // One poll per value, without timers, so each test sees exactly what each read sends
    async function sendsFor(p: Poller, sequence: unknown[]): Promise<{ value: unknown; oldValue: unknown }[]> {
      const sent: { value: unknown; oldValue: unknown }[] = [];
      p.on('changed', ({ value, oldValue }) => sent.push({ value, oldValue }));
      p.addItem('test');
      let i = 0;
      p.setReadFunction(async () => new Map([['test', sequence[i++]]]));
      for (let n = 0; n < sequence.length; n++) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (p as any).poll();
      }
      return sent;
    }

    it('fires on every rising edge, not on the first poll', async () => {
      poller = new Poller({ interval: 50, edgeMode: 'rising', deadband: 0 });
      const sent = await sendsFor(poller, [false, true, false, true, false, true]);
      expect(sent).toEqual([
        { value: true, oldValue: false },
        { value: true, oldValue: false },
        { value: true, oldValue: false },
      ]);
    });

    it('fires on every falling edge, not on the first poll', async () => {
      poller = new Poller({ interval: 50, edgeMode: 'falling', deadband: 0 });
      const sent = await sendsFor(poller, [true, false, true, false, true, false]);
      expect(sent).toEqual([
        { value: false, oldValue: true },
        { value: false, oldValue: true },
        { value: false, oldValue: true },
      ]);
    });

    it('does not treat a first true as a rising edge, or a first false as a falling edge', async () => {
      poller = new Poller({ interval: 50, edgeMode: 'rising', deadband: 0 });
      expect(await sendsFor(poller, [true, true])).toEqual([]);
      poller = new Poller({ interval: 50, edgeMode: 'falling', deadband: 0 });
      expect(await sendsFor(poller, [false, false])).toEqual([]);
    });

    it('sends the first boolean and every change in any mode', async () => {
      poller = new Poller({ interval: 50, edgeMode: 'any', deadband: 0 });
      const sent = await sendsFor(poller, [false, false, true, false]);
      expect(sent).toEqual([
        { value: false, oldValue: undefined },
        { value: true, oldValue: false },
        { value: false, oldValue: true },
      ]);
    });

    it('measures the deadband from the value last sent, so a slow drift fires', async () => {
      poller = new Poller({ interval: 50, edgeMode: 'any', deadband: 5 });
      const sent = await sendsFor(poller, [10, 13, 16]);
      expect(sent).toEqual([
        { value: 10, oldValue: undefined },
        { value: 16, oldValue: 10 },
      ]);
    });

    it('fires on a change of exactly the deadband', async () => {
      poller = new Poller({ interval: 50, edgeMode: 'any', deadband: 5 });
      const sent = await sendsFor(poller, [10, 14, 15]);
      expect(sent.map((s) => s.value)).toEqual([10, 15]);
    });

    it('fires on any numeric change with a deadband of 0', async () => {
      poller = new Poller({ interval: 50, edgeMode: 'any', deadband: 0 });
      const sent = await sendsFor(poller, [10, 10, 10.5, 11]);
      expect(sent.map((s) => s.value)).toEqual([10, 10.5, 11]);
    });
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

  describe('a read still in flight when the poller stops', () => {
    // poll() is private; call it directly so the read can be settled after stop()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const poll = (p: Poller): Promise<void> => (p as any).poll();
    const pendingRead = (p: Poller) => {
      const read: { resolve: (m: Map<string, unknown>) => void; reject: (e: Error) => void } = {} as never;
      p.setReadFunction(() => new Promise((resolve, reject) => Object.assign(read, { resolve, reject })));
      return read;
    };

    it('does not emit error once its listeners are gone, so a closed s7-trigger cannot crash the process', async () => {
      poller = new Poller({ interval: 1000, edgeMode: 'any', deadband: 0 });
      poller.addItem('test');
      const read = pendingRead(poller);
      poller.on('error', () => undefined);
      poller.start();
      const polling = poll(poller);
      // What s7-trigger's close does, then the connection rejecting the queued read
      poller.stop();
      poller.removeAllListeners();
      const emit = jest.spyOn(poller, 'emit');
      read.reject(new Error('Connection lost'));
      await expect(polling).resolves.toBeUndefined();
      expect(emit).not.toHaveBeenCalled();
    });

    it('still reports the error when the failure itself stopped the poller', async () => {
      // As ConnectionManager.processQueue() does: it rejects the timed-out request, then
      // handleConnectionLoss() moves to reconnecting and s7-trigger stops the poller, all in the
      // same tick and before the poll sees the rejection
      poller = new Poller({ interval: 1000, edgeMode: 'any', deadband: 0 });
      poller.addItem('test');
      const read = pendingRead(poller);
      const onError = jest.fn();
      poller.on('error', onError);
      poller.start();
      const polling = poll(poller);
      read.reject(new S7Error(S7ErrorCode.REQUEST_TIMEOUT, 'Request timed out'));
      poller.stop();
      await polling;
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Request timed out' }));
    });

    it('ignores its values, even after the poller has started again', async () => {
      poller = new Poller({ interval: 1000, edgeMode: 'any', deadband: 0 });
      poller.addItem('test');
      const read = pendingRead(poller);
      const changed = jest.fn();
      poller.on('changed', changed);
      poller.start();
      const stale = poll(poller);
      poller.stop();
      poller.start();
      read.resolve(new Map([['test', 1]]));
      await stale;
      expect(changed).not.toHaveBeenCalled();

      // A read from the new run is used as usual
      const fresh = pendingRead(poller);
      const current = poll(poller);
      fresh.resolve(new Map([['test', 2]]));
      await current;
      expect(changed).toHaveBeenCalledWith({ name: 'test', value: 2, oldValue: undefined });
    });

    it('still reports errors while running, and after an interval change', async () => {
      poller = new Poller({ interval: 1000, edgeMode: 'any', deadband: 0 });
      poller.addItem('test');
      const read = pendingRead(poller);
      const onError = jest.fn();
      poller.on('error', onError);
      poller.start();
      const polling = poll(poller);
      // updateConfig restarts the timer but is not a stop, so the read still counts
      poller.updateConfig({ interval: 500 });
      read.reject(new Error('Read failed'));
      await polling;
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Read failed' }));
    });
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
