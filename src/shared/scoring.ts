import type { LaunchCard, LaunchRecommendation, ReviewLabel, TrialEvent, TrialMetrics, TrialRule } from './types';

export function computeMetrics(events: TrialEvent[]): TrialMetrics {
  const labels = events.flatMap((event) => Object.values(event.labels));
  const labeledEvents = events.filter((event) => Object.keys(event.labels).length > 0);

  return {
    totalEvents: events.length,
    labeledEvents: labeledEvents.length,
    truePositiveRate: rate(labels, 'true_positive'),
    falsePositiveRate: rate(labels, 'false_positive'),
    grayAreaRate: rate(labels, 'gray_area'),
    rewriteRate: rate(labels, 'rewrite_rule'),
    queueLoadEstimate: events.length,
    modAgreementRate: agreementRate(labeledEvents),
    repairSuccessRate: repairSuccessRate(events),
  };
}

export function buildLaunchCard(rule: TrialRule, metrics: TrialMetrics): LaunchCard {
  const sampleScore = Math.min(25, metrics.totalEvents * 2);
  const falsePositivePenalty = Math.round(metrics.falsePositiveRate * 35);
  const grayPenalty = Math.round(metrics.grayAreaRate * 20);
  const rewritePenalty = Math.round(metrics.rewriteRate * 25);
  const repairBonus = metrics.repairSuccessRate === null ? 0 : Math.round(metrics.repairSuccessRate * 15);
  const agreementBonus = metrics.modAgreementRate === null ? 0 : Math.round(metrics.modAgreementRate * 10);

  const readinessScore = clamp(40 + sampleScore + repairBonus + agreementBonus - falsePositivePenalty - grayPenalty - rewritePenalty);
  const falsePositiveRisk = risk(metrics.falsePositiveRate, 0.12, 0.28);
  const grayAreaRisk = risk(metrics.grayAreaRate, 0.15, 0.35);
  const confidence = metrics.totalEvents >= 25 && metrics.labeledEvents >= 10 ? 'high' : metrics.totalEvents >= 10 ? 'medium' : 'low';
  const recommendation = chooseRecommendation(rule, metrics, readinessScore);

  return {
    readinessScore,
    recommendation,
    falsePositiveRisk,
    grayAreaRisk,
    queueLoadIncrease: metrics.queueLoadEstimate,
    confidence,
    reasons: explain(rule, metrics, recommendation),
  };
}

function chooseRecommendation(rule: TrialRule, metrics: TrialMetrics, score: number): LaunchRecommendation {
  if (metrics.rewriteRate >= 0.2) return 'rewrite_rule';
  if (metrics.falsePositiveRate >= 0.3 || metrics.grayAreaRate >= 0.35) return 'do_not_auto_remove';
  if (score < 45) return 'rewrite_rule';
  if (rule.action === 'remove' && (metrics.falsePositiveRate >= 0.12 || metrics.grayAreaRate >= 0.18)) return 'launch_hold_for_review';
  if (rule.action === 'repair' || (metrics.repairSuccessRate !== null && metrics.repairSuccessRate >= 0.5)) return 'launch_repair_first';
  if (rule.action === 'warn' || score < 70) return 'launch_as_warning';
  return 'safe_to_launch';
}

function explain(rule: TrialRule, metrics: TrialMetrics, recommendation: LaunchRecommendation): string[] {
  const reasons: string[] = [];
  if (metrics.totalEvents === 0) reasons.push('No matching trial events yet; keep collecting evidence.');
  if (metrics.falsePositiveRate >= 0.3) reasons.push('False-positive labels are too high for automatic enforcement.');
  if (metrics.grayAreaRate >= 0.35) reasons.push('Many matches are gray-area decisions that need moderator judgment.');
  if (metrics.repairSuccessRate !== null && metrics.repairSuccessRate >= 0.5) reasons.push('Repair-first flow is working for a majority of reviewed users.');
  if (recommendation === 'launch_hold_for_review') reasons.push('The rule may be useful, but removals should stay behind human review.');
  if (rule.action === 'remove') reasons.push('Removal is the highest-impact action, so the launch threshold is stricter.');
  if (metrics.labeledEvents < 10) reasons.push('Confidence is limited until more examples are reviewed by moderators.');
  return reasons;
}

function rate(labels: ReviewLabel[], label: ReviewLabel): number {
  if (labels.length === 0) return 0;
  return labels.filter((value) => value === label).length / labels.length;
}

function agreementRate(events: TrialEvent[]): number | null {
  const multiLabeled = events.filter((event) => Object.keys(event.labels).length > 1);
  if (multiLabeled.length === 0) return null;
  const agreeing = multiLabeled.filter((event) => new Set(Object.values(event.labels)).size === 1);
  return agreeing.length / multiLabeled.length;
}

function repairSuccessRate(events: TrialEvent[]): number | null {
  const repairEvents = events.filter((event) => event.repairState);
  if (repairEvents.length === 0) return null;
  return repairEvents.filter((event) => event.repairState === 'fixed').length / repairEvents.length;
}

function risk(value: number, medium: number, high: number): 'low' | 'medium' | 'high' {
  if (value >= high) return 'high';
  if (value >= medium) return 'medium';
  return 'low';
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}
