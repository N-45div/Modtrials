import type { ContentItem, TrialEvent, TrialRule } from '../shared/types';
import { buildLaunchCard, computeMetrics } from '../shared/scoring';

export type BotCommand = {
  action: 'trial' | 'why' | 'report';
  dm: boolean;
};

export function parseBotCommand(body: string): BotCommand | null {
  const normalized = body
    .toLowerCase()
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!/(^|\s)(u\/modtrials|\/u\/modtrials|@modtrials)\b/.test(normalized)) return null;

  const dm = normalized.includes('--dm') || normalized.includes(' dm') || normalized.includes(' privately') || normalized.includes(' private');
  if (/\breport\b/.test(normalized)) return { action: 'report', dm };
  if (/\bwhy\b/.test(normalized)) return { action: 'why', dm };
  if (/\btrial\b/.test(normalized) && /\bthis\b/.test(normalized)) return { action: 'trial', dm };
  return null;
}

export function buildTrialDm(content: ContentItem, rule: TrialRule, events: TrialEvent[]): string {
  const reasons = events.flatMap((event) => event.reasons.map((reason) => reason.label));
  return [
    'ModTrials private result',
    '',
    `Shadow trial started for this ${content.target}.`,
    `Rule: ${rule.name}`,
    `Logged real matches: ${events.length}`,
    '',
    'Counterfactual result:',
    `- If this rule were live, this ${content.target} would have been ${actionPhrase(rule.action)}.`,
    '- No user-facing action was taken.',
    '',
    'Matched reasons:',
    ...(reasons.length > 0 ? reasons.map((reason) => `- ${reason}`) : ['- No match was recorded for this item yet.']),
    '',
    ...privacyReceipt(),
  ].join('\n');
}

export function buildWhyDm(content: ContentItem, event: TrialEvent | null): string {
  if (!event) {
    return [
      'ModTrials private result',
      '',
      `No stored trial event exists for this ${content.target} yet.`,
      'Start one with "u/modtrials trial this --dm" or the private post/comment menu action.',
    ].join('\n');
  }

  return [
    'ModTrials private result',
    '',
    `This ${content.target} matched a shadow trial.`,
    '',
    'Matched reasons:',
    ...event.reasons.map((reason) => `- ${reason.label}${reason.detail ? `: ${reason.detail}` : ''}`),
    '',
    `Mode: ${event.mode}`,
    `Action under test: ${event.action}`,
    '',
    'Counterfactual result:',
    `- If this rule were live, this ${content.target} would have been ${actionPhrase(event.action)}.`,
    '- No user-facing action was taken.',
    '',
    ...privacyReceipt(),
  ].join('\n');
}

export function buildReportDm(rules: TrialRule[], events: TrialEvent[]): string {
  const activeRules = rules.filter((rule) => rule.enabled);
  const unlabeled = events.filter((event) => Object.keys(event.labels).length === 0);
  const metrics = computeMetrics(events);
  const launchCard = activeRules[0] ? buildLaunchCard(activeRules[0], metrics) : null;

  return [
    'ModTrials private report',
    '',
    `Active trials: ${activeRules.length}`,
    `Trial events: ${events.length}`,
    `Needs review: ${unlabeled.length}`,
    `False-positive rate: ${Math.round(metrics.falsePositiveRate * 100)}%`,
    `Gray-area rate: ${Math.round(metrics.grayAreaRate * 100)}%`,
    '',
    launchCard ? `Readiness: ${launchCard.readinessScore}/100` : 'Readiness: not available yet',
    launchCard ? `Recommendation: ${launchCard.recommendation.replace(/_/g, ' ')}` : 'Recommendation: collect real trial evidence first',
    '',
    ...privacyReceipt(),
  ].join('\n');
}

function actionPhrase(action: TrialRule['action']): string {
  if (action === 'hold') return 'held for moderator review';
  if (action === 'repair') return 'sent through a repair-first flow';
  if (action === 'warn') return 'warned';
  return 'removed';
}

function privacyReceipt(): string[] {
  return [
    'Privacy receipt:',
    '- Stored: Reddit item ID, rule ID, matched reasons, labels, timestamps',
    '- Not stored: username, full body, raw title, raw URL',
    '- Public action: none',
    '- Cleanup: evidence is keyed to the Reddit item ID for deletion cleanup',
  ];
}
