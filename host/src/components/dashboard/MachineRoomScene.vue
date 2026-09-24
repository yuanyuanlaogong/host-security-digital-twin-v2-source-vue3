<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import type { Rack, RoomView } from '../../data/hostSecurity'

const props = defineProps<{
  racks: Rack[]
  selected: string | null
  view: RoomView
  floor: string
  zone: string
  paused: boolean
}>()

const emit = defineEmits<{ select: [rackKey: string] }>()

const canvasRoot = ref<HTMLDivElement>()
const targetRoot = ref<HTMLDivElement>()
const unavailable = ref(false)

const width = 928
const height = 431
let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let dynamicGroup: THREE.Group
let backgroundGroup: THREE.Group
let animationId = 0
let lastTime = 0
let clockTime = 0
let renderQueued = true
let onSelectRack: (key: string) => void = () => {}
const pickables: THREE.Object3D[] = []
const labels: Array<{ el: HTMLElement; position: THREE.Vector3 }> = []
const particles: Array<{ sprite: THREE.Sprite; a: [number, number, number]; b: [number, number, number]; phase: number; speed: number }> = []
const sharedMaterials: THREE.Material[] = []
const sharedGeometries: THREE.BufferGeometry[] = []
const dynamicGeometries = new Set<THREE.BufferGeometry>()

const anchors: Record<string, [number, number]> = {
  A01: [468, 40], A02: [498, 62], A03: [515, 81], A04: [533, 82],
  B01: [277, 59], B02: [304, 67], B03: [337, 86], B04: [367, 89],
  C01: [281, 219], C02: [313, 245], C03: [340, 272], C04: [372, 301],
  D01: [482, 197], D02: [512, 225], D03: [538, 244], D04: [560, 262],
}

function material(color: THREE.ColorRepresentation, metalness = 0.5, roughness = 0.45, extra: THREE.MeshStandardMaterialParameters = {}) {
  const item = new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra })
  sharedMaterials.push(item)
  return item
}

function box(parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, meshMaterial: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), meshMaterial)
  mesh.position.set(x, y, z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function line(parent: THREE.Object3D, points: Array<[number, number, number]>, color: THREE.ColorRepresentation, opacity = 1) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p)))
  const item = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }))
  item.userData.ownMaterial = true
  parent.add(item)
  return item
}

function createGlowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, '#fff')
  gradient.addColorStop(0.15, '#b0ebff')
  gradient.addColorStop(0.4, '#2aaaff55')
  gradient.addColorStop(1, '#0088ff00')
  context.fillStyle = gradient
  context.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(canvas)
}

let glowTexture: THREE.CanvasTexture | null = null
function glow(parent: THREE.Object3D, x: number, y: number, z: number, color: THREE.ColorRepresentation, size: number) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture,
    color,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0.8,
  }))
  sprite.position.set(x, y, z)
  sprite.scale.set(size, size, 1)
  sprite.userData.ownMaterial = true
  parent.add(sprite)
  return sprite
}

function mergeCabinet(group: THREE.Group) {
  const sets = new Map<THREE.Material, THREE.Mesh[]>()
  group.children.filter((child): child is THREE.Mesh => (child as THREE.Mesh).isMesh).forEach((mesh) => {
    mesh.updateMatrix()
    let list = sets.get(mesh.material as THREE.Material)
    if (!list) sets.set(mesh.material as THREE.Material, (list = []))
    list.push(mesh)
  })

  sets.forEach((list, cabinetMaterial) => {
    const positions: number[] = []
    const normals: number[] = []
    const uvs: number[] = []
    list.forEach((mesh) => {
      const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrix).toNonIndexed()
      positions.push(...(geometry.getAttribute('position')?.array ?? []) as ArrayLike<number> as number[])
      normals.push(...(geometry.getAttribute('normal')?.array ?? []) as ArrayLike<number> as number[])
      uvs.push(...(geometry.getAttribute('uv')?.array ?? []) as ArrayLike<number> as number[])
      geometry.dispose()
      mesh.geometry.dispose()
      group.remove(mesh)
    })
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    const mesh = new THREE.Mesh(geometry, cabinetMaterial)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  })
}

const side = material('#152d42', 0.55, 0.4)
const metal = material('#30475b', 0.65, 0.32)
const topMaterial = material('#345166', 0.8, 0.35)
const rail = material('#45647b', 0.75, 0.3)
const slot = material('#09131c', 0.3, 0.7)
const vent = material('#263d4d', 0.7, 0.5)
const glass = material('#0e5272', 0.6, 0.22, { transparent: true, opacity: 0.23, depthWrite: false })
const cyan = material('#40cfff', 0.2, 0.25, { emissive: '#1dafff', emissiveIntensity: 2.8 })
const amber = material('#ffb35c', 0.1, 0.4, { emissive: '#d4851b', emissiveIntensity: 2 })

function cabinet(parent: THREE.Object3D, x: number, z: number, quiet = false) {
  const group = new THREE.Group()
  group.position.set(x, 0.03, z)
  parent.add(group)
  box(group, 1, 2.3, 1, 0, 1.2, 0, side)
  box(group, 0.95, 0.09, 1.04, 0, 2.4, 0, topMaterial)
  box(group, 1.04, 0.12, 1.06, 0, 0.09, 0, metal)
  for (const xx of [-0.46, 0.46]) {
    box(group, 0.055, 2.26, 0.06, xx, 1.24, 0.53, rail)
    box(group, 0.055, 2.26, 0.06, xx, 1.24, -0.53, rail)
  }
  box(group, 0.79, 2.13, 0.035, 0, 1.25, 0.533, metal)
  for (let j = 0; j < 11; j++) {
    const yy = 0.29 + j * 0.177
    box(group, 0.78, 0.13, 0.038, 0, yy, 0.557, slot)
    box(group, 0.7, 0.009, 0.01, 0, yy + 0.052, 0.583, vent)
    for (let k = 0; k < 5; k++) box(group, 0.053, 0.052, 0.012, -0.26 + k * 0.108, yy, 0.583, vent)
    box(group, 0.03, 0.025, 0.016, 0.3, yy, 0.588, quiet ? vent : cyan)
    if (!quiet) box(group, 0.42, 0.018, 0.015, -0.08, yy - 0.032, 0.6, cyan)
    box(group, 0.035, 0.009, 0.025, -0.335, yy + 0.009, 0.582, rail)
  }
  box(group, 0.013, 1.9, 0.025, 0.36, 1.28, 0.6, rail)
  box(group, 0.03, 0.22, 0.03, 0.36, 1.25, 0.635, topMaterial)
  box(group, 0.89, 2.2, 0.012, 0, 1.24, 0.612, glass)
  for (let j = 0; j < 12; j++) box(group, 0.012, 0.018, 0.73, 0.507, 0.34 + j * 0.165, 0, vent)
  for (const xx of [-0.28, 0.28]) {
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.013, 12), slot)
    fan.position.set(xx, 2.455, 0.05)
    group.add(fan)
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.009, 4, 16), rail)
    guard.rotation.x = Math.PI / 2
    guard.position.copy(fan.position)
    guard.position.y += 0.01
    group.add(guard)
  }
  if (!quiet) group.userData.led = glow(group, 0, 0.8, 0.66, '#139aff', 0.45)
  mergeCabinet(group)
  return group
}

function buildStaticRoom() {
  const floor = new THREE.Group()
  scene.add(floor)
  box(floor, 60, 0.12, 60, 0, -0.08, 0, material('#32516e', 0.5, 0.28))
  for (let x = -11; x <= 11; x++) line(floor, [[x, 0, -9.5], [x, 0, 9.5]], '#36648d', 0.7)
  for (let z = -9; z <= 9; z++) line(floor, [[-11, 0.001, z], [11, 0.001, z]], '#36648d', 0.7)

  const tileGeometry = new THREE.BoxGeometry(0.965, 0.012, 0.965)
  sharedGeometries.push(tileGeometry)
  const tileMaterial = material('#527c9d', 0.52, 0.29)
  const tiles = new THREE.InstancedMesh(tileGeometry, tileMaterial, 323)
  const temp = new THREE.Object3D()
  let tileIndex = 0
  for (let x = -9; x <= 9; x++) {
    for (let z = -8; z <= 8; z++) {
      temp.position.set(x, 0.004, z)
      temp.updateMatrix()
      tiles.setMatrixAt(tileIndex, temp.matrix)
      const v = 0.43 + (((x * 17 + z * 23 + 1000) % 13) * 0.014)
      tiles.setColorAt(tileIndex++, new THREE.Color(v * 0.55, v * 0.78, v))
    }
  }
  tiles.receiveShadow = true
  floor.add(tiles)

  const paths: Array<[[number, number, number], [number, number, number]]> = [
    [[0, 0.025, -9], [0, 0.025, 9]],
    [[-10, 0.03, 0.15], [10, 0.03, 0.15]],
    [[-5.4, 0.026, -8], [-5.4, 0.026, 7]],
    [[5.4, 0.026, -8], [5.4, 0.026, 7]],
    [[-9, 0.029, 4.9], [9, 0.029, 4.9]],
    [[-9, 0.029, -4.8], [9, 0.029, -4.8]],
  ]
  paths.forEach((points, i) => {
    line(floor, points, i === 4 ? '#ffb55f' : '#3eaaff')
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(...points[0]), new THREE.Vector3(...points[1])), 1, 0.018, 5, false),
      i === 4 ? amber : cyan,
    )
    floor.add(tube)
    for (let j = 0; j < 5; j++) {
      const sprite = glow(floor, 0, 0, 0, i === 4 ? '#ffab4a' : '#42bfff', 0.5)
      particles.push({ sprite, a: points[0], b: points[1], phase: j / 5 + i * 0.13, speed: 0.11 + i * 0.007 })
    }
  })

  for (let i = 0; i < 12; i++) {
    const backgroundCabinet = cabinet(backgroundGroup, -9.2 + i * 1.55, -7.4, true)
    backgroundCabinet.scale.setScalar(0.9)
  }
  for (let i = 0; i < 7; i++) {
    cabinet(backgroundGroup, -9.4, -5.4 + i * 1.65, true)
    cabinet(backgroundGroup, 9.4, -5.4 + i * 1.65, true)
  }
  for (const x of [-7, 0, 7]) {
    box(backgroundGroup, 0.2, 4.5, 0.2, x, 2.25, -8, rail)
    box(backgroundGroup, 0.42, 4.4, 0.2, x, 2.2, -7.92, material('#3ab9ff', 0.1, 0.2, {
      transparent: true, opacity: 0.1, depthWrite: false, emissive: '#138aff', emissiveIntensity: 1.1,
    }))
    glow(backgroundGroup, x, 1, -7.5, '#39adff', 2)
  }
}

function anchorWorld(px: number, py: number, targetHeight: number) {
  camera.updateMatrixWorld()
  const origin = camera.position.clone()
  const direction = new THREE.Vector3((px / width) * 2 - 1, 1 - (py / height) * 2, 0.5)
    .unproject(camera)
    .sub(origin)
    .normalize()
  return origin.addScaledVector(direction, (targetHeight - origin.y) / direction.y)
}

function updateLabels() {
  labels.forEach(({ el, position }) => {
    const vector = position.clone().project(camera)
    const visible = vector.z < 1 && Math.abs(vector.x) < 1 && Math.abs(vector.y) < 1
    el.style.display = visible ? 'block' : 'none'
    el.style.left = `${(vector.x * 0.5 + 0.5) * width}px`
    el.style.top = `${(-vector.y * 0.5 + 0.5) * height}px`
    el.style.zIndex = String(Math.round((1 - vector.z) * 100))
  })
}

function disposeDynamic() {
  if (!dynamicGroup) return
  dynamicGroup.children.forEach((child) => {
    child.traverse((item) => {
      const mesh = item as THREE.Mesh
      if (mesh.isMesh && mesh.geometry && !sharedGeometries.includes(mesh.geometry)) mesh.geometry.dispose()
      if (item.userData.ownMaterial && (item as THREE.Mesh).material) ((item as THREE.Mesh).material as THREE.Material).dispose()
    })
  })
  dynamicGroup.clear()
  dynamicGeometries.clear()
  pickables.length = 0
  labels.length = 0
  targetRoot.value?.replaceChildren()
}

function redraw() {
  if (!renderer || !targetRoot.value) return
  const targets = targetRoot.value
  onSelectRack = (key: string) => emit('select', key)
  disposeDynamic()
  const extraAngle = -0.232
  camera.position.set(9.3 * Math.cos(extraAngle) + 12.5 * Math.sin(extraAngle), 9.4, 12.5 * Math.cos(extraAngle) - 9.3 * Math.sin(extraAngle))
  camera.lookAt(0, 0.8, 0)

  const basePositions: Record<string, [number, number]> = { A: [0.2, -3.8], B: [-4.1, -0.9], C: [-0.9, 3.3], D: [4.4, 1.5] }
  const zoneIndices: Record<string, number> = {}
  props.racks.forEach((rack, index) => {
    const base = basePositions[rack.zone] ?? [0, 0]
    const itemIndex = zoneIndices[rack.zone] ?? 0
    zoneIndices[rack.zone] = itemIndex + 1
    const rackScale = rack.zone === 'C' || rack.zone === 'D' ? 0.78 : 1.08
    const anchor = anchors[rack.name]
    const anchorPoint = anchor ? anchorWorld(anchor[0], anchor[1], 2.78 * rackScale) : null
    const x = anchorPoint ? anchorPoint.x : base[0] + ((itemIndex % 2) - 0.5) * 1.37
    const z = anchorPoint ? anchorPoint.z : base[1] + (Math.floor(itemIndex / 2) - 0.5) * 1.65
    const rackGroup = cabinet(dynamicGroup, x, z)
    rackGroup.scale.setScalar(rackScale)
    rackGroup.userData.rackKey = rack.key

    const level = Math.max(0, ...rack.hosts.map((host) => host.level))
    const selected = rack.hosts.some((host) => host.id === props.selected)
    const cpuValues = rack.hosts.map((host) => host.cpu).filter(Number.isFinite)
    const cpu = cpuValues.length ? cpuValues.reduce((sum, value) => sum + value, 0) / cpuValues.length : null
    const agents = rack.hosts.filter((host) => host.agent)
    const onlineAgents = agents.filter((host) => host.agent === 'online').length
    let color: THREE.ColorRepresentation = selected ? '#ff4968' : props.view === 'room' && rack.name === 'C03' ? '#ffa23d' : '#20abf5'
    if (props.view === 'risk') color = ['#16bba9', '#3ac3ff', '#f0cb59', '#ffa445', '#ff506d'][level] ?? '#16bba9'
    if (props.view === 'resource') color = cpu === null ? '#7895a5' : cpu > 75 ? '#ff6d63' : '#2cd5eb'
    if (props.view === 'agent') color = agents.length ? (onlineAgents === agents.length ? '#2ce6c7' : '#ffa755') : '#7592a3'

    if (selected || props.view === 'risk' || props.view === 'agent' || (props.view === 'room' && rack.name === 'C03')) {
      const outlineGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.91, 2.24, 0.91))
      dynamicGeometries.add(outlineGeometry)
      const edge = new THREE.LineSegments(outlineGeometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }))
      edge.position.set(0, 1.24, 0)
      edge.userData.ownMaterial = true
      rackGroup.add(edge)
      glow(rackGroup, 0, 2.4, 0, color, 0.65)
      const aura = box(rackGroup, 1.15, 0.015, 1.15, 0, 0.035, 0, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false }))
      aura.userData.ownMaterial = true
    }
    if (props.view === 'topology') line(dynamicGroup, [[0, 3, 0], [x, 2.8, z], [x, 2.5, z]], '#3ddbff', 0.8)

    const button = document.createElement('button')
    button.type = 'button'
    button.className = `rack-target${selected ? ' active' : props.view === 'room' && rack.name === 'C03' ? ' warm' : ''}`
    button.textContent = props.view === 'resource' ? `${rack.name} ${cpu === null ? '--' : `${Math.round(cpu)}%`}` : props.view === 'agent' ? `${rack.name} ${agents.length ? `${onlineAgents}/${agents.length}` : '--'}` : rack.name
    button.setAttribute('aria-label', `机柜 ${rack.name}，${rack.hosts.length} 台主机`)
    button.onclick = () => onSelectRack(rack.key)
    targets.append(button)
    labels.push({ el: button, position: new THREE.Vector3(x, 2.78 * rackScale, z) })
    rackGroup.traverse((item) => {
      if ((item as THREE.Mesh).isMesh) {
        item.userData.rackKey = rack.key
        pickables.push(item)
      }
    })
    void index
  })

  if (!props.racks.length) {
    const empty = document.createElement('p')
    empty.className = 'room-empty'
    empty.textContent = '当前区域暂无主机'
    targets.append(empty)
  }

  Object.entries(basePositions).forEach(([zone, base]) => {
    if (!props.racks.some((rack) => rack.zone === zone)) return
    const sign = document.createElement('span')
    sign.className = 'zone-sign'
    sign.textContent = `${zone}区`
    targets.append(sign)
    const signPositions: Record<string, [number, number]> = { A: [500, 45], B: [260, 48], C: [162, 268], D: [802, 320] }
    const xy = signPositions[zone] ?? [0, 0]
    if (zone !== 'A') labels.push({ el: sign, position: anchorWorld(xy[0], xy[1], 0.25) })
    else sign.style.display = 'none'
    void base
  })

  if (props.floor === '2F' && props.zone === 'all') {
    for (const xy of [[170, 123], [205, 149], [239, 176], [109, 39], [184, -15], [395, -8], [657, 102]] as Array<[number, number]>) {
      const point = anchorWorld(xy[0], xy[1], 2.78)
      cabinet(dynamicGroup, point.x, point.z, true).userData.contextOnly = true
    }
  }
  updateLabels()
  renderQueued = true
}

function handleClick(event: MouseEvent) {
  if (!renderer) return
  const rect = renderer.domElement.getBoundingClientRect()
  const mouse = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  )
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(mouse, camera)
  const hit = raycaster.intersectObjects(pickables, false)[0]
  if (hit) onSelectRack(hit.object.userData.rackKey as string)
}

function frame(now: number) {
  animationId = requestAnimationFrame(frame)
  const elapsed = Math.min(0.05, (now - (lastTime || now)) / 1000)
  lastTime = now
  if (!props.paused && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    clockTime += elapsed
    particles.forEach((particle) => {
      const t = (clockTime * particle.speed + particle.phase) % 1
      particle.sprite.position.set(
        particle.a[0] + (particle.b[0] - particle.a[0]) * t,
        0.065,
        particle.a[2] + (particle.b[2] - particle.a[2]) * t,
      )
    })
    dynamicGroup.children.forEach((group, index) => {
      if (group.userData.led) (group.userData.led as THREE.Sprite).material.opacity = 0.4 + Math.sin(clockTime * 2 + index) * 0.2
    })
    renderQueued = true
  }
  if (renderer && renderQueued) {
    renderer.render(scene, camera)
    renderQueued = false
  }
}

onMounted(() => {
  if (!canvasRoot.value || !targetRoot.value) return
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
  } catch {
    unavailable.value = true
    return
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6))
  renderer.setSize(width, height)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.4
  canvasRoot.value.append(renderer.domElement)
  renderer.domElement.addEventListener('click', handleClick)

  scene = new THREE.Scene()
  scene.background = new THREE.Color('#051c30')
  scene.fog = new THREE.FogExp2('#041a2d', 0.025)
  camera = new THREE.PerspectiveCamera(33, width / height, 0.1, 80)
  camera.position.set(9.3, 9.4, 12.5)
  camera.lookAt(0, 1.1, 0)

  scene.add(new THREE.HemisphereLight('#b9e6ff', '#142c44', 3.4))
  const keyLight = new THREE.DirectionalLight('#c2e5ff', 3.3)
  keyLight.position.set(-6, 13, 7)
  keyLight.castShadow = true
  keyLight.shadow.mapSize.set(2048, 2048)
  Object.assign(keyLight.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 0.1, far: 40 })
  keyLight.shadow.bias = -0.0005
  scene.add(keyLight)
  const blue = new THREE.PointLight('#008dff', 60, 22, 2)
  blue.position.set(-4, 4, -4)
  scene.add(blue)
  const rim = new THREE.DirectionalLight('#259dff', 2)
  rim.position.set(6, 4, -8)
  scene.add(rim)

  glowTexture = createGlowTexture()
  dynamicGroup = new THREE.Group()
  backgroundGroup = new THREE.Group()
  scene.add(dynamicGroup, backgroundGroup)
  buildStaticRoom()
  redraw()
  animationId = requestAnimationFrame(frame)
})

watch(() => [props.racks, props.selected, props.view, props.floor, props.zone], redraw)

onBeforeUnmount(() => {
  cancelAnimationFrame(animationId)
  renderer?.domElement.removeEventListener('click', handleClick)
  renderer?.dispose()
  renderer?.domElement.remove()
  glowTexture?.dispose()
  disposeDynamic()
  scene?.traverse((item) => {
    const mesh = item as THREE.Mesh
    if (mesh.isMesh && mesh.geometry && !sharedGeometries.includes(mesh.geometry)) mesh.geometry.dispose()
  })
  sharedGeometries.forEach((geometry) => geometry.dispose())
  sharedMaterials.forEach((item) => item.dispose())
  renderer = null
})
</script>

<template>
  <div class="machine-room" ref="canvasRoot"></div>
  <div class="rack-targets" ref="targetRoot"></div>
  <p v-if="unavailable" class="room-empty">当前浏览器无法启用 WebGL，请开启硬件加速后刷新。</p>
</template>
