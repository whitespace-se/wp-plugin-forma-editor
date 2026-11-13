type LockReply = {
  new_lock?: string;
  lock_error?: { name: string; text: string };
};
type HeartbeatData = Record<string, unknown>;
type Handler = (event: unknown, data: HeartbeatData) => void;
interface CoreWindow {
  jQuery: (target: Document) => {
    on: (events: string, callback: Handler) => void;
    off: (namespace: string) => void;
  };
  wp: {
    heartbeat: {
      interval: (seconds: number) => void;
      disableSuspend: () => void;
      connectNow: () => void;
    };
  };
}

/** Use the same transport and lock response as wp-admin/js/post.js. */
export function observePostLock(
  postId: number,
  read: () => { lock: string | null; generation: number } | undefined,
  receive: (reply: LockReply) => void,
  failed: () => void,
) {
  const core = window as unknown as CoreWindow;
  const events = core.jQuery(document);
  let generation: number | undefined;
  events.on("heartbeat-send.forma", (_event, data) => {
    const state = read();
    generation = state?.generation;
    if (state)
      data["wp-refresh-post-lock"] = { post_id: postId, lock: state.lock };
  });
  events.on("heartbeat-tick.forma", (_event, data) => {
    if (generation === undefined || read()?.generation !== generation) return;
    const reply = data["wp-refresh-post-lock"] as LockReply | undefined;
    if (reply?.new_lock || reply?.lock_error) receive(reply);
    else failed();
  });
  events.on("heartbeat-error.forma", failed);
  core.wp.heartbeat.interval(15);
  core.wp.heartbeat.disableSuspend();
  return {
    refresh: () => core.wp.heartbeat.connectNow(),
    dispose: () => events.off(".forma"),
  };
}
