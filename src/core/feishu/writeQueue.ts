interface FeishuWriteQueueOptions {
  timeoutMs?: number;
}

interface QueueTaskInput<T> {
  baseId: string;
  tableId: string;
  task: () => Promise<T>;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, key: string): Promise<T> {
  if (timeoutMs <= 0) {
    return promise;
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`飞书写入队列执行超时: ${key}`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export class FeishuWriteQueue {
  private readonly timeoutMs: number;

  private readonly pending = new Map<string, Promise<unknown>>();

  constructor(options: FeishuWriteQueueOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private buildKey(baseId: string, tableId: string): string {
    return `${baseId}::${tableId}`;
  }

  async enqueue<T>(input: QueueTaskInput<T>): Promise<T> {
    const key = this.buildKey(input.baseId, input.tableId);
    const previous = this.pending.get(key) ?? Promise.resolve();
    const timeoutMs = input.timeoutMs ?? this.timeoutMs;

    const next = previous
      .catch(() => undefined)
      .then(async () => await withTimeout(input.task(), timeoutMs, key));

    this.pending.set(key, next);

    try {
      return await next;
    } finally {
      if (this.pending.get(key) === next) {
        this.pending.delete(key);
      }
    }
  }
}

export const feishuWriteQueue = new FeishuWriteQueue();
