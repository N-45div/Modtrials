import { z } from 'zod';

export const ruleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(3).max(80),
  description: z.string().max(240).optional(),
  source: z.enum(['baseline', 'custom', 'inline']).optional(),
  target: z.enum(['post', 'comment']),
  mode: z.enum(['retrospective', 'shadow', 'repair']),
  action: z.enum(['warn', 'repair', 'hold', 'remove']),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  conditions: z.object({
    minAccountAgeDays: z.number().int().min(0).max(3650).optional(),
    requireFlair: z.string().max(80).optional(),
    excludeFlair: z.string().max(80).optional(),
    keywords: z.array(z.string().min(1).max(80)).max(30).optional(),
    exemptKeywords: z.array(z.string().min(1).max(80)).max(30).optional(),
    regexes: z.array(z.string().min(1).max(180)).max(12).optional(),
    domains: z.array(z.string().min(1).max(120)).max(30).optional(),
    externalLinkRequired: z.boolean().optional(),
    maxTextLength: z.number().int().min(1).max(5000).optional(),
    maxNonLinkTextLength: z.number().int().min(1).max(5000).optional(),
  }),
  repairMessage: z.string().max(800).optional(),
});

export const createRuleSchema = ruleSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const reviewLabelSchema = z.object({
  eventId: z.string().min(1),
  label: z.enum(['true_positive', 'false_positive', 'gray_area', 'rewrite_rule', 'ignore']),
  reviewer: z.string().min(1).max(80).default('local-mod'),
});

export type CreateRuleInput = z.infer<typeof createRuleSchema>;
