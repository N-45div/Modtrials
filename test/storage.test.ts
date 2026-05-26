import { describe, expect, it } from 'vitest';
import { storageKeysForSubreddit } from '../src/server/storage';

describe('storage key scoping', () => {
  it('namespaces every Redis key by subreddit', () => {
    expect(storageKeysForSubreddit('ASIfacts')).toEqual({
      rules: 'modtrials:asifacts:rules',
      ruleIds: 'modtrials:asifacts:rule_ids',
      eventIds: 'modtrials:asifacts:event_ids',
      events: 'modtrials:asifacts:events',
      commandIds: 'modtrials:asifacts:command_ids',
    });

    expect(storageKeysForSubreddit('OtherSub').events).toBe('modtrials:othersub:events');
  });

  it('normalizes r slash prefixes and rejects missing context', () => {
    expect(storageKeysForSubreddit('r/ASIfacts').rules).toBe('modtrials:asifacts:rules');
    expect(() => storageKeysForSubreddit(undefined)).toThrow('subreddit context');
  });
});
