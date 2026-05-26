import type { ContentItem, TrialRule } from '../shared/types';
import { extractUrls, domainFromUrl } from '../shared/evaluator';

const PROMO_KEYWORDS = ['launch', 'promo', 'buy', 'discount', 'affiliate', 'deal', 'sale', 'subscribe'];
const RISKY_DOMAINS = ['bit.ly', 'tinyurl.com', 't.co', 'gumroad.com', 'linktr.ee', 'beacons.ai'];
const GOOD_FAITH_EXEMPTIONS = ['source:', 'sources:', 'research', 'case study', 'open source', 'disclosure'];

export function buildBaselineRules(existingRules: TrialRule[], now = new Date().toISOString()): TrialRule[] {
  const existingNames = new Set(existingRules.map((rule) => rule.name));
  const templates: Omit<TrialRule, 'id' | 'createdAt' | 'updatedAt'>[] = [
    {
      name: 'Promo language with external links',
      description: 'Safely watches for posts/comments that combine promo terms with outside links.',
      source: 'baseline',
      target: 'post',
      mode: 'shadow',
      action: 'hold',
      enabled: true,
      conditions: {
        keywords: PROMO_KEYWORDS,
        exemptKeywords: GOOD_FAITH_EXEMPTIONS,
        externalLinkRequired: true,
      },
    },
    {
      name: 'Short external-link posts',
      description: 'Flags thin posts where most of the value is an outside link.',
      source: 'baseline',
      target: 'post',
      mode: 'shadow',
      action: 'hold',
      enabled: true,
      conditions: {
        externalLinkRequired: true,
        maxTextLength: 180,
        maxNonLinkTextLength: 120,
        exemptKeywords: GOOD_FAITH_EXEMPTIONS,
      },
    },
    {
      name: 'Common promo or redirect domains',
      description: 'Watches domains often used for promotions, redirects, and off-platform funnels.',
      source: 'baseline',
      target: 'post',
      mode: 'shadow',
      action: 'hold',
      enabled: true,
      conditions: {
        domains: RISKY_DOMAINS,
      },
    },
    {
      name: 'Giveaway or purchase intent',
      description: 'Watches for common commercial phrasing without using AI.',
      source: 'baseline',
      target: 'post',
      mode: 'shadow',
      action: 'hold',
      enabled: true,
      conditions: {
        regexes: ['\\b(buy|subscribe|discount|limited time|early access|affiliate)\\b'],
        externalLinkRequired: true,
        exemptKeywords: GOOD_FAITH_EXEMPTIONS,
      },
    },
  ];

  return templates
    .filter((template) => !existingNames.has(template.name))
    .map((template) => ({
      ...template,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }));
}

export function buildInlineRuleFromContent(content: ContentItem, now = new Date().toISOString()): TrialRule {
  const text = `${content.title ?? ''} ${content.body}`.toLowerCase();
  const matchedKeywords = PROMO_KEYWORDS.filter((keyword) => text.includes(keyword));
  const domains = Array.from(new Set(extractUrls(`${content.url ?? ''}\n${content.body}`).map(domainFromUrl).filter((domain): domain is string => Boolean(domain))));
  const hasExternalLink = domains.length > 0;

  return {
    id: crypto.randomUUID(),
    name: shortRuleName(content),
    description: 'Created from a real post using the post menu. Runs in shadow mode only.',
    source: 'inline',
    target: content.target,
    mode: 'shadow',
    action: 'hold',
    enabled: true,
    createdAt: now,
    updatedAt: now,
    conditions: {
      keywords: matchedKeywords.length > 0 ? matchedKeywords : undefined,
      exemptKeywords: GOOD_FAITH_EXEMPTIONS,
      domains: matchedKeywords.length === 0 && domains.length > 0 ? domains.slice(0, 3) : undefined,
      externalLinkRequired: hasExternalLink || undefined,
      maxTextLength: text.trim().length <= 220 ? 240 : undefined,
      maxNonLinkTextLength: hasExternalLink && text.trim().length <= 260 ? 160 : undefined,
    },
  };
}

function shortRuleName(content: ContentItem): string {
  const seed = content.title || content.body || content.id;
  const clean = seed.replace(/\s+/g, ' ').trim().slice(0, 42);
  return `Trial posts like: ${clean || content.id}`;
}
