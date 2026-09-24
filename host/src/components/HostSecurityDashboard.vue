<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
  type SecurityEvent,
} from '../data/hostSecurity'

type MetricKey =
  | 'host_total' | 'online_count' | 'offline_count' | 'risk_host_count' | 'open_count'
  | 'event_today' | 'security_score' | 'cpu_avg' | 'agent_online' | 'agent_offline'
  | 'agent_upgrading' | 'agent_version_error'

type IconName = 'chip' | 'layers' | 'host' | 'online' | 'offline' | 'risk' | 'bell' | 'events' | 'shield'

interface DialogState {
  title: string
  event?: SecurityEvent
  hosts?: Host[]
}

interface RoomStat {
  label: string
  value: string
  sub: string
  icon: IconName
  tone: string
}

const model = ref(createDemoModel())
const view = ref<RoomView>('room')
const floor = ref('2F')
const zone = ref('all')
const selected = ref('1')
const paused = ref(false)
const patrol = ref(false)
const autoRefresh = ref(true)
const levelFilter = ref('')
const typeFilter = ref('')
const clock = ref('')
const scale = ref(1)
const toastMessage = ref('')
const dialog = ref<DialogState | null>(null)
const dialogRef = ref<HTMLDialogElement>()

let clockTimer = 0
let patrolTimer = 0
let refreshTimer = 0
let toastTimer = 0

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
    host_total: hosts.length,
    online_count: hosts.filter((host) => host.online).length,
    offline_count: hosts.filter((host) => !host.online).length,
    risk_host_count: hosts.filter((host) => host.level > 0).length,
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
  const previous = model.value.previous[definition.key] ?? null
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
    { label: '风险主机', value: fmt(summary.value.risk_host_count), sub: `高危 ${model.value.hosts.filter((host) => host.level === 3).length} | 中危 ${model.value.hosts.filter((host) => host.level === 2).length}`, icon: 'risk', tone: '#ffa756' },
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

const osRows = computed(() => distribution('os'))
const groupRows = computed(() => distribution('group'))
const rankedHosts = computed(() => model.value.hosts.filter((host) => host.level > 0).sort((a, b) => b.open - a.open || b.level - a.level).slice(0, 5))
const allRiskHosts = computed(() => model.value.hosts.filter((host) => host.level > 0).sort((a, b) => b.level - a.level || b.open - a.open))

const trendRows = computed(() => model.value.trends)
const trendMax = computed(() => Math.max(10, Math.ceil(Math.max(...trendRows.value.map((row) => row.value)) / 20) * 20))
const trendPoints = computed(() => trendRows.value.map((row, index) => ({
  x: 35 + (index * 285) / Math.max(1, trendRows.value.length - 1),
  y: 128 - (row.value / trendMax.value) * 100,
  row,
})))
const trendPath = computed(() => trendPoints.value.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' '))
const trendAreaPath = computed(() => {
  if (!trendPoints.value.length) return ''
  const last = trendPoints.value[trendPoints.value.length - 1]
  if (!last) return ''
  return `${trendPath.value} L${last.x.toFixed(1)} 128 L35 128 Z`
})

const agentDefs = [
  { key: 'agent_online', label: '在线探针', tone: riskColors[0] },
  { key: 'agent_offline', label: '离线探针', tone: riskColors[4] },
  { key: 'agent_upgrading', label: '升级中', tone: riskColors[3] },
  { key: 'agent_version_error', label: '版本异常', tone: riskColors[4] },
] as const
const agentTotal = computed(() => agentDefs.reduce((sum, definition) => sum + (summary.value[definition.key] ?? 0), 0))

const eventTypes = computed(() => [...new Set(model.value.events.map((event) => event.event_type))])
const filteredEvents = computed(() => model.value.events.filter((event) => (!levelFilter.value || event.level === Number(levelFilter.value)) && (!typeFilter.value || event.event_type === typeFilter.value)))
const dialogEvent = computed(() => dialog.value?.event ?? null)

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

function eventState(state: number) {
  return ({ 1: '待处理', 2: '已忽略', 3: '已处理' } as Record<number, string>)[state] ?? '未知'
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

function showEvent(event: SecurityEvent) {
  dialog.value = { title: '安全事件详情', event }
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

onMounted(() => {
  updateClock()
  updateScale()
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
    const host = model.value.hosts[0]
    if (!host) return
    model.value.summary.event_today = (model.value.summary.event_today ?? 0) + 1
    model.value.summary.open_count = (model.value.summary.open_count ?? 0) + 1
    host.open += 1
    model.value.events.unshift({
      id: `demo-${Date.now()}`,
      occurred_at: new Date().toISOString(),
      host_name: host.name,
      host_ip: host.ip,
      event_type: '异常登录',
      level: 3,
      description: '演示：检测到新增异常登录告警',
      state: 1,
    })
    model.value.events = model.value.events.slice(0, 100)
    model.value.updated_at = new Date().toISOString()
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
          <time>{{ clock }}</time>
          <span class="system-health"><i></i>系统运行正常</span>
          <span class="source-badge">演示数据</span>
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
            <h2>主机风险分布 <small>{{ fmt(riskTotal) }} 台</small></h2>
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
              <div v-for="row in osRows" :key="row.name" class="bar-row">
                <span class="bar-symbol">{{ barSymbol(row.name) }}</span>
                <span :title="row.name">{{ row.name }}</span>
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

          <div class="room-metrics">
            <div v-for="stat in roomStats" :key="stat.label" class="room-stat" :style="{ '--tone': stat.tone }">
              <MetricIcon :name="stat.icon" />
              <span>{{ stat.label }}</span>
              <strong>{{ stat.value }}</strong>
              <small>{{ stat.sub }}</small>
              <svg v-if="stat.label === 'CPU 平均使用率'" class="sparkline" viewBox="0 0 86 16" aria-label="CPU 使用率趋势">
                <polyline :points="cpuSparkPoints" fill="none" stroke="#53eff2" />
              </svg>
            </div>
          </div>

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
            <h2>告警发生趋势 <small>近 7 天</small></h2>
            <div class="trend-chart">
              <svg viewBox="0 0 345 164" role="img" aria-label="告警趋势">
                <defs>
                  <linearGradient id="trendFade" x1="0" y1="0" x2="0" y2="1">
                    <stop stop-color="#12cce6" stop-opacity=".3" />
                    <stop offset="1" stop-color="#12cce6" stop-opacity="0" />
                  </linearGradient>
                </defs>
                <path v-for="index in 5" :key="index" :d="`M35 ${128 - (index - 1) * 25}H325`" stroke="#19516b" stroke-dasharray="3 4" />
                <text v-for="index in 5" :key="`text-${index}`" x="5" :y="132 - (index - 1) * 25">{{ fmt((trendMax * (index - 1)) / 4) }}</text>
                <path :d="trendAreaPath" fill="url(#trendFade)" />
                <path class="line" :d="trendPath" />
                <template v-for="point in trendPoints" :key="point.row.label">
                  <circle class="point" :cx="point.x" :cy="point.y" r="3"><title>{{ point.row.label }}：{{ point.row.value }}</title></circle>
                  <text text-anchor="middle" :x="point.x" :y="point.y - 10">{{ fmt(point.row.value) }}</text>
                  <text text-anchor="middle" :x="point.x" y="151">{{ point.row.label }}</text>
                </template>
              </svg>
            </div>
          </section>

          <section class="panel">
            <h2>高风险主机 TOP 5 <button class="text-button" type="button" @click="showHosts('风险主机列表', allRiskHosts)">更多 ›</button></h2>
            <HostTable :hosts="rankedHosts" @select="id => selectHost(id, true)" />
          </section>

          <section class="panel">
            <h2>探针状态</h2>
            <div class="agent-grid">
              <div v-for="agent in agentDefs" :key="agent.key" class="agent-box" :style="{ '--tone': agent.tone }">
                <span>{{ agent.label }}</span>
                <strong>{{ fmt(summary[agent.key]) }}</strong>
                <small>{{ pct(summary[agent.key], agentTotal) }}</small>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <section class="panel events-panel">
        <div class="event-heading">
          <h2>实时安全事件流 <small>{{ filteredEvents.length }} 条</small></h2>
          <div class="event-controls">
            <label>
              <span class="sr-only">风险等级</span>
              <select v-model="levelFilter">
                <option value="">全部等级</option>
                <option v-for="level in [4, 3, 2, 1, 0]" :key="level" :value="String(level)">{{ riskLevels[level] }}</option>
              </select>
            </label>
            <label>
              <span class="sr-only">事件类型</span>
              <select v-model="typeFilter">
                <option value="">全部类型</option>
                <option v-for="type in eventTypes" :key="type" :value="type">{{ type }}</option>
              </select>
            </label>
            <label class="toggle"><input v-model="autoRefresh" type="checkbox">自动刷新</label>
            <button type="button" :aria-pressed="paused" :aria-label="paused ? '恢复动画' : '暂停动画'" @click="paused = !paused">{{ paused ? '▶' : 'Ⅱ' }}</button>
          </div>
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>发生时间</th><th>主机名称</th><th>IP 地址</th><th>事件类型</th><th>风险等级</th><th>事件描述</th><th>处理状态</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="event in filteredEvents" :key="event.id">
                <td>{{ stamp(event.occurred_at) }}</td>
                <td>{{ event.host_name }}</td>
                <td>{{ event.host_ip }}</td>
                <td>{{ event.event_type }}</td>
                <td><RiskBadge :level="event.level" /></td>
                <td>{{ event.description }}</td>
                <td :class="event.state === 1 ? 'status-open' : 'status-done'">{{ eventState(event.state) }}</td>
                <td><button class="text-button" type="button" @click="showEvent(event)">详情</button></td>
              </tr>
              <tr v-if="!filteredEvents.length"><td class="empty" colspan="8">没有符合筛选条件的事件</td></tr>
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
      <div v-if="dialogEvent">
        <h2>{{ dialog?.title }}</h2>
        <dl>
          <dt>发生时间</dt><dd>{{ stamp(dialogEvent.occurred_at) }}</dd>
          <dt>主机名称</dt><dd>{{ dialogEvent.host_name }}</dd>
          <dt>IP 地址</dt><dd>{{ dialogEvent.host_ip }}</dd>
          <dt>事件类型</dt><dd>{{ dialogEvent.event_type }}</dd>
          <dt>风险等级</dt><dd>{{ riskLevels[dialogEvent.level] }}</dd>
          <dt>事件描述</dt><dd>{{ dialogEvent.description }}</dd>
          <dt>处理状态</dt><dd>{{ eventState(dialogEvent.state) }}</dd>
        </dl>
      </div>
      <div v-else-if="dialog?.hosts" class="dialog-table">
        <h2>{{ dialog?.title }}</h2>
        <div class="table-scroll"><HostTable :hosts="dialog.hosts" @select="id => selectHost(id, true)" /></div>
      </div>
    </dialog>

    <div v-if="toastMessage" class="toast" role="status">{{ toastMessage }}</div>
  </main>
</template>
