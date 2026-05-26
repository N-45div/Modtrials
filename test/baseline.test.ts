import { describe, expect, it } from 'vitest';
import { buildBaselineRules, buildInlineRuleFromContent } from '../src/server/baseline';
import type { ContentItem } from '../src/shared/types';

describe('baseline trials', () => {
  it('creates safe shadow rules without trial events or enforcement actions', () => {
    const rules = buildBaselineRules([], '2026-05-22T00:00:00.000Z');

    expect(rules).toHaveLength(4);
    expect(rules.every((rule) => rule.mode === 'shadow')).toBe(true);
    expect(rules.every((rule) => rule.action === 'hold')).toBe(true);
    expect(rules.every((rule) => rule.source === 'baseline')).toBe(true);
    expect(rules.map((rule) => rule.name)).toContain('Giveaway or purchase intent');
    expect(rules.some((rule) => rule.conditions.regexes?.length)).toBe(true);
    expect(rules.some((rule) => rule.conditions.exemptKeywords?.length)).toBe(true);
  });

  it('builds an inline shadow rule from a real content item shape', () => {
    const content: ContentItem = {
      id: 't3_real',
      target: 'post',
      title: 'Launch feedback',
      body: 'Try it at https://example.com',
      url: 'https://example.com',
      createdAt: '2026-05-22T00:00:00.000Z',
    };

    const rule = buildInlineRuleFromContent(content, '2026-05-22T00:00:00.000Z');

    expect(rule.source).toBe('inline');
    expect(rule.mode).toBe('shadow');
    expect(rule.conditions.externalLinkRequired).toBe(true);
    expect(rule.conditions.keywords).toContain('launch');
    expect(rule.conditions.exemptKeywords).toContain('source:');
  });
});
