<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import ControlIcon from './dashboard/ControlIcon.vue'
import HostTable from './dashboard/HostTable.vue'
import MachineRoomScene from './dashboard/MachineRoomScene.vue'
import MetricIcon from './dashboard/MetricIcon.vue'
import RiskBadge from './dashboard/RiskBadge.vue'
import {
  createDemoModel,
  groupRacks,
  riskColors,
  riskLevels,
  weekdays,
  type Host,
  type RoomView,
} from '../data/hostSecurity'
import { logout } from '../services/auth'
import {
  fetchAgentStateSnapshot,
  fetchHostAssetSnapshot,
  type AgentStateSnapshot,
  type HostAssetSnapshot,
} from '../services/hostAssets'
import { fetchOrganizations, type Organization } from '../services/organizations'
import { fetchHostRiskSnapshot, type HostRiskSnapshot } from '../services/statistics'
import {
  fetchEventTrend,
  fetchLatestIntrusionEvents,
  type EventTrendRow,
  type RealtimeEvent,
} from '../services/threatOverview'

type MetricKey =
  | 'host_total' | 'online_count' | 'offline_count' | 'risk_host_count' | 'open_count'
  | 'event_today' | 'security_score' | 'cpu_avg' | 'agent_online' | 'agent_offline'
  | 'agent_upgrading' | 'agent_version_error'

type IconName = 'chip' | 'layers' | 'host' | 'online' | 'offline' | 'risk' | 'bell' | 'events' | 'shield'

interface DialogState {
  title: string
  hosts?: Host[]
}

interface RoomStat {
  label: string
  value: string
  sub: string
  icon: IconName
  tone: string
}

const ASSET_METRIC_KEYS = new Set<MetricKey>([
  'host_total',
  'online_count',
  'offline_count',
  'risk_host_count',
])

const model = ref(createDemoModel())
const view = ref<RoomView>('room')
const floor = ref('2F')
const zone = ref('all')
const selected = ref('1')
const paused = ref(false)
const patrol = ref(false)
const autoRefresh = ref(true)
const clock = ref('')
const scale = ref(1)
const toastMessage = ref('')
const dialog = ref<DialogState | null>(null)
const dialogRef = ref<HTMLDialogElement>()
const router = useRouter()
const assetSnapshot = ref<HostAssetSnapshot | null>(null)
const hostRiskSnapshot = ref<HostRiskSnapshot | null>(null)
const liveAssetData = ref(false)
const organizations = ref<Organization[]>([])
const selectedOrgId = ref('')
const organizationLoading = ref(false)
const assetLoading = ref(false)
const hostRiskLoading = ref(false)
const eventTrendLoading = ref(false)
const agentStateLoading = ref(false)
const latestEventsLoading = ref(false)
const eventTrend = ref<EventTrendRow[] | null>(null)
const agentStateSnapshot = ref<AgentStateSnapshot | null>(null)
const latestIntrusionEvents = ref<RealtimeEvent[] | null>(null)

let clockTimer = 0
let patrolTimer = 0
let refreshTimer = 0
let toastTimer = 0
let organizationRequestId = 0
let assetRequestId = 0
let hostRiskRequestId = 0
let eventTrendRequestId = 0
let agentStateRequestId = 0
let latestEventsRequestId = 0

const viewTabs: Array<{ value: RoomView; label: string }> = [
  { value: 'room', label: '实体机房' },
  { value: 'topology', label: '主机拓扑' },
  { value: 'risk', label: '风险定位' },
  { value: 'resource', label: '资源监控' },
  { value: 'agent', label: '探针状态' },
]

const metricDefs = [
  { key: 'host_total', label: '主机总数', icon: 'host', tone: '#46ddf8' },
  { key: 'online_count', label: '在线主机', icon: 'online', tone: '#41e5f3' },
  { key: 'offline_count', label: '离线主机', icon: 'offline', tone: '#ece9ff' },
  { key: 'risk_host_count', label: '风险主机', icon: 'risk', tone: '#ffbe66' },
  { key: 'open_count', label: '待处理告警', icon: 'bell', tone: '#ff6277' },
  { key: 'event_today', label: '今日安全事件', icon: 'events', tone: '#43e4f7' },
  { key: 'security_score', label: '安全评分', icon: 'shield', tone: '#31f1de' },
] as const

const summary = computed(() => {
  const hosts = model.value.hosts
  const result: Record<MetricKey, number | null> = {
    host_total: assetSnapshot.value?.hostTotal ?? hosts.length,
    online_count: assetSnapshot.value?.onlineCount ?? hosts.filter((host) => host.online).length,
    offline_count: assetSnapshot.value?.offlineCount ?? hosts.filter((host) => !host.online).length,
    risk_host_count: assetSnapshot.value?.riskCount ?? hosts.filter((host) => host.level > 0).length,
    open_count: hosts.reduce((sum, host) => sum + host.open, 0),
    event_today: model.value.summary.event_today ?? null,
    security_score: model.value.summary.security_score ?? null,
    cpu_avg: model.value.summary.cpu_avg ?? null,
    agent_online: model.value.summary.agent_online ?? null,
    agent_offline: model.value.summary.agent_offline ?? null,
    agent_upgrading: model.value.summary.agent_upgrading ?? null,
    agent_version_error: model.value.summary.agent_version_error ?? null,
  }
  const cpus = hosts.map((host) => host.cpu).filter(Number.isFinite)
  if (result.cpu_avg === null && cpus.length) result.cpu_avg = cpus.reduce((sum, value) => sum + value, 0) / cpus.length
  return result
})

const metricRows = computed(() => metricDefs.map((definition) => {
  const value = summary.value[definition.key]
  const previous = liveAssetData.value && ASSET_METRIC_KEYS.has(definition.key)
    ? null
    : model.value.previous[definition.key] ?? null
  const delta = value === null || previous === null ? null : value - previous
  const rate = delta === null || !previous ? '—' : `${delta >= 0 ? '+' : ''}${((delta / previous) * 100).toFixed(1)}%`
  return {
    ...definition,
    value,
    delta,
    rate,
    cool: definition.key === 'offline_count' || definition.key === 'online_count' || definition.key === 'security_score',
  }
}))

const floors = computed(() => {
  const order = ['3F', '2F', '1F', 'B1']
  return [...new Set(model.value.hosts.map((host) => host.floor))].sort((a, b) => order.indexOf(a) - order.indexOf(b))
})

const zones = computed(() => [...new Set(model.value.hosts.filter((host) => host.floor === floor.value).map((host) => host.zone))].sort())
const visibleHosts = computed(() => model.value.hosts.filter((host) => host.floor === floor.value && (zone.value === 'all' || host.zone === zone.value)))
const sceneRacks = computed(() => groupRacks(visibleHosts.value))
const selectedHost = computed(() => model.value.hosts.find((host) => host.id === selected.value) ?? null)

const roomStats = computed<RoomStat[]>(() => {
  const localLength = visibleHosts.value.length
  return [
    { label: '在线主机', value: `${fmt(summary.value.online_count)} / ${fmt(summary.value.host_total)}`, sub: `在线率 ${pct(summary.value.online_count, summary.value.host_total)}`, icon: 'online', tone: '#3df0ed' },
    { label: '离线主机', value: fmt(summary.value.offline_count), sub: `离线率 ${pct(summary.value.offline_count, summary.value.host_total)}`, icon: 'offline', tone: '#ff627b' },
    { label: '风险主机', value: fmt(summary.value.risk_host_count), sub: `高危 ${fmt(riskCounts.value[3])} | 中危 ${fmt(riskCounts.value[2])}`, icon: 'risk', tone: '#ffa756' },
    { label: '待处理告警', value: fmt(summary.value.open_count), sub: `今日新增 ${fmt(summary.value.event_today)}`, icon: 'bell', tone: '#ff607b' },
    { label: 'CPU 平均使用率', value: `${fmt(summary.value.cpu_avg)}%`, sub: '', icon: 'chip', tone: '#42eeee' },
    { label: '当前区域', value: zone.value === 'all' ? '全部分区' : `${zone.value}区`, sub: `主机数 ${fmt(localLength)}`, icon: 'layers', tone: '#46c7ff' },
  ]
})

const cpuSparkPoints = computed(() => {
  const data = model.value.cpu_history
  const max = Math.max(1, ...data)
  return data.map((value, index) => `${((index * 86) / Math.max(1, data.length - 1)).toFixed(1)},${(15 - (value / max) * 10).toFixed(1)}`).join(' ')
})

const riskCounts = computed(() => {
  if (hostRiskSnapshot.value) return hostRiskSnapshot.value.counts

  const counts = [0, 0, 0, 0, 0]
  if (model.value.risk_distribution?.length) model.value.risk_distribution.forEach((item) => { counts[item.level] = item.value })
  else model.value.hosts.forEach((host) => { counts[host.level] = (counts[host.level] ?? 0) + 1 })
  return counts
})

const riskTotal = computed(() => riskCounts.value.slice(1).reduce((sum, value) => sum + value, 0))
const ringTotal = computed(() => riskCounts.value.reduce((sum, value) => sum + value, 0))
const riskCircumference = 2 * Math.PI * 65
const riskArcs = computed(() => {
  let used = 0
  return [4, 3, 2, 1, 0].map((level) => {
    const count = riskCounts.value[level] ?? 0
    const length = ringTotal.value ? (count / ringTotal.value) * riskCircumference : 0
    const arc = { level, length, offset: -used, color: riskColors[level], count }
    used += length
    return arc
  })
})

const osRows = computed(() => assetSnapshot.value?.osRows ?? distribution('os'))
const groupRows = computed(() => distribution('group'))

const agentDefs = [
  { key: 'online', label: '在线探针', tone: riskColors[0] },
  { key: 'offline', label: '离线探针', tone: riskColors[4] },
  { key: 'abnormal', label: '异常探针', tone: riskColors[3] },
  { key: 'old_version', label: '旧版探针', tone: riskColors[4] },
] as const

const alarmTrendRows = computed(() => eventTrend.value?.slice(-7) ?? model.value.trends)
const alarmTrendMax = computed(() => {
  const maxValue = alarmTrendRows.value.reduce((max, row) => Math.max(max, row.value), 0)
  return Math.max(10, Math.ceil(maxValue / 20) * 20)
})
const alarmTrendPoints = computed(() => alarmTrendRows.value.map((row, index) => ({
  x: 35 + (index * 285) / Math.max(1, alarmTrendRows.value.length - 1),
  y: 128 - (row.value / alarmTrendMax.value) * 100,
  row,
})))
const alarmTrendPath = computed(() => alarmTrendPoints.value.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' '))
const alarmTrendAreaPath = computed(() => {
  if (!alarmTrendPoints.value.length) return ''
  const last = alarmTrendPoints.value[alarmTrendPoints.value.length - 1]
  if (!last) return ''
  return `${alarmTrendPath.value} L${last.x.toFixed(1)} 128 L35 128 Z`
})

const intrusionTrendRows = computed(() => {
  if (eventTrend.value) return eventTrend.value

  const demoRows = model.value.trends
  const now = new Date()
  return Array.from({ length: 30 }, (_, index) => {
    const date = new Date(now)
    date.setDate(date.getDate() - (29 - index))
    return {
      label: date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
      value: demoRows[index % Math.max(1, demoRows.length)]?.value ?? 0,
    }
  })
})
const intrusionTrendTotal = computed(() => intrusionTrendRows.value.reduce((sum, row) => sum + row.value, 0))
const intrusionTrendBars = computed(() => {
  const maxValue = Math.max(1, ...intrusionTrendRows.value.map((row) => row.value))
  const gap = 3
  const barWidth = (329 - gap * 29) / 30
  return intrusionTrendRows.value.map((row, index) => {
    const height = Math.max(1, (row.value / maxValue) * 95)
    return {
      ...row,
      height,
      width: barWidth,
      x: 8 + index * (barWidth + gap),
      y: 124 - height,
    }
  })
})

const agentStateRows = computed(() => agentDefs.map((definition) => {
  if (!agentStateSnapshot.value) {
    const fallbackKeys = {
      online: 'agent_online',
      offline: 'agent_offline',
      abnormal: 'agent_upgrading',
      old_version: 'agent_version_error',
    } as const
    return { ...definition, value: summary.value[fallbackKeys[definition.key]] ?? 0 }
  }

  const snapshot = agentStateSnapshot.value
  const value = definition.key === 'old_version'
    ? snapshot.oldVersionCount
    : definition.key === 'abnormal'
      ? Object.entries(snapshot.stateCounts)
        .filter(([state]) => state !== 'online' && state !== 'offline')
        .reduce((sum, [, value]) => sum + value, 0)
      : snapshot.stateCounts[definition.key] ?? 0
  return { ...definition, value }
}))
const agentStateTotal = computed(() => {
  if (!agentStateSnapshot.value) return agentStateRows.value.reduce((sum, row) => sum + row.value, 0)
  return Object.values(agentStateSnapshot.value.stateCounts).reduce((sum, value) => sum + value, 0)
})
const realtimeEventRows = computed(() => latestIntrusionEvents.value ?? model.value.events.slice(0, 100).map((event) => ({
  id: event.id,
  ip: event.host_ip,
  level: event.level,
  eventType: event.event_type,
  description: event.description,
  state: event.state,
  occurredAt: event.occurred_at,
})))

const screenStyle = computed(() => ({ width: `${1672 * scale.value}px`, height: `${941 * scale.value}px` }))
const dashboardStyle = computed(() => ({ transform: `scale(${scale.value})` }))

function number(value: unknown): number | null {
  const result = Number(value)
  return value !== null && value !== undefined && value !== '' && Number.isFinite(result) ? result : null
}

function fmt(value: unknown) {
  return number(value) === null ? '—' : Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 1 })
}

function pct(value: unknown, total: unknown) {
  const a = number(value)
  const b = number(total)
  return a === null || !b ? '—' : `${((a / b) * 100).toFixed(1)}%`
}

function stamp(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('sv-SE')
}

function eventStateText(state: number) {
  return ({ 1: '有风险', 2: '已忽略', 3: '已处理' } as Record<number, string>)[state] ?? '未知'
}

function bound(value: unknown, max = 100) {
  return Math.max(0, Math.min(max, number(value) ?? 0))
}

function distribution(field: 'os' | 'group') {
  const map = new Map<string, number>()
  model.value.hosts.forEach((host) => {
    const key = host[field] || '未分组'
    map.set(key, (map.get(key) ?? 0) + 1)
  })
  return [...map].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
}

function barWidth(value: number, rows: Array<{ value: number }>) {
  return bound((value / Math.max(1, ...rows.map((row) => row.value))) * 75)
}

function barSymbol(name: string) {
  return ({ Linux: 'Lx', Windows: 'Wi', CentOS: 'Ce', Ubuntu: 'Ub', Other: 'Ot' } as Record<string, string>)[name] ?? 'Ht'
}

function selectHost(id: string, closeDialog = false) {
  const host = model.value.hosts.find((item) => item.id === id)
  if (!host) return
  selected.value = host.id
  floor.value = host.floor
  zone.value = 'all'
  if (closeDialog) dialog.value = null
}

function selectRack(key: string) {
  const rack = sceneRacks.value.find((item) => item.key === key)
  if (!rack) return
  const host = [...rack.hosts].sort((a, b) => b.level - a.level)[0]
  if (host) selectHost(host.id)
}

function changeLocation() {
  selected.value = ''
}

function nextHost() {
  const hosts = visibleHosts.value
  if (!hosts.length) return showToast('当前区域暂无主机')
  const index = hosts.findIndex((host) => host.id === selected.value)
  const host = hosts[(index + 1) % hosts.length]
  if (host) selectHost(host.id)
}

function nextFloor() {
  if (!floors.value.length) return
  const next = floors.value[(floors.value.indexOf(floor.value) + 1) % floors.value.length]
  if (next) floor.value = next
  zone.value = 'all'
  changeLocation()
}

function nextZone() {
  const list = ['all', ...zones.value]
  const next = list[(list.indexOf(zone.value) + 1) % list.length]
  if (next) zone.value = next
  changeLocation()
}

function showHosts(title: string, hosts: Host[]) {
  dialog.value = { title, hosts }
}

function showSelectedRackHosts() {
  const host = selectedHost.value
  if (!host) return
  showHosts(`${host.rack} 机柜主机`, model.value.hosts.filter((item) => item.floor === host.floor && item.zone === host.zone && item.rack === host.rack))
}

function showToast(message: string) {
  toastMessage.value = message
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { toastMessage.value = '' }, 2500)
}

async function loadHostAssets() {
  const requestId = ++assetRequestId
  assetLoading.value = true

  try {
    const snapshot = await fetchHostAssetSnapshot(selectedOrgId.value)
    if (requestId !== assetRequestId) return
    assetSnapshot.value = snapshot
    liveAssetData.value = true
  } catch {
    if (requestId !== assetRequestId) return
    assetSnapshot.value = null
    liveAssetData.value = false
    showToast('主机资产数据加载失败，当前展示演示数据')
  } finally {
    if (requestId === assetRequestId) assetLoading.value = false
  }
}

async function loadOrganizations() {
  const requestId = ++organizationRequestId
  organizationLoading.value = true

  try {
    const rows = await fetchOrganizations()
    if (requestId !== organizationRequestId) return
    organizations.value = rows
  } catch {
    if (requestId !== organizationRequestId) return
    organizations.value = []
    showToast('机构列表加载失败')
  } finally {
    if (requestId === organizationRequestId) organizationLoading.value = false
  }
}

async function loadHostRisk() {
  const requestId = ++hostRiskRequestId
  hostRiskLoading.value = true

  try {
    const snapshot = await fetchHostRiskSnapshot(selectedOrgId.value)
    if (requestId !== hostRiskRequestId) return
    hostRiskSnapshot.value = snapshot
  } catch {
    if (requestId !== hostRiskRequestId) return
    hostRiskSnapshot.value = null
    showToast('主机风险分布加载失败，当前展示演示数据')
  } finally {
    if (requestId === hostRiskRequestId) hostRiskLoading.value = false
  }
}

async function loadEventTrend() {
  const requestId = ++eventTrendRequestId
  eventTrendLoading.value = true

  try {
    const rows = await fetchEventTrend(selectedOrgId.value, 30)
    if (requestId !== eventTrendRequestId) return
    eventTrend.value = rows
  } catch {
    if (requestId !== eventTrendRequestId) return
    eventTrend.value = null
    showToast('告警发生趋势加载失败，当前展示演示数据')
  } finally {
    if (requestId === eventTrendRequestId) eventTrendLoading.value = false
  }
}

async function loadAgentState() {
  const requestId = ++agentStateRequestId
  agentStateLoading.value = true

  try {
    const snapshot = await fetchAgentStateSnapshot(selectedOrgId.value)
    if (requestId !== agentStateRequestId) return
    agentStateSnapshot.value = snapshot
  } catch {
    if (requestId !== agentStateRequestId) return
    agentStateSnapshot.value = null
    showToast('探针状态加载失败，当前展示演示数据')
  } finally {
    if (requestId === agentStateRequestId) agentStateLoading.value = false
  }
}

async function loadLatestEvents() {
  const requestId = ++latestEventsRequestId
  latestEventsLoading.value = true

  try {
    const events = await fetchLatestIntrusionEvents(selectedOrgId.value, 100)
    if (requestId !== latestEventsRequestId) return
    latestIntrusionEvents.value = events
  } catch {
    if (requestId !== latestEventsRequestId) return
    latestIntrusionEvents.value = null
    showToast('最新入侵事件加载失败，当前展示演示数据')
  } finally {
    if (requestId === latestEventsRequestId) latestEventsLoading.value = false
  }
}

function signOut() {
  void logout().finally(() => {
    void router.replace({ name: 'login' })
  })
}

function updateClock() {
  const date = new Date()
  clock.value = `${date.toLocaleString('sv-SE').replaceAll('-', '/')} | ${weekdays[date.getDay()]}`
}

function updateScale() {
  scale.value = Math.min(window.innerWidth / 1672, window.innerHeight / 941)
}

watch(dialog, async (next) => {
  await nextTick()
  const element = dialogRef.value
  if (next && element && !element.open) element.showModal()
  if (!next && element?.open) element.close()
})

watch(floor, (next) => {
  if (zone.value !== 'all' && !zones.value.includes(zone.value)) zone.value = 'all'
  void next
})

watch(selectedOrgId, () => {
  void loadHostAssets()
  void loadHostRisk()
  void loadEventTrend()
  void loadAgentState()
  void loadLatestEvents()
})

onMounted(() => {
  updateClock()
  updateScale()
  void loadOrganizations()
  void loadHostAssets()
  void loadHostRisk()
  void loadEventTrend()
  void loadAgentState()
  void loadLatestEvents()
  window.addEventListener('resize', updateScale)
  clockTimer = window.setInterval(updateClock, 1000)
  patrolTimer = window.setInterval(() => {
    if (!patrol.value || paused.value) return
    const racks = sceneRacks.value
    if (!racks.length) return
    const index = racks.findIndex((rack) => rack.hosts.some((host) => host.id === selected.value))
    const rack = racks[(index + 1) % racks.length]
    const host = rack ? [...rack.hosts].sort((a, b) => b.level - a.level)[0] : undefined
    if (host) selectHost(host.id)
  }, 4000)
  refreshTimer = window.setInterval(() => {
    if (paused.value || !autoRefresh.value) return
    void loadEventTrend()
    void loadLatestEvents()
  }, 18000)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateScale)
  window.clearInterval(clockTimer)
  window.clearInterval(patrolTimer)
  window.clearInterval(refreshTimer)
  window.clearTimeout(toastTimer)
})
</script>

<template>
  <main id="screenFit" :style="screenStyle">
    <section class="dashboard" :class="{ paused: paused }" :style="dashboardStyle">
      <header class="masthead">
        <div class="brand">
          <svg class="brand-mark" viewBox="0 0 42 42" aria-hidden="true">
            <path d="M21 1 41 21 21 41 1 21Z" fill="none" stroke="#00c8ff" stroke-width="2" />
            <path d="M21 7 35 21 21 35 7 21Z" fill="#12b5e5" stroke="#55e8ff" />
          </svg>
          <div>
            <b>云端安全运营</b>
            <small>HOST SECURITY OPERATIONS</small>
          </div>
        </div>
        <div class="headline">
          <h1>主机安全数字孪生中心 V2</h1>
          <p>HOST SECURITY DIGITAL TWIN CENTER</p>
        </div>
        <div class="system">
          <div class="system-actions">
            <time>{{ clock }}</time>
            <button class="logout-button" type="button" @click="signOut">退出</button>
          </div>
        </div>
      </header>

      <section class="metrics" aria-label="主机安全总览">
        <article v-for="metric in metricRows" :key="metric.key" class="metric" :style="{ '--tone': metric.tone }">
          <MetricIcon :name="metric.icon" />
          <div>
            <div class="metric-label">{{ metric.label }}</div>
            <div class="metric-value">
              {{ fmt(metric.value) }}<small v-if="metric.key === 'security_score'"> /100</small>
            </div>
            <div class="metric-bottom">较昨日 <b>{{ metric.rate }}</b></div>
            <span class="metric-delta" :class="{ cool: metric.cool }">
              {{ metric.delta === null ? '' : `${metric.delta >= 0 ? '↑' : '↓'} ${fmt(Math.abs(metric.delta))}` }}
            </span>
          </div>
        </article>
      </section>

      <div class="workspace">
        <aside class="column left-column">
          <section class="panel">
            <h2>主机风险分布 <small>{{ hostRiskLoading ? '加载中' : `${fmt(riskTotal)} 台` }}</small></h2>
            <div class="risk-chart">
              <svg class="donut" viewBox="0 0 160 160" role="img" :aria-label="`风险主机 ${riskTotal} 台`">
                <circle cx="80" cy="80" r="65" fill="none" stroke="#10364f" stroke-width="15" />
                <circle
                  v-for="arc in riskArcs" :key="arc.level" cx="80" cy="80" r="65" fill="none"
                  :stroke="arc.color" stroke-width="15" :stroke-dasharray="`${arc.length} ${riskCircumference - arc.length}`"
                  :stroke-dashoffset="arc.offset" transform="rotate(-90 80 80)"
                />
                <text class="big" x="80" y="81">{{ fmt(riskTotal) }}</text>
                <text class="caption" x="80" y="102">风险主机</text>
              </svg>
              <ul class="risk-legend">
                <li v-for="level in [4, 3, 2, 1, 0]" :key="level">
                  <i class="dot" :style="{ '--tone': riskColors[level] }" />
                  <span>{{ riskLevels[level] }}</span>
                  <span>{{ fmt(riskCounts[level]) }} <small>{{ level ? `(${pct(riskCounts[level], riskTotal)})` : '' }}</small></span>
                </li>
              </ul>
            </div>
          </section>

          <section class="panel">
            <h2>操作系统分布</h2>
            <div class="bar-chart">
              <div v-for="row in osRows" :key="row.name" class="bar-row os-bar-row">
                <span class="bar-symbol">{{ barSymbol(row.name) }}</span>
                <span class="bar-name" :title="row.name">{{ row.name }}</span>
                <div class="bar-track"><div class="bar-fill" :style="{ width: `${barWidth(row.value, osRows)}%` }" /></div>
                <span class="bar-value">{{ fmt(row.value) }} <small>({{ pct(row.value, osRows.reduce((sum, item) => sum + item.value, 0)) }})</small></span>
              </div>
            </div>
          </section>

          <section class="panel">
            <h2>业务组 / 机房分布</h2>
            <div class="bar-chart">
              <div v-for="row in groupRows" :key="row.name" class="bar-row">
                <span class="bar-symbol">Zn</span>
                <span :title="row.name">{{ row.name }}</span>
                <div class="bar-track"><div class="bar-fill" :style="{ width: `${barWidth(row.value, groupRows)}%` }" /></div>
                <span class="bar-value">{{ fmt(row.value) }} <small>({{ pct(row.value, groupRows.reduce((sum, item) => sum + item.value, 0)) }})</small></span>
              </div>
            </div>
          </section>
        </aside>

        <section class="panel room-panel" aria-label="机房可视化">
          <nav class="view-tabs" aria-label="机房视图">
            <button v-for="tab in viewTabs" :key="tab.value" type="button" :class="{ active: view === tab.value }" :aria-pressed="view === tab.value" @click="view = tab.value">
              {{ tab.label }}
            </button>
          </nav>

          <label class="org-picker" for="organization-select">
            <!-- <span>机构</span> -->
            <select
              id="organization-select"
              v-model="selectedOrgId"
              :disabled="organizationLoading"
            >
              <option value="">全部机构</option>
              <option v-for="org in organizations" :key="org.id" :value="org.id">
                {{ org.name }}
              </option>
            </select>
          </label>

          <!-- <div class="room-metrics">
            <div v-for="stat in roomStats" :key="stat.label" class="room-stat" :style="{ '--tone': stat.tone }">
              <MetricIcon :name="stat.icon" />
              <span>{{ stat.label }}</span>
              <strong>{{ stat.value }}</strong>
              <small>{{ stat.sub }}</small>
              <svg v-if="stat.label === 'CPU 平均使用率'" class="sparkline" viewBox="0 0 86 16" aria-label="CPU 使用率趋势">
                <polyline :points="cpuSparkPoints" fill="none" stroke="#53eff2" />
              </svg>
            </div>
          </div> -->

          <div class="scene-wrap">
            <MachineRoomScene
              :racks="sceneRacks" :selected="selected || null" :view="view" :floor="floor"
              :zone="zone" :paused="paused" @select="selectRack"
            />
            <div class="scene-label">
              <b>{{ floor }} · {{ zone === 'all' ? '全部分区' : `${zone}区` }}</b>
              <span>{{ sceneRacks.length }} 个机柜 / {{ visibleHosts.length }} 台主机</span>
            </div>
            <div class="floor-picker" aria-label="楼层">
              <button v-for="item in floors" :key="item" type="button" :aria-pressed="item === floor" @click="floor = item; zone = 'all'; changeLocation()">{{ item }}</button>
            </div>
            <div class="zone-picker" aria-label="分区">
              <button type="button" data-zone="all" :aria-pressed="zone === 'all'" @click="zone = 'all'; changeLocation()">全部</button>
              <button v-for="item in zones" :key="item" type="button" :aria-pressed="item === zone" @click="zone = item; changeLocation()">{{ item }}区</button>
            </div>

            <aside v-if="selectedHost" class="host-card">
              <header>
                <b>{{ selectedHost.rack }}</b>
                <RiskBadge :level="selectedHost.level" />
                <button type="button" aria-label="关闭主机详情" @click="selected = ''">×</button>
              </header>
              <dl>
                <dt>主机名称</dt><dd>{{ selectedHost.name }}</dd>
                <dt>IP 地址</dt><dd>{{ selectedHost.ip }}</dd>
                <dt>在线状态</dt><dd class="online">● {{ selectedHost.online ? '在线' : '离线' }}</dd>
                <dt>CPU 使用率</dt><dd><span class="mini"><i :style="{ width: `${bound(selectedHost.cpu)}%` }" /></span>{{ fmt(selectedHost.cpu) }}%</dd>
                <dt>内存使用率</dt><dd><span class="mini"><i :style="{ width: `${bound(selectedHost.mem)}%` }" /></span>{{ fmt(selectedHost.mem) }}%</dd>
                <dt>最近心跳</dt><dd class="heartbeat">{{ stamp(selectedHost.last_seen_at) }}</dd>
                <dt>所属业务组</dt><dd>{{ selectedHost.group }}</dd>
                <dt>未处理事件</dt><dd class="open-count">{{ fmt(selectedHost.open) }} 条</dd>
              </dl>
              <div class="host-actions">
                <button type="button" @click="showSelectedRackHosts">查看同机柜主机</button>
              </div>
            </aside>
          </div>

          <div class="room-controls">
            <button type="button" :aria-pressed="patrol" @click="patrol = !patrol; showToast(patrol ? '自动巡检已开启' : '自动巡检已停止')">
              <ControlIcon name="patrol" />自动巡检
            </button>
            <button type="button" @click="nextHost"><ControlIcon name="nextHost" />设备切换</button>
            <button type="button" @click="nextFloor"><ControlIcon name="nextFloor" />楼层切换</button>
            <button type="button" @click="nextZone"><ControlIcon name="nextZone" />业务域切换</button>
          </div>
        </section>

        <aside class="column right-column">
          <section class="panel">
            <h2>告警发生趋势 <small>{{ eventTrendLoading ? '加载中' : '近 7 天' }}</small></h2>
            <div class="trend-chart">
              <svg viewBox="0 0 345 164" role="img" aria-label="告警趋势">
                <defs>
                  <linearGradient id="trendFade" x1="0" y1="0" x2="0" y2="1">
                    <stop stop-color="#12cce6" stop-opacity=".3" />
                    <stop offset="1" stop-color="#12cce6" stop-opacity="0" />
                  </linearGradient>
                </defs>
                <path v-for="index in 5" :key="index" :d="`M35 ${128 - (index - 1) * 25}H325`" stroke="#19516b" stroke-dasharray="3 4" />
                <text v-for="index in 5" :key="`text-${index}`" x="5" :y="132 - (index - 1) * 25">{{ fmt((alarmTrendMax * (index - 1)) / 4) }}</text>
                <path :d="alarmTrendAreaPath" fill="url(#trendFade)" />
                <path class="line" :d="alarmTrendPath" />
                <template v-for="point in alarmTrendPoints" :key="point.row.label">
                  <circle class="point" :cx="point.x" :cy="point.y" r="3"><title>{{ point.row.label }}：{{ point.row.value }}</title></circle>
                  <text text-anchor="middle" :x="point.x" :y="point.y - 10">{{ fmt(point.row.value) }}</text>
                  <text text-anchor="middle" :x="point.x" y="151">{{ point.row.label }}</text>
                </template>
              </svg>
            </div>
          </section>

          <section class="panel">
            <h2>30天内入侵事件 <small>{{ eventTrendLoading ? '加载中' : `${fmt(intrusionTrendTotal)} 起` }}</small></h2>
            <div class="intrusion-trend-chart">
              <svg viewBox="0 0 345 164" role="img" :aria-label="`30天内入侵事件 ${intrusionTrendTotal} 起`">
                <line class="axis" x1="8" y1="124.5" x2="337" y2="124.5" />
                <g v-for="(bar, index) in intrusionTrendBars" :key="`${bar.label}-${index}`">
                  <rect
                    class="bar"
                    :class="{ latest: index === intrusionTrendBars.length - 1 }"
                    :height="bar.height"
                    :width="bar.width"
                    :x="bar.x"
                    :y="bar.y"
                  >
                    <title>{{ bar.label }}：{{ bar.value }} 起</title>
                  </rect>
                  <text v-if="index % 5 === 0" text-anchor="middle" :x="bar.x + bar.width / 2" y="143">
                    {{ bar.label }}
                  </text>
                </g>
              </svg>
            </div>
          </section>

          <section class="panel">
            <h2>探针状态 <small>{{ agentStateLoading ? '加载中' : '' }}</small></h2>
            <div class="agent-grid">
              <div v-for="agent in agentStateRows" :key="agent.key" class="agent-box" :style="{ '--tone': agent.tone }">
                <span>{{ agent.label }}</span>
                <strong>{{ fmt(agent.value) }}</strong>
                <small>{{ pct(agent.value, agentStateTotal) }}</small>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <section class="panel events-panel">
        <div class="event-heading">
          <h2>实时安全事件流 <small>{{ latestEventsLoading ? '加载中' : `${realtimeEventRows.length} 条` }}</small></h2>
          <div class="event-controls">
            <label class="toggle"><input v-model="autoRefresh" type="checkbox">自动刷新</label>
            <button type="button" :aria-pressed="paused" :aria-label="paused ? '恢复动画' : '暂停动画'" @click="paused = !paused">{{ paused ? '▶' : 'Ⅱ' }}</button>
          </div>
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>IP地址</th><th>风险等级</th><th>事件类型</th><th>事件详情</th><th>处置状态</th><th>时间</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="event in realtimeEventRows" :key="event.id">
                <td>{{ event.ip }}</td>
                <td><RiskBadge :level="event.level" /></td>
                <td :title="event.eventType">{{ event.eventType }}</td>
                <td class="event-description" :title="event.description">{{ event.description }}</td>
                <td :class="event.state === 1 ? 'status-open' : 'status-done'">{{ eventStateText(event.state) }}</td>
                <td>{{ stamp(event.occurredAt) }}</td>
              </tr>
              <tr v-if="!realtimeEventRows.length"><td class="empty" colspan="6">暂无安全事件</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <footer>
        <span>数据更新时间 {{ stamp(model.updated_at) }}</span>
        <span>主机安全感知 · 数据可视化</span>
      </footer>
    </section>

    <dialog ref="dialogRef" @close="dialog = null">
      <form method="dialog"><button class="dialog-close" type="submit" aria-label="关闭">×</button></form>
      <div v-if="dialog?.hosts" class="dialog-table">
        <h2>{{ dialog?.title }}</h2>
        <div class="table-scroll"><HostTable :hosts="dialog.hosts" @select="id => selectHost(id, true)" /></div>
      </div>
    </dialog>

    <div v-if="toastMessage" class="toast" role="status">{{ toastMessage }}</div>
  </main>
</template>

<style scoped>
.system-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.intrusion-trend-chart {
  padding: 5px 8px 0;
}

.intrusion-trend-chart svg {
  width: 323px;
  height: 164px;
}

.intrusion-trend-chart text {
  fill: #d9ecfb;
  font: 10px Consolas, monospace;
}

.intrusion-trend-chart .axis {
  stroke: #19516b;
}

.intrusion-trend-chart .bar {
  fill: #28a7cf;
  fill-opacity: 0.85;
}

.intrusion-trend-chart .bar:hover {
  fill: #4ae0f8;
  fill-opacity: 1;
}

.intrusion-trend-chart .bar.latest {
  fill: #ffbe66;
}

.org-picker {
  position: absolute;
  z-index: 8;
  left: 9px;
  top: 48px;
  width: 168px;
  height: 24px;
  display: flex;
  align-items: center;
  gap: 5px;
  color: #8ad7ef;
}

.org-picker span {
  font-size: 12px;
  white-space: nowrap;
}

.org-picker select {
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: 0 4px;
  font-size: 12px;
}

.org-picker select option {
  background-color: #062238;
  color: #d9ecfb;
}

.org-picker select option:checked {
  background-color: #0d5f7d;
  color: #fff;
}

.org-picker select:disabled {
  cursor: progress;
  opacity: 0.65;
}

.logout-button {
  height: 21px;
  padding: 0 8px;
  color: #9fe6ff;
  font-size: 12px;
}
</style>
