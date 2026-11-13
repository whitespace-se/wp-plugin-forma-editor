import React, { useEffect, useRef } from "react";

export function LockDialog({
  owner,
  lost,
  busy,
  error,
  viewUrl,
  returnUrl,
  labels,
  takeover,
}: {
  owner: string | null;
  lost: boolean;
  busy: boolean;
  error: string;
  viewUrl: string;
  returnUrl: string;
  labels: Record<string, string>;
  takeover: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    if (owner && !element.open) element.showModal();
    else if (!owner && element.open) element.close();
  }, [owner]);
  return (
    <dialog
      ref={dialog}
      id="post-lock-dialog"
      className="notification-dialog forma-editor__lock-dialog"
      aria-labelledby="forma-lock-message"
      onCancel={(event) => event.preventDefault()}
    >
      <div className="post-locked-message">
        <p id="forma-lock-message">
          {(lost ? labels.lockLost : labels.locked).replace("%s", owner ?? "")}
        </p>
        {lost && <p>{labels.lockLocalChanges}</p>}
        {error && <p role="alert">{error}</p>}
        <p className="forma-editor__lock-actions">
          <a className="button" href={returnUrl} data-forma-leave-lock>
            {labels.back}
          </a>
          <a
            className="button"
            href={viewUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {labels.previewAction}
          </a>
          <button
            className="button button-primary"
            disabled={busy}
            onClick={takeover}
          >
            {labels.takeover}
          </button>
        </p>
      </div>
    </dialog>
  );
}
