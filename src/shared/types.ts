export type RuleTarget = 'post' | 'comment';
export type TrialMode = 'retrospective' | 'shadow' | 'repair';
export type SimulatedAction = 'warn' | 'repair' | 'hold' | 'remove';
export type ReviewLabel = 'true_positive' | 'false_positive' | 'gray_area' | 'rewrite_rule' | 'ignore';

export type TrialRule = {
  id: string;
  name: string;
  description?: string;
  source?: 'baseline' | 'custom' | 'inline';
  target: RuleTarget;
  mode: TrialMode;
  action: SimulatedAction;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  conditions: {
    minAccountAgeDays?: number;
    requireFlair?: string;
    excludeFlair?: string;
    keywords?: string[];
    domains?: string[];
    externalLinkRequired?: boolean;
    maxTextLength?: number;
  };
  repairMessage?: string;
};

export type ContentItem = {
  id: string;
  target: RuleTarget;
  title?: string;
  body: string;
  authorName?: string;
  authorCreatedAt?: string;
  flair?: string;
  url?: string;
  createdAt: string;
  permalink?: string;
};

export type MatchReason = {
  code: string;
  label: string;
  detail?: string;
};

export type EvaluationResult = {
  matched: boolean;
  reasons: MatchReason[];
};

export type TrialEvent = {
  id: string;
  ruleId: string;
  mode: TrialMode;
  action: SimulatedAction;
  content: ContentItem;
  reasons: MatchReason[];
  createdAt: string;
  labels: Record<string, ReviewLabel>;
  repairState?: 'requested' | 'fixed' | 'abandoned';
};

export type TrialMetrics = {
  totalEvents: number;
  labeledEvents: number;
  truePositiveRate: number;
  falsePositiveRate: number;
  grayAreaRate: number;
  rewriteRate: number;
  queueLoadEstimate: number;
  modAgreementRate: number | null;
  repairSuccessRate: number | null;
};

export type LaunchRecommendation =
  | 'safe_to_launch'
  | 'launch_as_warning'
  | 'launch_repair_first'
  | 'launch_hold_for_review'
  | 'do_not_auto_remove'
  | 'rewrite_rule';

export type LaunchCard = {
  readinessScore: number;
  recommendation: LaunchRecommendation;
  falsePositiveRisk: 'low' | 'medium' | 'high';
  grayAreaRisk: 'low' | 'medium' | 'high';
  queueLoadIncrease: number;
  confidence: 'low' | 'medium' | 'high';
  reasons: string[];
};
