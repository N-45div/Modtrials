import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, Bot, FlaskConical, Gauge, GitCompare, History, Play, Radar, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { buildLaunchCard, computeMetrics } from '../shared/scoring';
import type { LaunchCard, ReviewLabel, TrialEvent, TrialMetrics, TrialRule } from '../shared/types';
import './styles.css';

type LaunchPayload = {
  rule: TrialRule;
  metrics: TrialMetrics;
  launchCard: LaunchCard;
};

type Overview = {
  rules: {
    total: number;
    baseline: number;
    inline: number;
    active: number;
    withEvidence: number;
  };
  events: {
    total: number;
    unlabeled: number;
    truePositive: number;
    falsePositive: number;
    grayArea: number;
  };
};

const emptyRule = {
  name: '',
  target: 'post',
  mode: 'shadow',
  action: 'hold',
  enabled: true,
  conditions: {
    minAccountAgeDays: 14,
    requireFlair: '',
    keywords: '',
    domains: '',
    externalLinkRequired: true,
  },
  repairMessage: 'Your post may need more context before moderators can approve it.',
};

function App() {
  const [rules, setRules] = useState<TrialRule[]>([]);
  const [events, setEvents] = useState<TrialEvent[]>([]);
  const [allEvents, setAllEvents] = useState<TrialEvent[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState<string>('');
  const [launch, setLaunch] = useState<LaunchPayload | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [form, setForm] = useState(emptyRule);
  const [status, setStatus] = useState('');
  const selectedRule = useMemo(() => rules.find((rule) => rule.id === selectedRuleId), [rules, selectedRuleId]);
  const comparisons = useMemo(() => buildComparisons(rules, allEvents), [rules, allEvents]);
  const timeline = useMemo(() => selectedRule ? buildTimeline(selectedRule, allEvents, launch) : [], [selectedRule, allEvents, launch]);

  async function refresh(ruleId = selectedRuleId) {
    const [rulesRes, eventsRes, allEventsRes] = await Promise.all([
      fetch('/api/rules'),
      fetch(`/api/events${ruleId ? `?ruleId=${ruleId}` : ''}`),
      fetch('/api/events'),
    ]);
    if (rulesRes.status === 403 || eventsRes.status === 403 || allEventsRes.status === 403) {
      setUnauthorized(true);
      setStatus('Moderator access required.');
      return;
    }
    if (!rulesRes.ok) throw new Error(await rulesRes.text());
    if (!eventsRes.ok) throw new Error(await eventsRes.text());
    if (!allEventsRes.ok) throw new Error(await allEventsRes.text());
    const rulesJson = await rulesRes.json();
    const eventsJson = await eventsRes.json();
    const allEventsJson = await allEventsRes.json();
    setRules(rulesJson.rules);
    setEvents(eventsJson.events);
    setAllEvents(allEventsJson.events);
    await loadOverview();
    if (!selectedRuleId && rulesJson.rules[0]) setSelectedRuleId(rulesJson.rules[0].id);
    if (ruleId) await loadLaunch(ruleId);
  }

  async function loadOverview() {
    const res = await fetch('/api/overview');
    if (res.status === 403) {
      setUnauthorized(true);
      return;
    }
    if (res.ok) setOverview(await res.json());
  }

  async function loadLaunch(ruleId: string) {
    const res = await fetch(`/api/launch-card/${ruleId}`);
    if (res.status === 403) {
      setUnauthorized(true);
      return;
    }
    if (res.ok) setLaunch(await res.json());
  }

  useEffect(() => {
    refresh().catch((error) => setStatus(error.message));
  }, []);

  useEffect(() => {
    if (selectedRuleId) {
      refresh(selectedRuleId).catch((error) => setStatus(error.message));
    }
  }, [selectedRuleId]);

  async function createRule(event: React.FormEvent) {
    event.preventDefault();
    setStatus('Saving rule...');
    const body = {
      name: form.name,
      target: form.target,
      mode: form.mode,
      action: form.action,
      enabled: form.enabled,
      conditions: {
        minAccountAgeDays: Number(form.conditions.minAccountAgeDays || 0),
        requireFlair: clean(form.conditions.requireFlair),
        keywords: splitList(form.conditions.keywords),
        domains: splitList(form.conditions.domains),
        externalLinkRequired: form.conditions.externalLinkRequired,
      },
      repairMessage: clean(form.repairMessage),
    };

    const res = await fetch('/api/rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
    const json = await res.json();
    setSelectedRuleId(json.rule.id);
    setForm(emptyRule);
    setStatus('Rule saved.');
    await refresh(json.rule.id);
  }

  async function runRetrospective() {
    if (!selectedRule) return;
    setStatus('Running retrospective against recent subreddit content...');
    const res = await fetch('/api/trials/retrospective', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ruleId: selectedRule.id, limit: 50 }),
    });
    if (!res.ok) throw new Error(await res.text());
    const json = await res.json();
    setStatus(`Scanned ${json.scanned} recent ${selectedRule.target}s. Matched ${json.matched}.`);
    await refresh(selectedRule.id);
  }

  async function startBaseline() {
    setStatus('Starting safe baseline shadow trials...');
    const res = await fetch('/api/baseline/start', { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    const json = await res.json();
    setStatus(json.created ? `Started ${json.created} baseline shadow trials.` : 'Baseline shadow trials were already active.');
    await refresh(selectedRuleId);
  }

  async function analyzeRecent() {
    setStatus('Analyzing recent subreddit posts with active shadow trials...');
    const res = await fetch('/api/trials/analyze-recent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ limit: 50 }),
    });
    if (!res.ok) throw new Error(await res.text());
    const json = await res.json();
    setStatus(`Scanned ${json.scanned} real posts across ${json.rulesChecked} active rules. Logged ${json.matched} trial events.`);
    await refresh(selectedRuleId);
  }

  async function label(eventId: string, value: ReviewLabel) {
    const res = await fetch('/api/events/label', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventId, label: value, reviewer: 'mod' }),
    });
    if (!res.ok) throw new Error(await res.text());
    await refresh(selectedRuleId);
  }

  async function removeRule(ruleId: string) {
    await fetch(`/api/rules/${ruleId}`, { method: 'DELETE' });
    setSelectedRuleId('');
    setLaunch(null);
    await refresh('');
  }

  if (unauthorized) {
    return (
      <main className="shell">
        <section className="workspace locked">
          <section className="panel">
            <h1>ModTrials</h1>
            <h2>Moderator access required</h2>
            <p className="lead">This dashboard contains moderation rule trials and is only available to moderators of this subreddit.</p>
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Rule Safety Lab</p>
          <h1>ModTrials</h1>
        </div>
        <nav className="rule-list" aria-label="Rules">
          {rules.map((rule) => (
            <button key={rule.id} className={rule.id === selectedRuleId ? 'active' : ''} onClick={() => setSelectedRuleId(rule.id)}>
              <span>{rule.name}</span>
              <small>{rule.mode} · {rule.action}</small>
            </button>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <section className="topline">
          <div>
            <p className="eyebrow">Autopilot for safer rules</p>
            <h2>{selectedRule?.name ?? 'ModTrials is watching in shadow mode'}</h2>
          </div>
          <div className="actions">
            <button className="primary" onClick={analyzeRecent}>
              <Radar size={16} /> Analyze Recent Posts
            </button>
            <button className="secondary" disabled={!selectedRule} onClick={runRetrospective}>
              <Play size={16} /> Run Selected Rule
            </button>
          </div>
        </section>

        {status && <p className="status">{status}</p>}

        <section className="autopilot">
          <section className="panel autopilot-main">
            <h3><Bot size={18} /> Shadow Autopilot</h3>
            <p className="lead">ModTrials starts with safe observation: no removals, no warnings, no user-facing actions.</p>
            <div className="stat-grid">
              <Stat label="Active trials" value={overview?.rules.active ?? 0} />
              <Stat label="Baseline trials" value={overview?.rules.baseline ?? 0} />
              <Stat label="Trial events" value={overview?.events.total ?? 0} />
              <Stat label="Needs review" value={overview?.events.unlabeled ?? 0} />
            </div>
            <div className="actions">
              <button className="primary" onClick={startBaseline}>
                <Sparkles size={16} /> Start Safe Baseline Trials
              </button>
              <button className="secondary" onClick={analyzeRecent}>
                <Radar size={16} /> Scan Real Recent Posts
              </button>
            </div>
          </section>

          <section className="panel signal-panel">
            <h3><Activity size={18} /> What Needs Attention</h3>
            <Signal overview={overview} />
          </section>
        </section>

        <section className="grid">
          <section className="panel launch">
            <h3><Gauge size={18} /> Launch Card</h3>
            {launch ? (
              <>
                <div className="score">{launch.launchCard.readinessScore}<span>/100</span></div>
                <p className="recommendation">{humanize(launch.launchCard.recommendation)}</p>
                <div className="metrics">
                  <span>False positive: {launch.launchCard.falsePositiveRisk}</span>
                  <span>Gray area: {launch.launchCard.grayAreaRisk}</span>
                  <span>Confidence: {launch.launchCard.confidence}</span>
                  <span>Events: {launch.metrics.totalEvents}</span>
                </div>
                {launch.launchCard.reasons.map((reason) => <p className="reason" key={reason}>{reason}</p>)}
              </>
            ) : <p className="empty">Select a rule and collect real trial events to generate readiness.</p>}
          </section>

          <section className="panel flight">
            <h3><History size={18} /> Rule Flight Recorder</h3>
            {timeline.length > 0 ? (
              <div className="timeline">
                {timeline.map((item) => (
                  <div className="timeline-item" key={item.label}>
                    <span>{item.value}</span>
                    <strong>{item.label}</strong>
                    <p>{item.detail}</p>
                  </div>
                ))}
              </div>
            ) : <p className="empty">Select a rule to see its safety lifecycle.</p>}
          </section>
        </section>

        <section className="panel">
          <h3><GitCompare size={18} /> Rule Comparison</h3>
          <p className="lead">Compare active rules by readiness, false-positive risk, gray-area risk, and evidence volume before deciding what should launch.</p>
          <div className="comparison-grid">
            {comparisons.map((comparison) => (
              <article className={comparison.rule.id === selectedRuleId ? 'comparison active' : 'comparison'} key={comparison.rule.id}>
                <div>
                  <strong>{comparison.rule.name}</strong>
                  <small>{comparison.rule.mode} · {comparison.rule.action} · {comparison.metrics.totalEvents} events</small>
                </div>
                <div className="comparison-score">{comparison.card.readinessScore}<span>/100</span></div>
                <p>{humanize(comparison.card.recommendation)}</p>
                <small>FP {comparison.card.falsePositiveRisk} · gray {comparison.card.grayAreaRisk} · confidence {comparison.card.confidence}</small>
              </article>
            ))}
            {comparisons.length === 0 && <p className="empty">Start baseline trials or create a rule to compare safety profiles.</p>}
          </div>
        </section>

        <section className="panel builder compact-builder">
          <button className="ghost-toggle" type="button" onClick={() => setShowAdvanced(!showAdvanced)}>
            <FlaskConical size={18} /> {showAdvanced ? 'Hide Advanced Builder' : 'Advanced Custom Rule'}
          </button>
          {showAdvanced && (
            <form className="builder-fields" onSubmit={createRule}>
              <label>Rule name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required minLength={3} /></label>
              <div className="row">
                <label>Target<select value={form.target} onChange={(event) => setForm({ ...form, target: event.target.value as typeof form.target })}><option value="post">Posts</option><option value="comment">Comments</option></select></label>
                <label>Mode<select value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value as typeof form.mode })}><option value="shadow">Shadow</option><option value="retrospective">Retrospective</option><option value="repair">Repair</option></select></label>
                <label>Action<select value={form.action} onChange={(event) => setForm({ ...form, action: event.target.value as typeof form.action })}><option value="warn">Warn</option><option value="repair">Repair</option><option value="hold">Hold</option><option value="remove">Remove</option></select></label>
              </div>
              <div className="row">
                <label>Max account age<input type="number" min="0" value={form.conditions.minAccountAgeDays} onChange={(event) => setForm({ ...form, conditions: { ...form.conditions, minAccountAgeDays: Number(event.target.value) } })} /></label>
                <label>Required flair<input value={form.conditions.requireFlair} onChange={(event) => setForm({ ...form, conditions: { ...form.conditions, requireFlair: event.target.value } })} /></label>
              </div>
              <label>Keywords<input value={form.conditions.keywords} onChange={(event) => setForm({ ...form, conditions: { ...form.conditions, keywords: event.target.value } })} placeholder="promo, affiliate, giveaway" /></label>
              <label>Domains<input value={form.conditions.domains} onChange={(event) => setForm({ ...form, conditions: { ...form.conditions, domains: event.target.value } })} placeholder="bit.ly, gumroad.com" /></label>
              <label className="check"><input type="checkbox" checked={form.conditions.externalLinkRequired} onChange={(event) => setForm({ ...form, conditions: { ...form.conditions, externalLinkRequired: event.target.checked } })} /> Require external link</label>
              <button className="primary" type="submit"><ShieldCheck size={16} /> Save Custom Rule</button>
            </form>
          )}
        </section>

        <section className="panel">
          <h3><Activity size={18} /> Trial Events</h3>
          <div className="event-list">
            {events.map((event) => (
              <article className="event" key={event.id}>
                <div>
                  <strong>{event.content.title || event.content.body.slice(0, 90) || event.content.id}</strong>
                  <p>{event.reasons.map((reason) => reason.label).join(', ')}</p>
                  <small>{event.mode} · {event.action} · {event.content.authorName ?? 'unknown author'}</small>
                </div>
                <div className="labels">
                  {(['true_positive', 'false_positive', 'gray_area', 'rewrite_rule'] as ReviewLabel[]).map((value) => (
                    <button key={value} onClick={() => label(event.id, value)}>{humanize(value)}</button>
                  ))}
                </div>
              </article>
            ))}
            {events.length === 0 && <p className="empty">No trial events yet. Start baseline trials, scan recent posts, or use the post menu action on a real Reddit post.</p>}
          </div>
        </section>

        {selectedRule && (
          <button className="danger" onClick={() => removeRule(selectedRule.id)}><Trash2 size={16} /> Delete selected rule</button>
        )}
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Signal({ overview }: { overview: Overview | null }) {
  if (!overview) return <p className="empty">Loading signals from Redis.</p>;
  if (overview.rules.active === 0) return <p className="empty">Start baseline trials to begin safe shadow observation.</p>;
  if (overview.events.total === 0) return <p className="empty">Trials are active. Scan recent posts or wait for new real submissions.</p>;
  if (overview.events.unlabeled > 0) return <p className="empty">{overview.events.unlabeled} real trial events need quick moderator labels.</p>;
  if (overview.events.falsePositive > 0) return <p className="empty">False positives are present. Review Launch Cards before enforcing anything.</p>;
  return <p className="empty">Trial evidence is clean so far. Keep collecting real matches before launch.</p>;
}

function buildComparisons(rules: TrialRule[], events: TrialEvent[]) {
  return rules
    .filter((rule) => rule.enabled)
    .map((rule) => {
      const ruleEvents = events.filter((event) => event.ruleId === rule.id);
      const metrics = computeMetrics(ruleEvents);
      return { rule, metrics, card: buildLaunchCard(rule, metrics) };
    })
    .sort((left, right) => {
      const eventDelta = right.metrics.totalEvents - left.metrics.totalEvents;
      if (eventDelta !== 0) return eventDelta;
      return right.card.readinessScore - left.card.readinessScore;
    })
    .slice(0, 6);
}

function buildTimeline(rule: TrialRule, events: TrialEvent[], launch: LaunchPayload | null) {
  const ruleEvents = events
    .filter((event) => event.ruleId === rule.id)
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  const labels = ruleEvents.flatMap((event) => Object.values(event.labels));
  const firstMatch = ruleEvents[0];
  const latestMatch = ruleEvents[ruleEvents.length - 1];
  const falsePositiveCount = labels.filter((label) => label === 'false_positive').length;
  const grayAreaCount = labels.filter((label) => label === 'gray_area').length;

  return [
    {
      label: 'Created',
      value: shortDate(rule.createdAt),
      detail: `${rule.source ?? 'custom'} ${rule.mode} trial for ${rule.target}s.`,
    },
    {
      label: 'First real match',
      value: firstMatch ? shortDate(firstMatch.createdAt) : 'pending',
      detail: firstMatch ? firstMatch.reasons.map((reason) => reason.label).join(', ') : 'No real subreddit item has matched this rule yet.',
    },
    {
      label: 'Evidence reviewed',
      value: `${labels.length}/${ruleEvents.length}`,
      detail: `${falsePositiveCount} false positives and ${grayAreaCount} gray-area labels recorded.`,
    },
    {
      label: 'Latest signal',
      value: latestMatch ? shortDate(latestMatch.createdAt) : 'none',
      detail: launch ? `${launch.launchCard.readinessScore}/100, ${humanize(launch.launchCard.recommendation)}.` : 'Collect evidence to calculate readiness.',
    },
  ];
}

function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function splitList(value: string | string[] | undefined): string[] | undefined {
  if (Array.isArray(value)) return value;
  const parts = (value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
}

function clean(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next || undefined;
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ');
}

createRoot(document.getElementById('root')!).render(<App />);
