import { redis } from '@devvit/redis';
import { context } from '@devvit/web/server';
import type { ReviewLabel, TrialEvent, TrialRule } from '../shared/types';

const KEY_NAMES = {
  rules: 'rules',
  ruleIds: 'rule_ids',
  eventIds: 'event_ids',
  events: 'events',
  commandIds: 'command_ids',
} as const;

export async function saveRule(rule: TrialRule): Promise<void> {
  const keys = storageKeys();
  await redis.hSet(keys.rules, { [rule.id]: JSON.stringify(rule) });
  await redis.zAdd(keys.ruleIds, { member: rule.id, score: Date.parse(rule.createdAt) });
}

export async function listRules(): Promise<TrialRule[]> {
  const keys = storageKeys();
  const ids = (await redis.zRange(keys.ruleIds, 0, -1)).map((item) => item.member);
  if (ids.length === 0) return [];
  const values = await redis.hMGet(keys.rules, ids);
  return values.filter(Boolean).map((value) => JSON.parse(value as string) as TrialRule);
}

export async function getRule(ruleId: string): Promise<TrialRule | null> {
  const value = await redis.hGet(storageKeys().rules, ruleId);
  return value ? (JSON.parse(value) as TrialRule) : null;
}

export async function deleteRule(ruleId: string): Promise<void> {
  const keys = storageKeys();
  await redis.hDel(keys.rules, [ruleId]);
  await redis.zRem(keys.ruleIds, [ruleId]);
}

export async function saveEvent(event: TrialEvent): Promise<void> {
  const keys = storageKeys();
  const minimizedEvent = minimizeEvent(event);
  await redis.hSet(keys.events, { [event.id]: JSON.stringify(minimizedEvent) });
  await redis.zAdd(keys.eventIds, { member: event.id, score: Date.parse(event.createdAt) });
}

export async function getEvent(eventId: string): Promise<TrialEvent | null> {
  const value = await redis.hGet(storageKeys().events, eventId);
  return value ? (JSON.parse(value) as TrialEvent) : null;
}

export async function listEvents(ruleId?: string, limit = 100): Promise<TrialEvent[]> {
  const keys = storageKeys();
  const ids = (await redis.zRange(keys.eventIds, 0, -1))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.member);
  if (ids.length === 0) return [];
  const values = await redis.hMGet(keys.events, ids);
  const events = values.filter(Boolean).map((value) => minimizeEvent(JSON.parse(value as string) as TrialEvent));
  return ruleId ? events.filter((event) => event.ruleId === ruleId) : events;
}

export async function minimizeStoredEvents(limit = 250): Promise<number> {
  const keys = storageKeys();
  const ids = (await redis.zRange(keys.eventIds, 0, -1))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.member);
  if (ids.length === 0) return 0;

  const values = await redis.hMGet(keys.events, ids);
  let updated = 0;
  for (const value of values) {
    if (!value) continue;
    const event = JSON.parse(value as string) as TrialEvent;
    if (!hasPrivateSnapshot(event)) continue;
    await saveEvent(minimizeEvent(event));
    updated += 1;
  }
  return updated;
}

export async function listEventsByContent(contentId: string, limit = 20): Promise<TrialEvent[]> {
  const events = await listEvents(undefined, 250);
  return events.filter((event) => event.content.id === contentId).slice(0, limit);
}

export async function deleteEventsByContent(contentId: string): Promise<number> {
  const events = await listEventsByContent(contentId, 250);
  if (events.length === 0) return 0;

  const keys = storageKeys();
  await redis.hDel(keys.events, events.map((event) => event.id));
  await redis.zRem(keys.eventIds, events.map((event) => event.id));
  return events.length;
}

export async function markCommandProcessed(commandId: string): Promise<boolean> {
  const inserted = await redis.hSetNX(storageKeys().commandIds, commandId, new Date().toISOString());
  return inserted === 1;
}

export async function labelEvent(eventId: string, reviewer: string, label: ReviewLabel): Promise<TrialEvent | null> {
  const value = await redis.hGet(storageKeys().events, eventId);
  if (!value) return null;

  const event = JSON.parse(value) as TrialEvent;
  event.labels[reviewer] = label;
  await saveEvent(event);
  return event;
}

function minimizeEvent(event: TrialEvent): TrialEvent {
  return {
    ...event,
    content: {
      id: event.content.id,
      target: event.content.target,
      body: '',
      createdAt: event.content.createdAt,
      permalink: event.content.permalink,
    },
  };
}

function hasPrivateSnapshot(event: TrialEvent): boolean {
  return Boolean(event.content.title || event.content.body || event.content.authorName || event.content.authorCreatedAt || event.content.url || event.content.flair);
}

export function storageKeysForSubreddit(subredditName: string | undefined | null): Record<keyof typeof KEY_NAMES, string> {
  const scope = normalizeSubredditName(subredditName);
  return {
    rules: `modtrials:${scope}:${KEY_NAMES.rules}`,
    ruleIds: `modtrials:${scope}:${KEY_NAMES.ruleIds}`,
    eventIds: `modtrials:${scope}:${KEY_NAMES.eventIds}`,
    events: `modtrials:${scope}:${KEY_NAMES.events}`,
    commandIds: `modtrials:${scope}:${KEY_NAMES.commandIds}`,
  };
}

function storageKeys(): Record<keyof typeof KEY_NAMES, string> {
  return storageKeysForSubreddit(context.subredditName);
}

function normalizeSubredditName(subredditName: string | undefined | null): string {
  const normalized = subredditName?.trim().replace(/^r\//i, '').toLowerCase();
  if (!normalized) {
    throw new Error('ModTrials storage requires subreddit context.');
  }
  return normalized.replace(/[^a-z0-9_]/g, '_');
}
