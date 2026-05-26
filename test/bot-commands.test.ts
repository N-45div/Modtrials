import { describe, expect, it } from 'vitest';
import { parseBotCommand } from '../src/server/bot-commands';

describe('parseBotCommand', () => {
  it('recognizes private trial commands', () => {
    expect(parseBotCommand('u/modtrials trial this --dm')).toEqual({ action: 'trial', dm: true });
    expect(parseBotCommand('/u/modtrials trial this privately')).toEqual({ action: 'trial', dm: true });
    expect(parseBotCommand('[u/modtrials](https://www.reddit.com/user/modtrials/)\u00a0trial this --dm')).toEqual({ action: 'trial', dm: true });
  });

  it('recognizes private why and report commands', () => {
    expect(parseBotCommand('u/modtrials why')).toEqual({ action: 'why', dm: false });
    expect(parseBotCommand('@modtrials report private')).toEqual({ action: 'report', dm: true });
  });

  it('ignores casual mentions without a command', () => {
    expect(parseBotCommand('has anyone tried u/modtrials?')).toBeNull();
  });
});
