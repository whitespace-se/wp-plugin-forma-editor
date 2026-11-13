import React, { useRef, useState } from "react";
import { createPortal } from "react-dom";

export function PublishControls({
  status,
  changed,
  disabled,
  hasAutosave,
  canPublish,
  revisionUrl,
  saveStatus,
  actionsTarget,
  labels,
  commit,
  discard,
}: {
  status: "draft" | "publish";
  changed: boolean;
  disabled: boolean;
  hasAutosave: boolean;
  canPublish: boolean;
  revisionUrl?: string | null;
  saveStatus: string;
  actionsTarget: HTMLDivElement | null;
  labels: Record<string, string>;
  commit: (operation: "publish" | "draft") => void;
  discard: () => void;
}) {
  const [selectedStatus, setSelectedStatus] = useState<
    "publish" | "draft" | null
  >(null);
  const [editing, setEditing] = useState(false);
  const [pendingStatus, setPendingStatus] = useState(status);
  const editButton = useRef<HTMLButtonElement>(null);
  const operation = selectedStatus ?? "publish";
  const displayStatus = selectedStatus ?? status;
  const close = () => {
    setEditing(false);
    editButton.current?.focus();
  };
  // Core's submit box assumes the classic post form. Reuse its presentation,
  // but keep every write in Forma's queue and lock-aware workflow.
  return (
    <>
      {actionsTarget &&
        createPortal(
          <>
            <span role="status">{saveStatus}</span>
            {canPublish && (
              <button
                type="button"
                className="button button-primary"
                disabled={
                  disabled ||
                  editing ||
                  (operation === "publish" && status === "publish" && !changed)
                }
                onClick={() => {
                  if (
                    operation !== "draft" ||
                    status !== "publish" ||
                    window.confirm(labels.draftConfirm)
                  )
                    commit(operation);
                }}
              >
                {operation === "draft"
                  ? status === "publish"
                    ? labels.draft
                    : labels.saveDraft
                  : status === "publish"
                    ? labels.update
                    : labels.publish}
              </button>
            )}
          </>,
          actionsTarget,
        )}
      <section
        className="forma-editor__publish-section"
        aria-labelledby="forma-publish-heading"
      >
        <h2 id="forma-publish-heading" className="screen-reader-text">
          {labels.publish}
        </h2>
        <div className="forma-editor__section-content">
          <div className="misc-pub-section">
            <span
              className="dashicons dashicons-post-status"
              aria-hidden="true"
            />{" "}
            {labels.status}{" "}
            <strong>
              {displayStatus === "publish"
                ? labels.publishedStatus
                : labels.draftStatus}
            </strong>{" "}
            {canPublish && (
              <button
                type="button"
                className="button-link"
                ref={editButton}
                aria-label={labels.editStatus}
                aria-expanded={editing}
                aria-controls="forma-status-select"
                disabled={disabled}
                onClick={() => {
                  setPendingStatus(displayStatus);
                  setEditing(true);
                }}
              >
                {labels.edit}
              </button>
            )}
            {editing && (
              <div
                id="forma-status-select"
                className="forma-editor__status-select"
              >
                <label
                  className="screen-reader-text"
                  htmlFor="forma-post-status"
                >
                  {labels.editStatus}
                </label>
                <select
                  id="forma-post-status"
                  autoFocus
                  disabled={disabled}
                  value={pendingStatus}
                  onChange={(event) =>
                    setPendingStatus(event.target.value as "publish" | "draft")
                  }
                >
                  <option value="publish">{labels.publishedStatus}</option>
                  <option value="draft">{labels.draftStatus}</option>
                </select>
                <button
                  type="button"
                  className="button"
                  disabled={disabled}
                  onClick={() => {
                    setSelectedStatus(pendingStatus);
                    close();
                  }}
                >
                  {labels.ok}
                </button>
                <button type="button" className="button-link" onClick={close}>
                  {labels.cancel}
                </button>
              </div>
            )}
          </div>
          {revisionUrl && (
            <div className="misc-pub-section">
              <span className="dashicons dashicons-backup" aria-hidden="true" />{" "}
              <a href={revisionUrl}>{labels.revisions}</a>
            </div>
          )}
          {hasAutosave && (
            <div className="misc-pub-section">
              <button
                type="button"
                className="button-link button-link-delete"
                disabled={disabled}
                onClick={discard}
              >
                {labels.discard}
              </button>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
