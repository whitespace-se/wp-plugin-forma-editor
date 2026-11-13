import React, { useState } from "react";

export function PublishControls({
  status,
  changed,
  disabled,
  hasAutosave,
  labels,
  commit,
  discard,
}: {
  status: "draft" | "publish";
  changed: boolean;
  disabled: boolean;
  hasAutosave: boolean;
  labels: Record<string, string>;
  commit: (operation: "publish" | "draft") => void;
  discard: () => void;
}) {
  const [operation, setOperation] = useState<"publish" | "draft">("publish");
  const publishLabel = status === "publish" ? labels.update : labels.publish;
  const draftLabel = status === "publish" ? labels.draft : labels.saveDraft;
  return (
    <>
      <div className="forma-editor__publish-group">
        <button
          className="button button-primary forma-editor__publish"
          disabled={
            disabled ||
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
          {operation === "publish" ? publishLabel : draftLabel}
        </button>
        <button
          className="button button-primary forma-editor__publish-settings"
          aria-label={labels.publishSettings}
          {...{ popovertarget: "forma-publish-options" }}
          disabled={disabled}
        >
          <span
            className="dashicons dashicons-admin-generic"
            aria-hidden="true"
          />
        </button>
      </div>
      <div
        id="forma-publish-options"
        className="postbox forma-editor__publish-options"
        {...{ popover: "auto" }}
      >
        <div className="postbox-header">
          <h2 className="hndle">{labels.action}</h2>
        </div>
        <fieldset className="inside" disabled={disabled}>
          <legend className="screen-reader-text">{labels.action}</legend>
          <label>
            <input
              type="radio"
              name="forma-publish-action"
              value="publish"
              checked={operation === "publish"}
              onChange={() => setOperation("publish")}
            />
            {publishLabel}
          </label>
          <label>
            <input
              type="radio"
              name="forma-publish-action"
              value="draft"
              checked={operation === "draft"}
              onChange={() => setOperation("draft")}
            />
            {draftLabel}
          </label>
        </fieldset>
        {hasAutosave && (
          <div className="forma-editor__discard">
            <button
              className="button-link button-link-delete"
              disabled={disabled}
              onClick={discard}
            >
              <span className="dashicons dashicons-trash" aria-hidden="true" />{" "}
              {labels.discard}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
