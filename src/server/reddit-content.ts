import { context, reddit } from '@devvit/web/server';
import type { ContentItem, RuleTarget } from '../shared/types';

type RedditPostLike = {
  id: string;
  title?: string;
  body?: string;
  selftext?: string;
  authorName?: string;
  author?: string;
  createdAt?: Date | string | number;
  url?: string;
  permalink?: string;
  linkFlairText?: string;
};

type RedditCommentLike = {
  id: string;
  body?: string;
  authorName?: string;
  author?: string;
  createdAt?: Date | string | number;
  permalink?: string;
  parentId?: string;
  postId?: string;
};

export async function getRecentContent(target: RuleTarget, limit: number): Promise<ContentItem[]> {
  const subredditName = context.subredditName;
  if (!subredditName) {
    throw new Error('Reddit subreddit context is required. Run this through Devvit playtest or an installed app.');
  }

  if (target === 'post') {
    const listing = await reddit.getNewPosts({ subredditName, limit });
    const posts = await listing.all();
    return posts.map((post) => postToContent(post as RedditPostLike));
  }

  throw new Error('Retrospective comment trials need a selected post thread. Shadow comment trials are supported from real Devvit comment-submit triggers.');
}

export function postToContent(post: RedditPostLike): ContentItem {
  return {
    id: post.id.startsWith('t3_') ? post.id : `t3_${post.id}`,
    target: 'post',
    title: post.title ?? '',
    body: post.body ?? post.selftext ?? '',
    authorName: post.authorName ?? post.author,
    flair: post.linkFlairText,
    url: post.url,
    permalink: post.permalink,
    createdAt: dateString(post.createdAt),
  };
}

export function commentToContent(comment: RedditCommentLike): ContentItem {
  return {
    id: comment.id.startsWith('t1_') ? comment.id : `t1_${comment.id}`,
    target: 'comment',
    body: comment.body ?? '',
    authorName: comment.authorName ?? comment.author,
    permalink: comment.permalink,
    createdAt: dateString(comment.createdAt),
  };
}

function dateString(value: Date | string | number | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return new Date(value < 10_000_000_000 ? value * 1000 : value).toISOString();
  return new Date().toISOString();
}
