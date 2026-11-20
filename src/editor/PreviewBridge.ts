export interface InlineState {
  pageId: number;
  postId: number;
  title: string;
  content?: string;
  inlineEnabled?: boolean;
  writable: boolean;
  busy: boolean;
}

interface Handlers {
  state: InlineState;
  change: (title: string) => void;
  select: () => Promise<void>;
  leave: () => void;
  panel?: () => void;
  media?: () => Promise<string | null>;
  prepare?: () => void;
}

/** The iframe owns selection/composition; only the host owns persistence.
 * Document and sequence IDs prevent old previews overwriting a new session. */
export class PreviewBridge {
  constructor(private field: "title" | "content" = "title") {}
  private frame: HTMLIFrameElement | null = null;
  private origin = "";
  private documentId = "";
  private sequence = 0;
  private handlers?: Handlers;
  private active = false;
  private resume = false;
  private leaveTimer?: ReturnType<typeof setTimeout>;
  private pending?: {
    id: string;
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };

  get editing() {
    return this.active;
  }

  start() {
    if (
      !this.documentId ||
      !this.handlers?.state.writable ||
      this.handlers.state.busy
    )
      return false;
    this.handlers.prepare?.();
    this.cancelRefresh();
    this.active = true;
    this.sync();
    this.send("begin");
    return true;
  }

  attach(frame: HTMLIFrameElement | null) {
    if (this.frame === frame) return;
    this.cancelRefresh();
    this.failPending();
    this.frame = frame;
    this.origin = frame ? new URL(frame.src).origin : "";
    this.documentId = "";
    this.sequence = 0;
    this.active = false;
  }

  configure(handlers: Handlers) {
    this.handlers = handlers;
    this.sync();
  }

  disconnect() {
    this.handlers = undefined;
    this.cancelRefresh();
    this.failPending();
  }

  private send(type: string, extra: Record<string, unknown> = {}) {
    if (this.documentId)
      this.frame?.contentWindow?.postMessage(
        {
          channel: `forma-${this.field}`,
          version: 1,
          documentId: this.documentId,
          type,
          ...extra,
        },
        this.origin,
      );
  }

  private sync() {
    if (!this.handlers) return;
    const state = this.handlers.state;
    this.send("state", { ...state, acknowledged: this.sequence });
    if (
      !this.documentId ||
      !state.writable ||
      state.busy ||
      state.postId !== state.pageId
    )
      return;
    if (this.resume) {
      this.resume = false;
      this.active = true;
      this.send("begin");
    }
  }

  receive = (event: MessageEvent) => {
    const data = event.data;
    if (
      !this.frame ||
      event.source !== this.frame.contentWindow ||
      event.origin !== this.origin ||
      !data ||
      data.channel !== `forma-${this.field}` ||
      data.version !== 1 ||
      typeof data.documentId !== "string" ||
      data.documentId.length > 80 ||
      !this.handlers
    )
      return;
    if (data.type === "ready") {
      if (
        data.pageId !== this.handlers.state.pageId ||
        (this.documentId && data.documentId !== this.documentId)
      )
        return;
      this.documentId = data.documentId;
      if (Number.isSafeInteger(data.sequence))
        this.sequence = Math.max(this.sequence, data.sequence);
      this.sync();
      return;
    }
    if (
      data.documentId !== this.documentId ||
      !Number.isSafeInteger(data.sequence) ||
      data.sequence <= this.sequence
    )
      return;
    this.sequence = data.sequence;
    const { state, change, select, leave } = this.handlers;
    if (data.type === "panel") {
      this.handlers.panel?.();
      return;
    }
    if (
      data.type === "media" &&
      this.active &&
      state.writable &&
      !state.busy &&
      this.handlers.media
    ) {
      const documentId = this.documentId;
      const requestId = data.requestId;
      if (typeof requestId !== "string" || requestId.length > 80) return;
      void this.handlers
        .media()
        .then((html) => {
          if (
            this.documentId === documentId &&
            this.active &&
            this.handlers?.state.writable
          )
            this.send("media", { requestId, html });
        })
        .catch(() => {
          if (this.documentId === documentId)
            this.send("media", { requestId, html: null });
        });
      return;
    }
    if (data.type === "blocked" && this.pending?.id === data.requestId) {
      this.failPending();
      return;
    }
    if (data.type === "begin") {
      if (!state.writable || state.busy) return;
      this.cancelRefresh();
      if (state.postId !== state.pageId) {
        this.resume = true;
        void select().catch(() => {
          this.resume = false;
          this.sync();
        });
      } else {
        this.start();
      }
      return;
    }
    if (state.postId !== state.pageId || !state.writable) return;
    if (
      data.type === "flushed" &&
      (!this.pending || this.pending.id !== data.requestId)
    )
      return;
    if (
      (data.type === "change" ||
        data.type === "end" ||
        data.type === "flushed") &&
      typeof data[this.field] === "string" &&
      (this.field === "content" || !/[\r\n]/.test(data.title))
    ) {
      if (!this.active && data.type === "change") return;
      change(data[this.field]);
      if (data.type === "change") return;
      this.active = false;
      if (data.type === "flushed") {
        if (this.pending && this.pending.id === data.requestId) {
          clearTimeout(this.pending.timer);
          this.pending.resolve();
          this.pending = undefined;
        }
      } else {
        // Let a click in the host reach Save before refreshing the iframe.
        this.cancelRefresh();
        this.leaveTimer = setTimeout(() => {
          this.leaveTimer = undefined;
          leave();
        }, 200);
      }
    }
  };

  cancelRefresh() {
    clearTimeout(this.leaveTimer);
    this.leaveTimer = undefined;
  }

  async flush() {
    this.cancelRefresh();
    if (
      !this.documentId ||
      (this.field === "content" && !this.active) ||
      this.handlers?.state.postId !== this.handlers?.state.pageId
    )
      return;
    if (this.pending) throw new Error("Inline-redigeringen avslutas redan.");
    await new Promise<void>((resolve, reject) => {
      const id = crypto.randomUUID();
      this.pending = {
        id,
        resolve,
        reject,
        timer: setTimeout(() => this.failPending(), 4000),
      };
      this.send("flush", { requestId: id });
    });
  }

  private failPending() {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.reject(
      new Error(
        "Inline-redigeringen kunde inte avslutas. Stäng eventuella dialoger och försök igen innan du sparar.",
      ),
    );
    this.pending = undefined;
  }
}
