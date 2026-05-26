import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrialEvent } from '../src/shared/types';
import { recordMatches } from '../src/server/trials';

const storedEvents = new Map<string, TrialEvent>();

vi.mock('../src/server/storage', () => ({
  getEvent: vi.fn((eventId: string) => Promise.resolve(storedEvents.get(eventId) ?? null)),
  saveEvent: vi.fn((event: TrialEvent) => {
    storedEvents.set(event.id, event);
    return Promise.resolve();
  }),
}));

describe('recordMatches', () => {
  beforeEach(() => {
    storedEvents.clear();
  });

  it('uses stable event ids so repeated real scans do not create duplicate evidence', async () => {
    const rule = {
      id: 'rule-1',
      name: 'External links',
      target: 'post',
      mode: 'shadow',
      action: 'hold',
      enabled: true,
      createdAt: '2026-05-22T00:00:00.000Z',
      updatedAt: '2026-05-22T00:00:00.000Z',
      conditions: {
        externalLinkRequired: true,
      },
    } as const;
    const item = {
      id: 't3_realpost',
      target: 'post',
      title: 'Check this',
      body: 'https://example.com',
      createdAt: '2026-05-22T00:00:00.000Z',
    } as const;

    const firstRun = await recordMatches(rule, [item], 'retrospective');
    const secondRun = await recordMatches(rule, [item], 'retrospective');

    expect(firstRun).toHaveLength(1);
    expect(secondRun).toHaveLength(1);
    expect(firstRun[0].id).toBe('rule-1:retrospective:t3_realpost');
    expect(firstRun[0].content.body).toBe('');
    expect(firstRun[0].content.authorName).toBeUndefined();
    expect(storedEvents.size).toBe(1);
  });
});
