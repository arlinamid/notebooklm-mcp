/**
 * FIFO lock for one browser tab. Every operation that clicks or types on a
 * session's page runs under it, so concurrent tool calls on the same session
 * queue up instead of driving the page at the same time (two calls clicking
 * in one tab close each other's dialogs and panels).
 *
 * Long waits that need no page interaction — a Studio or audio render on
 * Google's side — must not hold the lock; poll in short locked steps instead.
 */

import { abortable, reportProgress } from "./request-context.js";
import { log } from "./logger.js";

export class PageLock {
  private tail: Promise<void> = Promise.resolve();
  /** Label of the last operation that joined the queue. */
  private tailLabel = "";
  private holder: string | null = null;
  /** Operations that called run() and have not finished (running + waiting). */
  private pending = 0;
  private waiting = 0;

  /** Label of the operation holding the lock, or null when free. */
  get current(): string | null {
    return this.holder;
  }

  /** Number of operations queued behind the holder. */
  get queued(): number {
    return this.waiting;
  }

  /** Run `fn` once every earlier operation on this page has finished. */
  async run<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    const ahead = this.holder ?? this.tailLabel;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => (release = resolve));
    this.tailLabel = label;
    // Decided synchronously: the holder field is only set after a microtask.
    const mustWait = this.pending > 0;
    this.pending++;

    try {
      if (mustWait) {
        this.waiting++;
        const msg = `Queued behind "${ahead}" on this session (${this.waiting} waiting)…`;
        log.info(`  ⏳ ${label}: ${msg}`);
        void reportProgress(msg);
        try {
          await abortable(previous);
        } catch (error) {
          // A cancelled waiter leaves the queue but releases its slot only
          // once the operations ahead of it are done, so order is kept.
          void previous.then(release);
          throw error;
        } finally {
          this.waiting--;
        }
      } else {
        await previous;
      }

      this.holder = label;
      try {
        return await fn();
      } finally {
        this.holder = null;
        release();
      }
    } finally {
      this.pending--;
    }
  }
}
