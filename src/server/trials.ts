import { evaluateRule } from '../shared/evaluator';
import type { ContentItem, TrialEvent, TrialRule } from '../shared/types';
import { getEvent, saveEvent } from './storage';

export async function recordMatches(rule: TrialRule, items: ContentItem[], mode = rule.mode): Promise<TrialEvent[]> {
  const now = new Date().toISOString();
  const events: TrialEvent[] = [];

  for (const item of items) {
    const result = evaluateRule(rule, item);
    if (!result.matched) continue;

    const eventId = `${rule.id}:${mode}:${item.id}`;
    const existingEvent = await getEvent(eventId);
    if (existingEvent) {
      events.push(existingEvent);
      continue;
    }

    const event: TrialEvent = {
      id: eventId,
      ruleId: rule.id,
      mode,
      action: rule.action,
      content: minimizeContent(item),
      reasons: result.reasons,
      createdAt: now,
      labels: {},
      repairState: rule.action === 'repair' || mode === 'repair' ? 'requested' : undefined,
    };

    await saveEvent(event);
    events.push(event);
  }

  return events;
}

function minimizeContent(item: ContentItem): ContentItem {
  return {
    id: item.id,
    target: item.target,
    title: undefined,
    body: '',
    createdAt: item.createdAt,
    permalink: item.permalink,
  };
}
