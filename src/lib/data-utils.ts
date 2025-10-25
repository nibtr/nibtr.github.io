import { getCollection, type CollectionEntry } from "astro:content"
import { calculateWordCountFromHtml, readingTime } from "@lib/utils";

export async function getAllPosts(): Promise<CollectionEntry<"posts">[]> {
  const posts = await getCollection("posts")
  return posts
    .filter((post) => !post.data.draft && !isSubpost(post.id))
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf())
}

export function groupPostsByYear(posts: CollectionEntry<"posts">[]): Record<string, CollectionEntry<"posts">[]> {
  return posts.reduce(
    (acc: Record<string, CollectionEntry<"posts">[]>, post) => {
      const year = post.data.date.getFullYear().toString();
      (acc[year] ??= []).push(post)
      return acc
    },
    {},
  )
}

export function getParentId(subpostId: string): string {
  return subpostId.split('/')[0] ?? ""
}

export function isSubpost(postId: string): boolean {
  return postId.includes("/")
}

export async function hasSubposts(postId: string): Promise<boolean> {
  const subposts = await getSubpostsForParent(postId)
  return subposts.length > 0
}

export async function getSubpostsForParent(
  parentId: string,
): Promise<CollectionEntry<"posts">[]> {
  const posts = await getCollection("posts")
  return posts
    .filter(
      (post) =>
        !post.data.draft &&
        isSubpost(post.id) &&
        getParentId(post.id) === parentId,
    )
    .sort((a, b) => {
      const dateDiff = a.data.date.valueOf() - b.data.date.valueOf()
      if (dateDiff !== 0) return dateDiff

      const orderA = a.data.order ?? 0
      const orderB = b.data.order ?? 0
      return orderA - orderB
    })
}

export async function getAllPostsAndSubposts(): Promise<CollectionEntry<"posts">[]> {
  const posts = await getCollection("posts")
  return posts
    .filter((post) => !post.data.draft)
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf())
}

export async function getSubpostCount(parentId: string): Promise<number> {
  const subposts = await getSubpostsForParent(parentId)
  return subposts.length
}

export async function getPostById(
  postId: string,
): Promise<CollectionEntry<"posts"> | null> {
  const allPosts = await getAllPostsAndSubposts()
  return allPosts.find((post) => post.id === postId) || null
}

export async function getPostReadingTime(postId: string): Promise<string> {
  const post = await getPostById(postId)
  if (!post) return readingTime(0)

  const wordCount = calculateWordCountFromHtml(post.body)
  return readingTime(wordCount)
}

export async function getCombinedReadingTime(postId: string): Promise<string> {
  const post = await getPostById(postId)
  if (!post) return readingTime(0)

  let totalWords = calculateWordCountFromHtml(post.body)

  if (!isSubpost(postId)) {
    const subposts = await getSubpostsForParent(postId)
    for (const subpost of subposts) {
      totalWords += calculateWordCountFromHtml(subpost.body)
    }
  }

  return readingTime(totalWords)
}
