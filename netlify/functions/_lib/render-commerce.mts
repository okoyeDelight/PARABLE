import { readAuthoritativeProjectState } from './project-artifacts.mts';

export type RenderPlan = 'free' | 'creator' | 'studio' | 'production';
export type FundingSource = 'none' | 'customer' | 'sponsor';

export type ProjectRenderEntitlement = {
  entitlement_version: 'parable-render-entitlement-v1';
  project_id: string;
  plan: RenderPlan;
  status: 'active' | 'past_due' | 'canceled' | 'expired';
  funding_source: FundingSource;
  allow_billable_providers: boolean;
  max_provider_cost_usd_per_request: number | null;
  max_provider_cost_usd_per_period: number | null;
  period_spend_usd: number;
  period_ends_at: string | null;
  updated_at: string;
};

const money = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000000) / 1000000 : null;
};

export function freeRenderEntitlement(projectId: string): ProjectRenderEntitlement {
  return {
    entitlement_version: 'parable-render-entitlement-v1',
    project_id: projectId,
    plan: 'free',
    status: 'active',
    funding_source: 'none',
    allow_billable_providers: false,
    max_provider_cost_usd_per_request: 0,
    max_provider_cost_usd_per_period: 0,
    period_spend_usd: 0,
    period_ends_at: null,
    updated_at: new Date().toISOString()
  };
}

export async function readProjectRenderEntitlement(projectId: string) {
  const state = await readAuthoritativeProjectState<ProjectRenderEntitlement>(
    projectId,
    'billing:render-entitlement'
  );
  const value = state?.value;
  if (!value) return freeRenderEntitlement(projectId);

  return {
    ...freeRenderEntitlement(projectId),
    ...value,
    project_id: projectId,
    period_spend_usd: money(value.period_spend_usd) || 0,
    max_provider_cost_usd_per_request:
      value.max_provider_cost_usd_per_request === null ? null : money(value.max_provider_cost_usd_per_request),
    max_provider_cost_usd_per_period:
      value.max_provider_cost_usd_per_period === null ? null : money(value.max_provider_cost_usd_per_period)
  } satisfies ProjectRenderEntitlement;
}

export async function evaluateProviderSpend(args: {
  projectId: string;
  provider: string;
  estimatedCostUsd: number | null;
}) {
  const provider = String(args.provider || '').trim().toLowerCase();
  const globalEnabled = String(Netlify.env.get('PARABLE_BILLABLE_RENDERERS_ENABLED') || '').toLowerCase() === 'true';
  const providerEnabled = String(
    Netlify.env.get('PARABLE_' + provider.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_BILLABLE_ENABLED') || ''
  ).toLowerCase() === 'true';

  const entitlement = await readProjectRenderEntitlement(args.projectId);
  const estimate = money(args.estimatedCostUsd);

  const deny = (code: string, message: string, status = 402) => ({
    allowed: false,
    code,
    message,
    status,
    entitlement,
    estimated_cost_usd: estimate
  });

  if (!globalEnabled || !providerEnabled) {
    return deny(
      'BILLABLE_RENDERER_DISABLED',
      'Paid renderer submission is disabled at the PARABLE platform/provider gate. No provider request was sent.',
      503
    );
  }
  if (entitlement.status !== 'active') {
    return deny('RENDER_ENTITLEMENT_INACTIVE', 'This project does not have an active render entitlement.');
  }
  if (!entitlement.allow_billable_providers || entitlement.funding_source === 'none') {
    return deny(
      'RENDER_PAYMENT_REQUIRED',
      'This project is on a free/non-funded render entitlement. Upgrade or attach funded render credits before using a billable renderer.'
    );
  }
  if (estimate === null) {
    return deny(
      'RENDER_COST_ESTIMATE_REQUIRED',
      'A server-side cost estimate is required before a billable provider request can be submitted.',
      409
    );
  }
  if (
    entitlement.max_provider_cost_usd_per_request !== null &&
    estimate > entitlement.max_provider_cost_usd_per_request
  ) {
    return deny(
      'RENDER_REQUEST_COST_LIMIT_EXCEEDED',
      'This render exceeds the project per-request provider-spend ceiling.',
      409
    );
  }
  if (
    entitlement.max_provider_cost_usd_per_period !== null &&
    entitlement.period_spend_usd + estimate > entitlement.max_provider_cost_usd_per_period
  ) {
    return deny(
      'RENDER_PERIOD_BUDGET_EXCEEDED',
      'This render would exceed the project provider-spend allowance for the current billing period.',
      409
    );
  }

  return {
    allowed: true,
    code: 'OK',
    message: 'Server-authoritative entitlement and platform spend gates allow this provider request.',
    status: 200,
    entitlement,
    estimated_cost_usd: estimate
  };
}
