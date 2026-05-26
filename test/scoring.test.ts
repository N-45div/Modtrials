import { describe, expect, it } from 'vitest';
import { buildLaunchCard, computeMetrics } from '../src/shared/scoring';
import type { TrialEvent, TrialRule } from '../src/shared/types';

const rule: TrialRule = {
  id: 'rule-1',
  name: 'Promo links',
  target: 'post',
  mode: 'shadow',
  action: 'remove',
  enabled: true,
  createdAt: '2026-05-17T12:00:00.000Z',
  updatedAt: '2026-05-17T12:00:00.000Z',
  conditions: { externalLinkRequired: true },
};

function event(id: string, label: 'true_positive' | 'false_positive' | 'gray_area' | 'rewrite_rule'): TrialEvent {
  return {
    id,
    ruleId: rule.id,
    mode: 'shadow',
    action: 'remove',
    content: { id: `t3_${id}`, target: 'post', body: 'body', createdAt: rule.createdAt },
    reasons: [{ code: 'external_link', label: 'Contains external link' }],
    createdAt: rule.createdAt,
    labels: { mod: label },
  };
}

describe('launch scoring', () => {
  it('blocks auto-remove when false-positive risk is high', () => {
    const metrics = computeMetrics([
      event('1', 'false_positive'),
      event('2', 'false_positive'),
      event('3', 'true_positive'),
      event('4', 'true_positive'),
    ]);
    const card = buildLaunchCard(rule, metrics);
    expect(card.recommendation).toBe('do_not_auto_remove');
    expect(card.falsePositiveRisk).toBe('high');
  });

  it('recommends rewrite when reviewers mark the rule itself as bad', () => {
    const metrics = computeMetrics([
      event('1', 'rewrite_rule'),
      event('2', 'rewrite_rule'),
      event('3', 'true_positive'),
    ]);
    const card = buildLaunchCard(rule, metrics);
    expect(card.recommendation).toBe('rewrite_rule');
  });
});
