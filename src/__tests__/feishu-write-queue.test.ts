import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeishuWriteQueue } from '../core/feishu/writeQueue';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('FeishuWriteQueue', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('serializes writes for the same base and table', async () => {
    const queue = new FeishuWriteQueue();
    const deferred = createDeferred<string>();
    const events: string[] = [];

    const first = queue.enqueue({
      baseId: 'app_1',
      tableId: 'tbl_1',
      task: async () => {
        events.push('first:start');
        const value = await deferred.promise;
        events.push('first:end');
        return value;
      },
    });

    const second = queue.enqueue({
      baseId: 'app_1',
      tableId: 'tbl_1',
      task: async () => {
        events.push('second:start');
        return 'second';
      },
    });

    await flushMicrotasks();
    expect(events).toEqual(['first:start']);

    deferred.resolve('first');

    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('allows writes to different tables to proceed independently', async () => {
    const queue = new FeishuWriteQueue();
    const firstDeferred = createDeferred<string>();
    const events: string[] = [];

    const first = queue.enqueue({
      baseId: 'app_1',
      tableId: 'tbl_1',
      task: async () => {
        events.push('first:start');
        const value = await firstDeferred.promise;
        events.push('first:end');
        return value;
      },
    });

    const second = queue.enqueue({
      baseId: 'app_1',
      tableId: 'tbl_2',
      task: async () => {
        events.push('second:start');
        return 'second';
      },
    });

    await expect(second).resolves.toBe('second');
    expect(events).toEqual(['first:start', 'second:start']);

    firstDeferred.resolve('first');
    await expect(first).resolves.toBe('first');
  });

  it('recovers from timeout and continues later writes on the same table', async () => {
    vi.useFakeTimers();
    const queue = new FeishuWriteQueue({ timeoutMs: 10 });

    const first = queue.enqueue({
      baseId: 'app_1',
      tableId: 'tbl_1',
      task: async () => await new Promise<string>(() => {}),
    }).catch((error: unknown) => error);

    const second = queue.enqueue({
      baseId: 'app_1',
      tableId: 'tbl_1',
      task: async () => 'second',
    });

    await vi.advanceTimersByTimeAsync(20);

    await expect(second).resolves.toBe('second');
    await expect(first).resolves.toBeInstanceOf(Error);
  });
});
