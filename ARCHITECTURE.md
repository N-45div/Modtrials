# ModTrials Architecture

ModTrials is a Devvit Web app with a React dashboard, a Hono server, Devvit Reddit APIs, and Devvit Redis. The primary product surface is native Reddit moderation actions and bot commands; the dashboard is a secondary audit view.

## System Overview

```mermaid
flowchart LR
  Mod[Moderator] --> Reddit[Reddit UI]

  Reddit --> Menu[Post / Comment / Subreddit Menu Actions]
  Reddit --> Command[Bot Command Comment]
  Reddit --> Events[Devvit Triggers]
  Reddit --> Dashboard[Custom Post Dashboard]

  Menu --> Server[Hono Server]
  Command --> Server
  Events --> Server
  Dashboard --> Client[React Client]
  Client --> Server

  Server --> RedditAPI[Devvit Reddit API]
  Server --> Redis[Devvit Redis]

  RedditAPI --> Reddit
  Redis --> Server
```

## Runtime Components

```mermaid
flowchart TB
  subgraph ClientSide[Client]
    React[React Dashboard]
  end

  subgraph ServerSide[Server]
    Routes[Hono Routes]
    BotParser[Bot Command Parser]
    RuleBuilder[Baseline and Inline Rule Builders]
    Evaluator[Rule Evaluator]
    Scoring[Launch Scoring]
    Storage[Storage Adapter]
  end

  subgraph DevvitPlatform[Devvit Platform]
    Menus[Menu Actions]
    Triggers[Post / Comment / Delete Triggers]
    RedditAPI[Reddit API]
    Redis[Redis]
  end

  Menus --> Routes
  Triggers --> Routes
  React --> Routes
  Routes --> BotParser
  Routes --> RuleBuilder
  Routes --> Evaluator
  Routes --> Scoring
  Routes --> Storage
  Storage --> Redis
  Routes --> RedditAPI
```

Key files:

- [src/server/index.ts](/home/divij/vincent/modtrials/src/server/index.ts): HTTP routes, menu actions, trigger handlers, bot command workflow.
- [src/server/bot-commands.ts](/home/divij/vincent/modtrials/src/server/bot-commands.ts): command parsing and private DM message builders.
- [src/server/trials.ts](/home/divij/vincent/modtrials/src/server/trials.ts): rule evaluation to trial event recording.
- [src/server/storage.ts](/home/divij/vincent/modtrials/src/server/storage.ts): Devvit Redis persistence and privacy minimization.
- [src/shared/evaluator.ts](/home/divij/vincent/modtrials/src/shared/evaluator.ts): deterministic rule matching.
- [src/shared/scoring.ts](/home/divij/vincent/modtrials/src/shared/scoring.ts): launch readiness metrics.
- [src/client/main.tsx](/home/divij/vincent/modtrials/src/client/main.tsx): dashboard UI.

## Private Trial Flow

```mermaid
sequenceDiagram
  participant M as Moderator
  participant R as Reddit UI
  participant S as ModTrials Server
  participant API as Devvit Reddit API
  participant DB as Devvit Redis

  M->>R: Click "ModTrials: trial privately"
  R->>S: POST menu action with target thing ID
  S->>API: Fetch post/comment by ID
  API-->>S: Real Reddit item
  S->>S: Build inline shadow rule
  S->>S: Evaluate deterministic conditions
  S->>DB: Store rule and minimized trial event
  S->>API: Send private message to moderator
  S-->>R: Show success toast
```

## Bot Command Flow

```mermaid
sequenceDiagram
  participant M as Moderator
  participant R as Reddit Thread
  participant T as Devvit Trigger
  participant S as ModTrials Server
  participant API as Devvit Reddit API
  participant DB as Devvit Redis

  M->>R: Comment "u/modtrials trial this --dm"
  R->>T: Comment submit/create event
  T->>S: POST trigger payload
  S->>S: Normalize Reddit mention markdown
  S->>DB: De-dupe command ID
  S->>API: Verify commenter is moderator
  S->>API: Fetch parent post/comment
  S->>DB: Store rule and minimized event
  S->>API: Send private DM result
  S->>API: Remove command comment
  S-->>T: Return handled
```

The app listens to both `onCommentSubmit` and `onCommentCreate` because Reddit can emit both paths. Command IDs are stored in Redis so the same command does not send duplicate DMs.

## Evidence Model

```mermaid
erDiagram
  TRIAL_RULE ||--o{ TRIAL_EVENT : records
  TRIAL_EVENT ||--o{ REVIEW_LABEL : receives

  TRIAL_RULE {
    string id
    string name
    string source
    string target
    string mode
    string action
    boolean enabled
    object conditions
  }

  TRIAL_EVENT {
    string id
    string ruleId
    string mode
    string action
    string contentId
    string target
    string createdAt
    array reasons
  }

  REVIEW_LABEL {
    string reviewer
    string label
  }
```

Trial events intentionally store minimized content metadata. The full post/comment is fetched from Reddit only when needed for live evaluation.

## Privacy Boundary

```mermaid
flowchart LR
  FullItem[Full Reddit item in trigger/API response] --> Evaluate[Evaluate rule in memory]
  Evaluate --> Minimize[Minimize before persistence]
  Minimize --> Stored[Stored trial event]

  FullItem -. not stored .-> Drop[Discard title, body, author, raw URL]

  Stored --> Reasons[Match reasons]
  Stored --> Labels[Moderator labels]
  Stored --> Metrics[Readiness metrics]

  Reasons --> DM[Private moderator DM]
  Metrics --> Dashboard[Dashboard readiness]
```

Stored trial events do not keep usernames, full bodies, titles, or raw URLs. This keeps ModTrials focused on rule safety rather than user profiling.

## Permission Boundary

```mermaid
flowchart TD
  Viewer[Current Reddit user] --> DashboardPost[Custom post dashboard shell]
  DashboardPost --> API[Dashboard API request]
  API --> Check{Moderator of subreddit?}
  Check -->|yes| Data[Return rules, events, labels, readiness]
  Check -->|no| Locked[Return 403 and locked client state]

  Menu[Menu action request] --> MenuCheck{Moderator of subreddit?}
  MenuCheck -->|yes| Action[Create trial, send DM, label event]
  MenuCheck -->|no| Toast[Show moderator-only toast]

  Command[Bot command comment] --> AuthorCheck{Author is moderator?}
  AuthorCheck -->|yes| PrivateDM[Process command and DM result]
  AuthorCheck -->|no| Ignore[Ignore command]
```

Menu items are also declared with `forUserType: "moderator"` in [devvit.json](/home/divij/vincent/modtrials/devvit.json). Server checks are still enforced for every menu action and dashboard API endpoint so the app fails closed even if a request is submitted directly.

## Trigger Coverage

```mermaid
flowchart TD
  PostSubmit[Post Submit] --> ShadowPost[Evaluate active post shadow rules]
  CommentSubmit[Comment Submit/Create] --> CommandCheck{Bot command?}
  CommandCheck -->|yes| CommandFlow[Private bot workflow]
  CommandCheck -->|no| ShadowComment[Evaluate active comment shadow rules]

  PostDelete[Post Delete] --> CleanupPost[Delete events for post ID]
  CommentDelete[Comment Delete] --> CleanupComment[Delete events for comment ID]

  ShadowPost --> Redis[Devvit Redis]
  ShadowComment --> Redis
  CommandFlow --> Redis
  CleanupPost --> Redis
  CleanupComment --> Redis
```

## Launch Readiness

```mermaid
flowchart LR
  Events[Trial events] --> Labels[Moderator labels]
  Labels --> Metrics[False positive / gray area / confidence metrics]
  Metrics --> Card[Launch card]
  Metrics --> Compare[Rule comparison]
  Events --> Flight[Rule flight recorder]

  Card --> Safe[Safe to launch]
  Card --> Warning[Launch as warning]
  Card --> Repair[Launch repair-first]
  Card --> Hold[Hold for review]
  Card --> Rewrite[Rewrite rule]
```

Readiness is advisory. ModTrials does not enforce rules automatically.

The flight recorder is derived from rule creation timestamps, first/latest matching events, labels, and the current launch card. It is a safety timeline, not a separate user profile. Rule comparison uses the same minimized trial events to compare active rules by readiness, false-positive risk, gray-area risk, confidence, and evidence volume.

## Deployment Flow

```mermaid
flowchart LR
  Local[Local source] --> Build[npm run build]
  Build --> Upload[npx devvit upload]
  Upload --> Install[npx devvit install subreddit]
  Upload --> Publish[npx devvit publish --public]
  Install --> TestSubreddit[Public test subreddit]
  Publish --> Review[Reddit app review]
```

For hackathon testing, the app is installed in `r/ASIfacts`. For broader public use, `devvit publish --public` submits the app and source zip to Reddit's public review flow.
