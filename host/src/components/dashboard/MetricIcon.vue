<script setup lang="ts">
const paths = {
  chip: 'M8 8h16v16H8Z M12 12h8v8h-8Z M4 10h4 M4 16h4 M4 22h4 M24 10h4 M24 16h4 M24 22h4 M10 4v4 M16 4v4 M22 4v4 M10 24v4 M16 24v4 M22 24v4',
  layers: 'M16 3 29 10 16 17 3 10Z M3 16 16 23 29 16 M3 22 16 29 29 22',
  host: 'M5 3h22v8H5z M5 14h22v8H5z M5 25h22v4H5z M9 7h3 M9 18h3',
  online: 'M3 4h26v19H3z M16 23v6 M10 29h12 M10 14l4 4 8-9',
  offline: 'M3 4h26v19H3z M16 23v6 M10 29h12 M12 9l8 9 M20 9l-8 9',
  risk: 'M16 3 30 28H2Z M16 11v8 M16 23v1',
  bell: 'M7 23h18l-3-5v-7a6 6 0 0 0-12 0v7Z M12 27q4 5 8 0 M16 2v3',
  events: 'M5 3h22v26H5Z M10 9h2 M16 9h7 M10 16h2 M16 16h7 M10 23h2 M16 23h7',
  shield: 'M16 2 28 7v9q-1 9-12 14Q5 25 4 16V7Z M10 15l4 5 9-10',
} as const

defineProps<{ name: keyof typeof paths }>()
</script>

<template>
  <svg class="metric-icon" viewBox="0 0 32 32" aria-hidden="true">
    <path :d="paths[name]" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</template>
