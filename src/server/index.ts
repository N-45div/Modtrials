import { serve } from '@hono/node-server';
import { context, createServer, getServerPort, reddit } from '@devvit/web/server';
import type { MenuItemRequest, UiResponse } from '@devvit/web/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { createRuleSchema, reviewLabelSchema } from '../shared/rule-schema';
import { buildLaunchCard, computeMetrics } from '../shared/scoring';
import type { ContentItem, ReviewLabel, TrialRule } from '../shared/types';
import { buildBaselineRules, buildInlineRuleFromContent } from './baseline';
import { buildReportDm, buildTrialDm, buildWhyDm, parseBotCommand } from './bot-commands';
import { getRecentContent, postToContent, commentToContent } from './reddit-content';
import { deleteEventsByContent, deleteRule, getRule, labelEvent, listEvents, listEventsByContent, listRules, markCommandProcessed, minimizeStoredEvents, saveRule } from './storage';
import { recordMatches } from './trials';

const app = new Hono();

app.get('/api/health', (c) => c.json({ status: 'ok', app: 'modtrials' }));

app.use('/api/*', async (_c, next) => {
  const denied = await requireContextModerator('json');
  if (denied) return denied;
  await next();
});

app.get('/api/rules', async (c) => {
  return c.json({ rules: await listRules() });
});

app.get('/api/overview', async (c) => {
  await minimizeStoredEvents();
  const rules = await listRules();
  const events = await listEvents(undefined, 250);
  const labels = events.flatMap((event) => Object.values(event.labels));
  const unlabeledEvents = events.filter((event) => Object.keys(event.labels).length === 0);
  const rulesWithEvents = new Set(events.map((event) => event.ruleId));

  return c.json({
    rules: {
      total: rules.length,
      baseline: rules.filter((rule) => rule.source === 'baseline').length,
      inline: rules.filter((rule) => rule.source === 'inline').length,
      active: rules.filter((rule) => rule.enabled).length,
      withEvidence: rulesWithEvents.size,
    },
    events: {
      total: events.length,
      unlabeled: unlabeledEvents.length,
      truePositive: labels.filter((label) => label === 'true_positive').length,
      falsePositive: labels.filter((label) => label === 'false_positive').length,
      grayArea: labels.filter((label) => label === 'gray_area').length,
    },
  });
});

app.post('/api/baseline/start', async (c) => {
  const existingRules = await listRules();
  const rules = buildBaselineRules(existingRules);
  for (const rule of rules) await saveRule(rule);
  return c.json({ created: rules.length, rules });
});

app.post('/api/trials/analyze-recent', async (c) => {
  const body = z.object({ limit: z.number().int().min(1).max(100).default(50) }).parse(await c.req.json().catch(() => ({})));
  const rules = (await listRules()).filter((rule) => rule.enabled && rule.target === 'post');
  const items = await getRecentContent('post', body.limit);
  const results = [];

  for (const rule of rules) {
    const events = await recordMatches({ ...rule, mode: 'retrospective' }, items, 'retrospective');
    results.push({ ruleId: rule.id, matched: events.length });
  }

  return c.json({
    scanned: items.length,
    rulesChecked: rules.length,
    matched: results.reduce((sum, result) => sum + result.matched, 0),
    results,
  });
});

app.post('/api/rules', async (c) => {
  const input = createRuleSchema.parse(await c.req.json());
  const now = new Date().toISOString();
  const rule: TrialRule = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  await saveRule(rule);
  return c.json({ rule }, 201);
});

app.delete('/api/rules/:ruleId', async (c) => {
  await deleteRule(c.req.param('ruleId'));
  return c.json({ status: 'deleted' });
});

app.post('/api/trials/retrospective', async (c) => {
  const body = z.object({ ruleId: z.string().min(1), limit: z.number().int().min(1).max(100).default(50) }).parse(await c.req.json());
  const rule = await requireRule(body.ruleId);
  const items = await getRecentContent(rule.target, body.limit);
  const events = await recordMatches({ ...rule, mode: 'retrospective' }, items, 'retrospective');
  return c.json({ scanned: items.length, matched: events.length, events });
});

app.get('/api/events', async (c) => {
  const ruleId = c.req.query('ruleId') || undefined;
  return c.json({ events: await listEvents(ruleId) });
});

app.post('/api/events/label', async (c) => {
  const body = reviewLabelSchema.parse(await c.req.json());
  const event = await labelEvent(body.eventId, context.username ?? body.reviewer, body.label);
  if (!event) return c.json({ error: 'Event not found' }, 404);
  return c.json({ event });
});

app.get('/api/launch-card/:ruleId', async (c) => {
  const rule = await requireRule(c.req.param('ruleId'));
  const events = await listEvents(rule.id, 250);
  const metrics = computeMetrics(events);
  return c.json({ rule, metrics, launchCard: buildLaunchCard(rule, metrics) });
});

app.post('/internal/triggers/on-post-submit', async (c) => {
  const payload = await c.req.json();
  const content = triggerPostToContent(payload);
  if (!content) return c.json({ status: 'ignored', reason: 'No post content in trigger payload' });
  const count = await processTriggerContent(content);
  return c.json({ status: 'ok', eventsCreated: count });
});

app.post('/internal/triggers/on-comment-submit', async (c) => {
  const payload = await c.req.json();
  const commandResult = await processBotCommand(payload);
  if (commandResult.handled) return c.json(commandResult.response);

  const content = triggerCommentToContent(payload);
  if (!content) return c.json({ status: 'ignored', reason: 'No comment content in trigger payload' });
  const count = await processTriggerContent(content);
  return c.json({ status: 'ok', eventsCreated: count });
});

app.post('/internal/triggers/on-post-delete', async (c) => {
  const payload = await c.req.json();
  const contentId = contentIdFromDeletePayload(payload, 'post');
  if (!contentId) return c.json({ status: 'ignored', reason: 'No post id in delete trigger payload' });
  const deleted = await deleteEventsByContent(contentId);
  return c.json({ status: 'ok', eventsDeleted: deleted });
});

app.post('/internal/triggers/on-comment-delete', async (c) => {
  const payload = await c.req.json();
  const contentId = contentIdFromDeletePayload(payload, 'comment');
  if (!contentId) return c.json({ status: 'ignored', reason: 'No comment id in delete trigger payload' });
  const deleted = await deleteEventsByContent(contentId);
  return c.json({ status: 'ok', eventsDeleted: deleted });
});

app.use('/internal/menu/*', async (_c, next) => {
  const denied = await requireContextModerator('toast');
  if (denied) return denied;
  await next();
});

app.post('/internal/menu/open-dashboard', async (c) => {
  await c.req.json<MenuItemRequest>();
  const subredditName = context.subredditName;
  if (!subredditName) {
    return c.json<UiResponse>({
      showToast: { text: 'ModTrials needs subreddit context to open.', appearance: 'neutral' },
    });
  }

  await ensureBaselineRules();

  await reddit.submitCustomPost({
    subredditName,
    title: 'ModTrials dashboard',
    entry: 'default',
  });

  return c.json<UiResponse>({
    showToast: { text: 'Created a ModTrials dashboard post.', appearance: 'success' },
  });
});

app.post('/internal/menu/trial-from-post', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  const content = await getMenuContent(request);
  if (!content) return toast('Could not read that Reddit item.', 'neutral');

  const { events } = await startPrivateTrial(content);

  return toast(`Started a shadow trial from this ${content.target}. Logged ${events.length} real match.`, 'success');
});

app.post('/internal/menu/trial-private', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  const content = await getMenuContent(request);
  if (!content) return toast('Could not read that Reddit item.', 'neutral');

  const { rule, events } = await startPrivateTrial(content);
  const sent = await sendPrivateResult('ModTrials private trial', buildTrialDm(content, rule, events));
  return toast(sent ? 'Private ModTrials result sent by DM.' : 'Started private trial, but DM could not be sent.', sent ? 'success' : 'neutral');
});

app.post('/internal/menu/why-private', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  const content = await getMenuContent(request);
  if (!content) return toast('Could not read that Reddit item.', 'neutral');

  const [event] = await listEventsByContent(content.id);
  const sent = await sendPrivateResult('ModTrials private why', buildWhyDm(content, event ?? null));
  return toast(sent ? 'Private ModTrials explanation sent by DM.' : 'Could not send private ModTrials explanation.', sent ? 'success' : 'neutral');
});

app.post('/internal/menu/report-private', async () => {
  const sent = await sendPrivateResult('ModTrials private report', buildReportDm(await listRules(), await listEvents(undefined, 250)));
  return toast(sent ? 'Private ModTrials report sent by DM.' : 'Could not send private ModTrials report.', sent ? 'success' : 'neutral');
});

app.post('/internal/menu/good-catch', async (c) => {
  return labelMenuContent(await c.req.json<MenuItemRequest>(), 'true_positive', 'Marked latest ModTrials event as a good catch.');
});

app.post('/internal/menu/false-positive', async (c) => {
  return labelMenuContent(await c.req.json<MenuItemRequest>(), 'false_positive', 'Marked latest ModTrials event as a false positive.');
});

app.post('/internal/menu/too-gray', async (c) => {
  return labelMenuContent(await c.req.json<MenuItemRequest>(), 'gray_area', 'Marked latest ModTrials event as too subjective.');
});

app.post('/internal/scheduler/daily-rule-health', async (c) => {
  const rules = await listRules();
  return c.json({ status: 'ok', rulesChecked: rules.length });
});

async function requireRule(ruleId: string): Promise<TrialRule> {
  const rule = await getRule(ruleId);
  if (!rule) throw new Error(`Rule not found: ${ruleId}`);
  return rule;
}

async function ensureBaselineRules(): Promise<number> {
  const rules = buildBaselineRules(await listRules());
  for (const rule of rules) await saveRule(rule);
  return rules.length;
}

async function getMenuContent(request: MenuItemRequest): Promise<ContentItem | null> {
  if (request.location === 'post' && request.targetId.startsWith('t3_')) {
    const post = await reddit.getPostById(request.targetId as `t3_${string}`);
    return postToContent(post as Parameters<typeof postToContent>[0]);
  }

  if (request.location === 'comment' && request.targetId.startsWith('t1_')) {
    const comment = await reddit.getCommentById(request.targetId as `t1_${string}`);
    return commentToContent(comment as Parameters<typeof commentToContent>[0]);
  }

  return null;
}

async function startPrivateTrial(content: ContentItem): Promise<{ rule: TrialRule; events: ReturnType<typeof recordMatches> extends Promise<infer T> ? T : never }> {
  const rule = buildInlineRuleFromContent(content);
  await saveRule(rule);
  const events = await recordMatches(rule, [content], 'shadow');
  return { rule, events };
}

async function processBotCommand(payload: unknown): Promise<{ handled: boolean; response: Record<string, unknown> }> {
  const rawComment = unwrapPayload(payload, ['comment', 'commentSubmit', 'data']);
  if (!rawComment || typeof rawComment !== 'object') return { handled: false, response: {} };

  const commandComment = commentToContent(rawComment as Parameters<typeof commentToContent>[0]);
  const command = parseBotCommand(commandComment.body);
  if (!command) return { handled: false, response: {} };

  const firstHandler = await markCommandProcessed(commandComment.id);
  if (!firstHandler) return { handled: true, response: { status: 'ignored', reason: 'Command already processed' } };

  const authorName = readString(payload, ['author.name', 'authorName']) ?? readString(rawComment, ['authorName', 'author', 'author_name']);
  if (!authorName) return { handled: true, response: { status: 'ignored', reason: 'Command author missing', keys: Object.keys(payload as Record<string, unknown>) } };

  const isMod = await isModerator(authorName);
  if (!isMod) return { handled: true, response: { status: 'ignored', reason: 'Command author is not a moderator' } };

  const parentId = readString(rawComment, ['parentId', 'parent_id']);
  if (!parentId) return { handled: true, response: { status: 'ignored', reason: 'Command parent missing' } };

  const parent = await getContentById(parentId);
  if (!parent) return { handled: true, response: { status: 'ignored', reason: 'Command parent not readable' } };

  if (command.action === 'trial') {
    const { rule, events } = await startPrivateTrial(parent);
    await sendPrivateMessage(authorName, 'ModTrials private trial', buildTrialDm(parent, rule, events));
  } else if (command.action === 'why') {
    const [event] = await listEventsByContent(parent.id);
    await sendPrivateMessage(authorName, 'ModTrials private why', buildWhyDm(parent, event ?? null));
  } else {
    await sendPrivateMessage(authorName, 'ModTrials private report', buildReportDm(await listRules(), await listEvents(undefined, 250)));
  }

  await removeCommandComment(commandComment.id);
  return { handled: true, response: { status: 'ok', command: command.action, delivery: 'private_message' } };
}

function contentIdFromDeletePayload(payload: unknown, target: 'post' | 'comment'): string | null {
  const rawId = target === 'post' ? readString(payload, ['postId', 'post.id']) : readString(payload, ['commentId', 'comment.id']);
  if (!rawId) return null;
  const prefix = target === 'post' ? 't3_' : 't1_';
  return rawId.startsWith(prefix) ? rawId : `${prefix}${rawId}`;
}

async function getContentById(id: string): Promise<ContentItem | null> {
  if (id.startsWith('t3_')) {
    const post = await reddit.getPostById(id as `t3_${string}`);
    return postToContent(post as Parameters<typeof postToContent>[0]);
  }

  if (id.startsWith('t1_')) {
    const comment = await reddit.getCommentById(id as `t1_${string}`);
    return commentToContent(comment as Parameters<typeof commentToContent>[0]);
  }

  return null;
}

async function isModerator(username: string): Promise<boolean> {
  const subredditName = context.subredditName;
  if (!subredditName) return false;

  try {
    const moderators = await reddit.getModerators({ subredditName, username }).all();
    return moderators.some((moderator) => moderator.username.toLowerCase() === username.toLowerCase());
  } catch (error) {
    console.warn('[ModTrials] Moderator check failed', error);
    return false;
  }
}

async function requireContextModerator(responseType: 'json' | 'toast'): Promise<Response | null> {
  const username = context.username;
  const allowed = username ? await isModerator(username) : false;
  if (allowed) return null;

  if (responseType === 'toast') {
    return toast('ModTrials actions are only available to subreddit moderators.', 'neutral');
  }

  return Response.json({ error: 'Moderator access required' }, { status: 403 });
}

async function sendPrivateResult(subject: string, text: string): Promise<boolean> {
  const username = context.username;
  if (!username) return false;
  return sendPrivateMessage(username, subject, text);
}

async function sendPrivateMessage(username: string, subject: string, text: string): Promise<boolean> {
  try {
    await reddit.sendPrivateMessage({ to: username, subject, text });
    return true;
  } catch (error) {
    console.warn('[ModTrials] Private message failed', error);
    return false;
  }
}

async function removeCommandComment(commentId: string): Promise<void> {
  try {
    const commandComment = await reddit.getCommentById(commentId as `t1_${string}`);
    await commandComment.remove(false);
  } catch (error) {
    console.warn('[ModTrials] Command cleanup failed', error);
  }
}

function readString(value: unknown, keys: string[]): string | null {
  if (!value || typeof value !== 'object') return null;
  for (const key of keys) {
    const candidate = readPath(value, key);
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  return null;
}

function readPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return null;
    return (current as Record<string, unknown>)[part];
  }, value);
}

async function labelMenuContent(request: MenuItemRequest, label: ReviewLabel, message: string): Promise<Response> {
  const content = await getMenuContent(request);
  if (!content) return toast('Could not read that Reddit item.', 'neutral');

  const [event] = await listEventsByContent(content.id);
  if (!event) {
    return toast('No ModTrials event exists for this item yet. Use "Trial posts like this" first or wait for a shadow match.', 'neutral');
  }

  await labelEvent(event.id, context.username ?? 'mod', label);
  return toast(message, 'success');
}

function toast(text: string, appearance: 'success' | 'neutral' = 'neutral'): Response {
  return Response.json({ showToast: { text, appearance } } satisfies UiResponse);
}

async function processTriggerContent(content: ContentItem): Promise<number> {
  const rules = (await listRules()).filter((rule) => rule.enabled && rule.target === content.target && ['shadow', 'repair'].includes(rule.mode));
  let count = 0;
  for (const rule of rules) {
    const events = await recordMatches(rule, [content], rule.mode);
    count += events.length;
  }
  return count;
}

function triggerPostToContent(payload: unknown): ContentItem | null {
  const post = unwrapPayload(payload, ['post', 'postSubmit', 'data']);
  if (!post || typeof post !== 'object') return null;
  return postToContent(post as Parameters<typeof postToContent>[0]);
}

function triggerCommentToContent(payload: unknown): ContentItem | null {
  const comment = unwrapPayload(payload, ['comment', 'commentSubmit', 'data']);
  if (!comment || typeof comment !== 'object') return null;
  return commentToContent(comment as Parameters<typeof commentToContent>[0]);
}

function unwrapPayload(payload: unknown, keys: string[]): unknown {
  if (!payload || typeof payload !== 'object') return null;
  for (const key of keys) {
    const value = (payload as Record<string, unknown>)[key];
    if (value && typeof value === 'object') return value;
  }
  return payload;
}

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
