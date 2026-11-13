/** One pending value, one request, and a start-to-start throttle (not debounce). */
export class Autosave<T> {
  value: string;
  saved: string;
  paused = false;
  error: unknown = null;
  private lastStart = -Infinity;
  private timer?: ReturnType<typeof setTimeout>;
  private flight?: Promise<void>;
  private disposed = false;

  constructor(
    initial: string,
    private write: (value: string) => Promise<T>,
    private accept: (result: T, value: string) => void,
    private changed: () => void,
    private interval = 2000,
    private retryDelay = 5000,
  ) {
    this.value = this.saved = initial;
  }

  get dirty() {
    // A lost response may still have committed on the server. Even a local
    // revert must be acknowledged again before we can call it saved.
    return this.value !== this.saved || Boolean(this.error);
  }
  get busy() {
    return Boolean(this.flight);
  }

  edit(value: string) {
    this.value = value;
    this.changed();
    this.schedule();
  }

  private schedule(delay = 0) {
    if (
      this.disposed ||
      this.paused ||
      this.flight ||
      this.timer ||
      !this.dirty
    )
      return;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        void this.run().catch(() => {});
      },
      Math.max(delay, this.lastStart + this.interval - Date.now()),
    );
  }

  private run(): Promise<void> {
    if (this.flight) return this.flight;
    if (this.paused) return Promise.reject(new Error("Autosave paused"));
    if (!this.dirty || this.disposed) return Promise.resolve();
    const value = this.value;
    this.lastStart = Date.now();
    this.error = null;
    this.flight = this.write(value)
      .then((result) => {
        this.accept(result, value);
        // Acknowledge the submitted input, not the normalized server value.
        // Replacing input here removes spaces while typing; comparing against
        // the normalized value instead would repeatedly save the same input.
        this.saved = value;
      })
      .catch((error: unknown) => {
        this.error = error;
        const status = (error as { data?: { status?: number } })?.data?.status;
        if (status && status >= 400 && status < 500 && status !== 429)
          this.paused = true;
        throw error;
      })
      .finally(() => {
        this.flight = undefined;
        if (!this.disposed) {
          this.changed();
          this.schedule(this.error ? this.retryDelay : 0);
        }
      });
    this.changed();
    return this.flight;
  }

  async flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    while (this.flight || this.dirty) {
      if (this.disposed) throw new Error("Editor closed");
      if (this.flight) await this.flight;
      else {
        if (this.paused) throw this.error ?? new Error("Autosave paused");
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.max(0, this.lastStart + this.interval - Date.now()),
          ),
        );
        await this.run();
      }
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  retry() {
    this.paused = false;
    this.schedule();
    this.changed();
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
  }
}
