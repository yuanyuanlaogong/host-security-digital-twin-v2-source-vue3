export type RiskLevel = 0 | 1 | 2 | 3 | 4
export type RoomView = 'room' | 'topology' | 'risk' | 'resource' | 'agent'
export type AgentStatus = 'online' | 'offline' | 'upgrading' | 'error'

export interface Host {
  id: string
  name: string
  ip: string
  os: string
  group: string
  floor: string
  zone: string
  rack: string
  level: RiskLevel
  online: boolean
  cpu: number
  mem: number
  open: number
  agent: AgentStatus
  last_seen_at: string
}

export interface SecurityEvent {
  id: string
  occurred_at: string
  host_name: string
  host_ip: string
  event_type: string
  level: RiskLevel
  description: string
  state: 1 | 2 | 3
}

export interface SecurityModel {
  hosts: Host[]
  events: SecurityEvent[]
  cpu_history: number[]
  summary: Record<string, number | null>
  previous: Record<string, number | null>
  risk_distribution?: Array<{ level: RiskLevel; value: number }>
  trends: Array<{ label: string; value: number }>
  updated_at: string
}

export interface Rack {
  key: string
  name: string
  zone: string
  hosts: Host[]
}

export const riskColors = ['#21ddcf', '#50cafd', '#f2ce5b', '#ffa34f', '#ff607b']
export const riskLevels = ['安全', '低危', '中危', '高危', '严重']
export const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

const seedNames = ['core-web-01', 'app-db-02', 'core-svc-03', 'data-svc-12', 'ops-db-05', 'test-svc-03']
const riskSeed: RiskLevel[] = [4, 3, 3, 2, 2, 1, 4, 4, 4, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 1, 1, 1, 1]

export function createDemoModel(): SecurityModel {
  const floorSeed = ['2F', '3F', '1F', 'B1'] as const
  const zoneSeed = 'ABCD'
  const hosts: Host[] = Array.from({ length: 482 }, (_, i) => ({
    id: String(i + 1),
    name: seedNames[i] ?? `host-${String(i + 1).padStart(3, '0')}`,
    ip: `10.20.${Math.floor(i / 240) + 1}.${(i % 240) + 1}`,
    os: i < 168 ? 'Linux' : i < 292 ? 'Windows' : i < 378 ? 'CentOS' : i < 450 ? 'Ubuntu' : 'Other',
    group: i < 156 ? '核心业务区' : i < 274 ? '应用服务区' : i < 370 ? '数据服务区' : i < 442 ? '运维管理区' : '测试开发区',
    floor: floorSeed[Math.floor(i / 16) % 4] ?? '2F',
    zone: zoneSeed[Math.floor(i / 4) % 4] ?? 'A',
    rack: `${zoneSeed[Math.floor(i / 4) % 4] ?? 'A'}${String((i % 4) + 1).padStart(2, '0')}`,
    level: (riskSeed[i] ?? 0) as RiskLevel,
    online: i < 438,
    cpu: 18 + ((i * 7) % 53),
    mem: 24 + ((i * 11) % 62),
    open: i < 5 ? [5, 3, 2, 2, 1][i] ?? 0 : 0,
    agent: i < 438 ? 'online' : 'offline',
    last_seen_at: new Date().toISOString(),
  }))

  if (hosts[0]) Object.assign(hosts[0], { ip: '10.20.1.11', rack: 'A02', zone: 'A', cpu: 68, mem: 72, last_seen_at: '2026-09-22T22:02:01' })
  if (hosts[1]) Object.assign(hosts[1], { ip: '10.20.3.18', rack: 'B02', zone: 'B' })
  if (hosts[2]) Object.assign(hosts[2], { ip: '10.20.2.22', rack: 'B03', zone: 'B' })
  if (hosts[3]) Object.assign(hosts[3], { ip: '10.20.4.16', rack: 'D03', zone: 'D' })
  if (hosts[4]) Object.assign(hosts[4], { ip: '10.20.4.15', rack: 'D04', zone: 'D' })

  const eventTypes = ['WebShell', '异常登录', '暴力破解', '恶意文件', '弱口令', '安全基线']
  const descriptions = [
    '检测到 webshell 文件 (/var/www/shell.php)',
    '检测到异常登录行为 (root)',
    '检测到多次 SSH 暴力破解尝试',
    '检测到可疑文件 (Trojan.Linux.Agent)',
    '检测到弱口令账户 (admin)',
    '主机存在多项基线不合规',
  ]
  const eventLevels: RiskLevel[] = [4, 3, 3, 2, 2, 1]
  const events: SecurityEvent[] = eventTypes.map((type, i) => ({
    id: String(i + 1),
    occurred_at: new Date(Date.now() - i * 45000).toISOString(),
    host_name: hosts[i]?.name ?? '—',
    host_ip: hosts[i]?.ip ?? '—',
    event_type: type,
    level: eventLevels[i] ?? 0,
    description: descriptions[i] ?? '',
    state: i % 3 === 2 ? 3 : 1,
  }))

  return {
    hosts,
    events,
    cpu_history: [28, 30, 26, 34, 31, 40, 25, 29, 27, 32],
    summary: {
      host_total: 482,
      online_count: 438,
      offline_count: 44,
      risk_host_count: 24,
      open_count: 52,
      event_today: 96,
      security_score: 82,
      cpu_avg: 32,
      agent_online: 456,
      agent_offline: 28,
      agent_upgrading: 6,
      agent_version_error: 2,
    },
    previous: {
      host_total: 470,
      online_count: 420,
      offline_count: 50,
      risk_host_count: 16,
      open_count: 29,
      event_today: 80,
      security_score: 76,
    },
    risk_distribution: [
      { level: 4, value: 4 },
      { level: 3, value: 8 },
      { level: 2, value: 7 },
      { level: 1, value: 5 },
      { level: 0, value: 24 },
    ],
    trends: [28, 36, 52, 48, 65, 58, 52].map((value, i) => ({
      value,
      label: new Date(Date.now() - (6 - i) * 86400000)
        .toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })
        .split('/')
        .reverse()
        .join('/'),
    })),
    updated_at: new Date().toISOString(),
  }
}

export function groupRacks(hosts: Host[]): Rack[] {
  const map = new Map<string, Rack>()
  hosts.forEach((host) => {
    const key = `${host.zone}/${host.rack}`
    if (!map.has(key)) map.set(key, { key, name: host.rack, zone: host.zone, hosts: [] })
    map.get(key)!.hosts.push(host)
  })
  return [...map.values()]
}
