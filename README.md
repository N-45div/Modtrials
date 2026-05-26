# ModTrials

Private clinical trials for subreddit rules.

ModTrials is a Reddit Devvit app that helps moderators test new rules before those rules affect users. It runs proposed rules in shadow mode, collects moderator feedback on real posts and comments, and shows whether a rule is safe enough to launch.

The product is built around one idea:

> Test rules before they punish users.

## What It Does

Moderators can start a private rule trial directly from Reddit:

- Use a post or comment menu action: `ModTrials: trial privately`
- Ask why an item matched: `ModTrials: why privately`
- Get an aggregate report: `ModTrials: private report`
- Use bot commands such as `u/modtrials trial this --dm`

ModTrials then:

- Reads the selected Reddit post or comment.
- Creates a shadow rule trial from deterministic moderation recipes.
- Shows the counterfactual outcome: what would have happened if the rule were live.
- Records why the item matched.
- Sends the moderator a private DM result.
- Falls back to the subreddit's private Modmail Inbox if Reddit blocks the DM.
- Lets moderators mark examples as good catches, false positives, or gray-area cases.
- Computes launch readiness from real trial evidence.
- Shows a rule flight recorder and rule comparison view so teams can see which rules are safer to launch.

## Why Mods Need It

Moderation rules often fail in the gray area. A rule that catches obvious spam can also catch a sourced discussion post, a new user's good-faith question, or a legitimate builder showcase.

ModTrials gives teams evidence before enforcement:

- Does this rule catch the bad content?
- Does it also catch good content?
- Should this rule launch as auto-remove, hold-for-review, repair-first, or be rewritten?

## Primary Workflow

1. A moderator finds a real post or comment.
2. The moderator runs `ModTrials: trial privately`.
3. ModTrials sends a private DM explaining the match.
4. The moderator labels the result as useful, false positive, or gray area.
5. The readiness card shows whether the rule is safe to launch.
6. The flight recorder and comparison view show how the rule is trending against other active trials.

Bot command equivalent:

```text
u/modtrials trial this --dm
u/modtrials why --dm
u/modtrials report --dm
```

Command comments are processed, then removed to keep the thread clean.

## Privacy Model

ModTrials is deterministic and privacy-preserving.

- No AI or LLM calls.
- No external API calls.
- No model training.
- No automatic bans or removals.
- No usernames stored in trial events.
- No full post/comment body stored in trial events.
- No raw title or URL stored in trial events.
- Private results are sent only to moderators.
- If Reddit refuses a DM because of account delivery settings, ModTrials sends the result to the subreddit's private Modmail Inbox instead.
- Deleted Reddit items trigger cleanup of related trial evidence.
- Redis keys are scoped by subreddit, so one community cannot read or mutate another community's ModTrials rules or evidence.

Rules can test keyword sets, regex-style text patterns, exemption terms, external links, domains, link-heavy posts with little context, short text, flair, and account-age style checks.

Stored evidence keeps only the minimum needed for moderation review: rule ID, Reddit thing ID, match reasons, labels, timestamps, and launch metrics.

Each private result includes a privacy receipt:

- Stored: Reddit item ID, rule ID, matched reasons, labels, timestamps
- Not stored: username, full body, raw title, raw URL
- Public action: none
- Cleanup: evidence is keyed to the Reddit item ID for deletion cleanup

## Moderator Permission Boundary

ModTrials is intended for subreddit moderators only.

- Every Devvit menu action is declared with `forUserType: "moderator"`.
- Every menu action endpoint verifies the current Reddit user is a moderator before creating trials, sending reports, or labeling evidence.
- Every dashboard API endpoint verifies moderator status before returning rules, events, reports, labels, or readiness data.
- Bot commands verify that the command author is a moderator before processing or sending private results.
- The custom dashboard post may appear as a normal Reddit post, but the webview only loads moderation data after the server-side moderator check passes. Non-moderators see a locked state and receive no rule/event data.

## Demo Scenario

A realistic test is a community that discusses ASI, AI safety, and research links.

Positive example:

- A sourced ASI discussion post with external links and a real question.
- It may match a broad link rule, but a moderator can mark it as a false positive.

Negative example:

- A short promotional comment such as "buy my report", "subscribe", or "discount".
- It should be marked as a good ModTrials catch.

This demonstrates the core value: the same rule can catch spam and risk catching good discussion. ModTrials makes that visible before enforcement.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for runtime diagrams, storage boundaries, and the privacy flow.

## Requirements

- Node.js
- npm
- Reddit developer account
- Devvit CLI authentication
- A subreddit where you are a moderator

## Local Setup

```bash
npm install
npm run login
npm run dev
```

`npm run dev` starts `devvit playtest`.

## Verification

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

## Install To A Subreddit

```bash
npx devvit upload --bump patch
npx devvit install <subreddit-name>
npx devvit list installs <subreddit-name>
```

Current public test install:

```text
r/ASIfacts
modtrials v0.0.18
```

## App Listing

```text
https://developers.reddit.com/apps/modtrials
```
