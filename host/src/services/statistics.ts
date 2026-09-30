import { rpcCall } from './rpc'

export interface HostRiskSnapshot {
  counts: number[]
}

interface HostScoreResult {
  event_overview?: Record<string, unknown>
}

const RISK_FIELDS = ['safe', 'low', 'medium', 'high', 'critical'] as const

function count(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
}

export async function fetchHostRiskSnapshot(orgId: string): Promise<HostRiskSnapshot> {
  const result = await rpcCall<HostScoreResult>(
    'StatisticsService.GetHostScore',
    {},
    { orgId: orgId || undefined }
  )
  const overview = result.event_overview ?? {}

  return {
    counts: RISK_FIELDS.map((field) => count(overview[field])),
  }
}
