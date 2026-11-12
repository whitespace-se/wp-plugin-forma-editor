// Kept outside editor components so WordPress transport does not become a UI dependency.
import apiFetch from "@wordpress/api-fetch";
export { apiFetch };

export interface WorkflowState {
  title: string;
  status: "draft" | "publish";
  autosave: { title: string; otherChanges: boolean } | null;
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
) {
  const state = await apiFetch<WorkflowState>({
    path,
    method: "POST",
    data: { operation, ...(title === undefined ? {} : { title }) },
  });
  if (
    typeof state.title !== "string" ||
    !["draft", "publish"].includes(state.status) ||
    typeof state.previewUrl !== "string"
  ) {
    throw new Error("Unexpected editor response");
  }
  return state;
}
