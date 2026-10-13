import { getCollection } from "astro:content";

// Drafts are visible in dev so they can be previewed, hidden in production.
export async function getPosts() {
  const posts = await getCollection(
    "posts",
    ({ data }) => import.meta.env.DEV || !data.draft,
  );
  return posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}
