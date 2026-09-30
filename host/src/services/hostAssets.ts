import { rpcCall } from './rpc'

export interface HostAsset {
  host_state?: string
  os_release_name?: string
  os_release_version?: string
  [key: string]: unknown
}

export interface OsDistributionRow {
  name: string
  value: number
}

export interface HostAssetSnapshot {
  hostTotal: number
  onlineCount: number
  offlineCount: number
  riskCount: number
  osRows: OsDistributionRow[]
}

export interface AgentStateSnapshot {
  stateCounts: Record<string, number>
  oldVersionCount: number
}

interface HostAssetListResult {
  result?: HostAsset[]
  total?: number
}

interface AgentStateListResult {
  data?: Array<{ agent_state?: string; host_count?: number }>
  old_version_count?: number
}

const HOST_STATES = ['online', 'offline', 'abnormal', 'disabled', 'hibernation'] as const
const RISK_STATES = new Set(['abnormal', 'disabled', 'hibernation'])
const PAGE_SIZE = 100
const MAX_HOSTS = 50000

function count(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
}

function osName(host: HostAsset): string {
  const name = host.os_release_name || host.host_os_name || host.os_name
  return typeof name === 'string' && name.trim() ? name.trim() : '未知系统'
}

function buildOsRows(hosts: HostAsset[]): OsDistributionRow[] {
  const counts = new Map<string, number>()
  hosts.forEach((host) => {
    const name = osName(host)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  })

  const rows = [...counts].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  if (rows.length <= 5) return rows

  const top = rows.slice(0, 4)
  const otherValue = rows.slice(4).reduce((sum, row) => sum + row.value, 0)
  return [...top, { name: '其他', value: otherValue }]
}

async function fetchHostAssetPage(offset: number, orgId: string): Promise<HostAssetListResult> {
  return rpcCall<HostAssetListResult>('HostAssetService.GetHostAssetList', {
    custom_attr: [],
    host_state: [...HOST_STATES],
    count: PAGE_SIZE,
    offset,
    order_by: { column: 'last_seen_at', order: 'DESC' },
  }, { orgId: orgId || undefined })
}

export async function fetchHostAssetSnapshot(orgId: string): Promise<HostAssetSnapshot> {
  const firstPage = await fetchHostAssetPage(0, orgId)
  const total = count(firstPage.total ?? firstPage.result?.length ?? 0)
  const hosts = [...(firstPage.result ?? [])]

  while (hosts.length < total && hosts.length < MAX_HOSTS) {
    const page = await fetchHostAssetPage(hosts.length, orgId)
    const rows = page.result ?? []
    if (!rows.length) break
    hosts.push(...rows)
  }

  const onlineCount = hosts.filter((host) => host.host_state === 'online').length
  const offlineCount = hosts.filter((host) => host.host_state === 'offline').length
  const riskCount = hosts.filter((host) => RISK_STATES.has(host.host_state ?? '')).length

  return {
    hostTotal: onlineCount + offlineCount + riskCount,
    onlineCount,
    offlineCount,
    riskCount,
    osRows: buildOsRows(hosts),
  }
}

export async function fetchAgentStateSnapshot(orgId: string): Promise<AgentStateSnapshot> {
  const result = await rpcCall<AgentStateListResult>(
    'HostAssetService.StatAgentState',
    { custom_attr: [] },
    { orgId: orgId || undefined }
  )
  const stateCounts: Record<string, number> = {}

  result.data?.forEach((row) => {
    const state = row.agent_state?.trim()
    if (!state) return
    stateCounts[state] = (stateCounts[state] ?? 0) + count(row.host_count)
  })

  return {
    stateCounts,
    oldVersionCount: count(result.old_version_count),
  }
}
