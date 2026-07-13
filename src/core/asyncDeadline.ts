export class OperationTimeoutError extends Error {
  constructor(
    readonly operation: string,
    readonly timeoutMs: number,
  ) {
    super(`${operation} timed out after ${timeoutMs}ms.`);
    this.name = "OperationTimeoutError";
  }
}

/** Resolves with an operation, but never leaves a scene waiting forever for a host reply. */
export function withDeadline<T>(
  operation: PromiseLike<T>,
  timeoutMs: number,
  label = "Operation",
): Promise<T> {
  const safeTimeoutMs = Math.max(1, Math.floor(timeoutMs));
  return new Promise<T>((resolve, reject) => {
    const timeout = globalThis.setTimeout(
      () => reject(new OperationTimeoutError(label, safeTimeoutMs)),
      safeTimeoutMs,
    );
    Promise.resolve(operation).then(
      (value) => {
        globalThis.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        globalThis.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
