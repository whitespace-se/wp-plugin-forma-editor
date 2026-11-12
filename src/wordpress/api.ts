// Kept outside editor components so WordPress transport does not become a UI dependency.
import apiFetch from "@wordpress/api-fetch";
export { apiFetch };

export async function postTitle(
  path: string,
  postId: number,
  value?: string,
  signal?: AbortSignal,
) {
  const post = await apiFetch<{ id: number; title: { raw: string } }>({
    path: `${path}?context=edit&_fields=id,title`,
    method: value === undefined ? "GET" : "POST",
    ...(value === undefined ? {} : { data: { title: value } }),
    signal,
  });
  if (post.id !== postId || typeof post.title?.raw !== "string") {
    throw new Error("Unexpected post response");
  }
  return post.title.raw;
}
