import { rpcCall } from './rpc'

export interface EventTrendRow {
  label: string
  value: number
}

export interface RealtimeEvent {
  id: string
  ip: string
  level: 0 | 1 | 2 | 3 | 4
  eventType: string
  description: string
  state: number
  occurredAt: string
}

interface EventTrendResult {
  data?: Array<{ datetime?: number | string; count?: number | string }>
}

interface RealtimeEventResult {
  data?: Array<{
    id?: number | string
    type?: string
    display_name?: string
    level?: number | string
    state?: number | string
    created_at?: number | string
    updated_at?: number | string
    host_view?: {
      host_ip?: string
      exposed_ip?: string
    }
  }>
}

function number(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function text(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function trendLabel(value: number | string | undefined): string {
  const timestamp = number(value)
  if (!timestamp) return '-'
  return new Date(timestamp * 1000).toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  })
}

function eventTime(value: number | string | undefined): string {
  const timestamp = number(value)
  if (!timestamp) return ''
  const milliseconds = timestamp > 9999999999 ? timestamp : timestamp * 1000
  return new Date(milliseconds).toISOString()
}

export async function fetchEventTrend(orgId: string, period = 7): Promise<EventTrendRow[]> {
  const result = await rpcCall<EventTrendResult>(
    'ThreatOverviewService.ListEventDetectedTrendInfo',
    { period },
    { orgId: orgId || undefined }
  )

  return [...(result.data ?? [])]
    .sort((a, b) => number(a.datetime) - number(b.datetime))
    .map((row) => ({
      label: trendLabel(row.datetime),
      value: Math.max(0, Math.floor(number(row.count))),
    }))
    .slice(-period)
}

export async function fetchLatestIntrusionEvents(orgId: string, count = 5): Promise<RealtimeEvent[]> {
  const result = await rpcCall<RealtimeEventResult>(
    'ThreatOverviewService.ListRealTimeEvents',
    { count },
    { orgId: orgId || undefined }
  )

  return (result.data ?? []).map((row, index) => {
    const level = Math.max(0, Math.min(4, Math.floor(number(row.level))))
    return {
      id: text(row.id) || String(index + 1),
      ip: text(row.host_view?.exposed_ip) || text(row.host_view?.host_ip) || '-',
      level: level as RealtimeEvent['level'],
      eventType: text(row.type) || '-',
      description: text(row.display_name) || text(row.type) || '-',
      state: Math.max(0, Math.floor(number(row.state))),
      occurredAt: eventTime(row.updated_at ?? row.created_at),
    }
  })
}
