import { FeedPost } from '../types';

async function parseResponse(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Something went wrong. Please try again.');
  }
  return data;
}

export async function fetchFeed(): Promise<FeedPost[]> {
  const res = await fetch('/api/posts', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.posts;
}

export interface CreatePostPayload {
  content: string;
  postType?: FeedPost['postType'];
  conferenceId?: string;
  conferenceTitle?: string;
  celebrationKind?: FeedPost['celebrationKind'];
  celebrationHeadline?: string;
  authorName?: string;
  authorTitle?: string;
  authorOrg?: string;
  authorAvatar?: string;
  authorUserId?: string;
}

export async function createPost(payload: CreatePostPayload): Promise<FeedPost> {
  const res = await fetch('/api/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await parseResponse(res);
  return data.post;
}

export async function reactToPost(postId: string, reaction: 'like' | 'celebrate' | 'insightful' | 'kudos'): Promise<FeedPost> {
  const res = await fetch(`/api/posts/${postId}/react`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ reaction }),
  });
  const data = await parseResponse(res);
  return data.post;
}

export interface PostComment {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  text: string;
  timestamp: string;
}

export async function fetchComments(postId: string): Promise<PostComment[]> {
  const res = await fetch(`/api/posts/${postId}/comments`, { credentials: 'include' });
  const data = await parseResponse(res);
  return data.comments;
}

export async function addComment(postId: string, text: string): Promise<PostComment> {
  const res = await fetch(`/api/posts/${postId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ text }),
  });
  const data = await parseResponse(res);
  return data.comment;
}

export async function toggleRepost(postId: string): Promise<FeedPost> {
  const res = await fetch(`/api/posts/${postId}/repost`, {
    method: 'POST',
    credentials: 'include',
  });
  const data = await parseResponse(res);
  return data.post;
}

export async function toggleSave(postId: string): Promise<FeedPost> {
  const res = await fetch(`/api/posts/${postId}/save`, {
    method: 'POST',
    credentials: 'include',
  });
  const data = await parseResponse(res);
  return data.post;
}
