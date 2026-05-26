import { redis } from '@devvit/redis';
import type { ReviewLabel, TrialEvent, TrialRule } from '../shared/types';

const RULES_KEY = 'modtrials:rules';
const RULE_IDS_KEY = 'modtrials:rule_ids';
const EVENT_IDS_KEY = 'modtrials:event_ids';
const EVENTS_KEY = 'modtrials:events';
const COMMAND_IDS_KEY = 'modtrials:command_ids';

export async function saveRule(rule: TrialRule): Promise<void> {
  await redis.hSet(RULES_KEY, { [rule.id]: JSON.stringify(rule) });
  await redis.zAdd(RULE_IDS_KEY, { member: rule.id, score: Date.parse(rule.createdAt) });
}

export async function listRules(): Promise<TrialRule[]> {
  const ids = (await redis.zRange(RULE_IDS_KEY, 0, -1)).map((item) => item.member);
  if (ids.length === 0) return [];
  const values = await redis.hMGet(RULES_KEY, ids);
  return values.filter(Boolean).map((value) => JSON.parse(value as string) as TrialRule);
}

export async function getRule(ruleId: string): Promise<TrialRule | null> {
  const value = await redis.hGet(RULES_KEY, ruleId);
  return value ? (JSON.parse(value) as TrialRule) : null;
}

export async function deleteRule(ruleId: string): Promise<void> {
  await redis.hDel(RULES_KEY, [ruleId]);
  await redis.zRem(RULE_IDS_KEY, [ruleId]);
}

export async function saveEvent(event: TrialEvent): Promise<void> {
  const minimizedEvent = minimizeEvent(event);
  await redis.hSet(EVENTS_KEY, { [event.id]: JSON.stringify(minimizedEvent) });
  await redis.zAdd(EVENT_IDS_KEY, { member: event.id, score: Date.parse(event.createdAt) });
}

export async function getEvent(eventId: string): Promise<TrialEvent | null> {
  const value = await redis.hGet(EVENTS_KEY, eventId);
  return value ? (JSON.parse(value) as TrialEvent) : null;
}

export async function listEvents(ruleId?: string, limit = 100): Promise<TrialEvent[]> {
  const ids = (await redis.zRange(EVENT_IDS_KEY, 0, -1))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.member);
  if (ids.length === 0) return [];
  const values = await redis.hMGet(EVENTS_KEY, ids);
  const events = values.filter(Boolean).map((value) => minimizeEvent(JSON.parse(value as string) as TrialEvent));
  return ruleId ? events.filter((event) => event.ruleId === ruleId) : events;
}

export async function minimizeStoredEvents(limit = 250): Promise<number> {
  const ids = (await redis.zRange(EVENT_IDS_KEY, 0, -1))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.member);
  if (ids.length === 0) return 0;

  const values = await redis.hMGet(EVENTS_KEY, ids);
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

  await redis.hDel(EVENTS_KEY, events.map((event) => event.id));
  await redis.zRem(EVENT_IDS_KEY, events.map((event) => event.id));
  return events.length;
}

export async function markCommandProcessed(commandId: string): Promise<boolean> {
  const inserted = await redis.hSetNX(COMMAND_IDS_KEY, commandId, new Date().toISOString());
  return inserted === 1;
}

export async function labelEvent(eventId: string, reviewer: string, label: ReviewLabel): Promise<TrialEvent | null> {
  const value = await redis.hGet(EVENTS_KEY, eventId);
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
