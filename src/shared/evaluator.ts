import type { ContentItem, EvaluationResult, MatchReason, TrialRule } from './types';

const URL_PATTERN = /\bhttps?:\/\/[^\s<>)"]+/gi;

export function evaluateRule(rule: TrialRule, item: ContentItem): EvaluationResult {
  const reasons: MatchReason[] = [];

  if (!rule.enabled) return { matched: false, reasons };
  if (rule.target !== item.target) return { matched: false, reasons };

  const conditions = rule.conditions;
  const searchable = `${item.title ?? ''}\n${item.body}`.toLowerCase();
  const visibleText = `${item.title ?? ''}\n${item.body}`.trim();

  if (conditions.minAccountAgeDays !== undefined) {
    const age = accountAgeDays(item.authorCreatedAt, item.createdAt);
    if (age === null || age >= conditions.minAccountAgeDays) return { matched: false, reasons: [] };
    reasons.push({
      code: 'account_age',
      label: 'Account age below threshold',
      detail: age === null ? 'Unknown account age' : `${age}d < ${conditions.minAccountAgeDays}d`,
    });
  }

  if (conditions.requireFlair) {
    if (normalize(item.flair) === normalize(conditions.requireFlair)) return { matched: false, reasons: [] };
    reasons.push({
      code: 'missing_required_flair',
      label: 'Required flair missing',
      detail: conditions.requireFlair,
    });
  }

  if (conditions.excludeFlair) {
    if (normalize(item.flair) === normalize(conditions.excludeFlair)) return { matched: false, reasons: [] };
    reasons.push({
      code: 'excluded_flair_absent',
      label: 'Excluded flair was not present',
      detail: conditions.excludeFlair,
    });
  }

  if (conditions.keywords?.length) {
    const matched = conditions.keywords.filter((keyword) => searchable.includes(keyword.toLowerCase()));
    if (matched.length === 0) return { matched: false, reasons: [] };
    reasons.push({
      code: 'keyword',
      label: 'Matched keyword',
      detail: matched.join(', '),
    });
  }

  if (conditions.maxTextLength !== undefined) {
    if (visibleText.length > conditions.maxTextLength) return { matched: false, reasons: [] };
    reasons.push({
      code: 'short_text',
      label: 'Text is under trial length',
      detail: `${visibleText.length} <= ${conditions.maxTextLength} chars`,
    });
  }

  const urls = extractUrls(`${item.url ?? ''}\n${item.body}`);

  if (conditions.externalLinkRequired) {
    if (urls.length === 0) return { matched: false, reasons: [] };
    reasons.push({
      code: 'external_link',
      label: 'Contains external link',
      detail: urls.slice(0, 3).join(', '),
    });
  }

  if (conditions.domains?.length) {
    const matchedDomains = urls
      .map(domainFromUrl)
      .filter((domain): domain is string => Boolean(domain))
      .filter((domain) => conditions.domains?.some((expected) => domainMatches(domain, expected)));

    if (matchedDomains.length === 0) return { matched: false, reasons: [] };
    reasons.push({
      code: 'domain',
      label: 'Matched link domain',
      detail: Array.from(new Set(matchedDomains)).join(', '),
    });
  }

  return { matched: reasons.length > 0, reasons };
}

export function extractUrls(input: string): string[] {
  return Array.from(input.matchAll(URL_PATTERN), (match) => match[0]);
}

export function domainFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

export function accountAgeDays(authorCreatedAt: string | undefined, contentCreatedAt: string): number | null {
  if (!authorCreatedAt) return null;
  const authorTime = Date.parse(authorCreatedAt);
  const contentTime = Date.parse(contentCreatedAt);
  if (!Number.isFinite(authorTime) || !Number.isFinite(contentTime)) return null;
  return Math.max(0, Math.floor((contentTime - authorTime) / 86_400_000));
}

function domainMatches(domain: string, expected: string): boolean {
  const cleanExpected = expected.replace(/^https?:\/\//, '').replace(/^www\./, '').toLowerCase();
  return domain === cleanExpected || domain.endsWith(`.${cleanExpected}`);
}

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}
