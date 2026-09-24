export type MarketplaceActionPriority = 'critical' | 'high' | 'medium' | 'low';

export interface MarketplaceAction {
  key: string;
  priority: MarketplaceActionPriority;
  score: number;
  title: string;
  reason: string;
  target: string;
  entityId?: string | null;
  entityTitle?: string | null;
  metric?: { label: string; value: number | string } | null;
}

export interface MarketplaceActionQueue {
  role: 'organizer' | 'sponsor';
  accountId: string;
  workspaceRole: 'owner' | 'admin' | 'member' | 'viewer';
  actions: MarketplaceAction[];
  generatedAt: string;
}

async function parseResponse(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Marketplace intelligence request failed (HTTP ${res.status})`);
  return data;
}

export async function fetchMarketplaceActions(
  role: 'organizer' | 'sponsor'
): Promise<MarketplaceActionQueue> {
  const res = await fetch(`/api/marketplace-intelligence/actions?role=${encodeURIComponent(role)}`, {
    credentials: 'include',
  });
  return parseResponse(res);
}
