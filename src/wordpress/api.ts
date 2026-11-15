// Kept outside editor components so WordPress transport does not become a UI dependency.
import apiFetch from "@wordpress/api-fetch";
export { apiFetch };

export interface WorkflowState {
  title: string;
  content: string;
  status: "draft" | "publish";
  autosave: { title: string; content: string; otherChanges: boolean } | null;
  canPublish: boolean;
  lockOwner: string | null;
  lock: string | null;
  previewUrl: string;
  viewUrl: string;
  revisionUrl: string | null;
}

export async function workflow(
  path: string,
  operation: string,
  title?: string,
  content?: string,
) {
  const state = await apiFetch<WorkflowState>({
    path,
    method: "POST",
    data: {
      operation,
      ...(title === undefined ? {} : { title }),
      ...(content === undefined ? {} : { content }),
    },
  });
  if (
    typeof state.title !== "string" ||
    typeof state.content !== "string" ||
    !["draft", "publish"].includes(state.status) ||
    typeof state.previewUrl !== "string"
  ) {
    throw new Error("Unexpected editor response");
  }
  return state;
}
