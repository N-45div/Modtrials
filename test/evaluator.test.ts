import { describe, expect, it } from 'vitest';
import { evaluateRule } from '../src/shared/evaluator';
import type { ContentItem, TrialRule } from '../src/shared/types';

const now = '2026-05-17T12:00:00.000Z';

const baseRule: TrialRule = {
  id: 'rule-1',
  name: 'New user promo links',
  target: 'post',
  mode: 'shadow',
  action: 'hold',
  enabled: true,
  createdAt: now,
  updatedAt: now,
  conditions: {
    minAccountAgeDays: 14,
    keywords: ['promo'],
    externalLinkRequired: true,
  },
};

const baseItem: ContentItem = {
  id: 't3_post',
  target: 'post',
  title: 'My promo launch',
  body: 'Check this out https://example.com',
  authorCreatedAt: '2026-05-15T12:00:00.000Z',
  createdAt: now,
};

describe('evaluateRule', () => {
  it('matches only when every configured condition is satisfied', () => {
    const result = evaluateRule(baseRule, baseItem);
    expect(result.matched).toBe(true);
    expect(result.reasons.map((reason) => reason.code)).toEqual(['account_age', 'keyword', 'external_link']);
  });

  it('does not match when one configured condition fails', () => {
    const result = evaluateRule(baseRule, { ...baseItem, body: 'No link here' });
    expect(result.matched).toBe(false);
  });

  it('keeps post and comment rules separate', () => {
    const result = evaluateRule(baseRule, { ...baseItem, target: 'comment' });
    expect(result.matched).toBe(false);
  });

  it('supports short text trials without generating events by itself', () => {
    const result = evaluateRule(
      {
        ...baseRule,
        conditions: {
          externalLinkRequired: true,
          maxTextLength: 80,
        },
      },
      baseItem,
    );

    expect(result.matched).toBe(true);
    expect(result.reasons.map((reason) => reason.code)).toEqual(['short_text', 'external_link']);
  });
});
