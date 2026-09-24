<script setup lang="ts">
const paths = {
  patrol: 'M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.5 5.5l2 2 M16.5 16.5l2 2 M5.5 18.5l2-2 M16.5 7.5l2-2 M12 7a5 5 0 1 0 0 10 5 5 0 1 0 0-10',
  nextHost: 'M7 5h9l4 4 M20 4v5h-5 M17 19H8l-4-4 M4 20v-5h5 M2 10l2-4 M22 14l-2 4',
  nextFloor: 'M12 2 22 8 12 14 2 8Z M2 12l10 6 10-6 M2 16l10 6 10-6',
  nextZone: 'M3 3h6v6H3Z M15 3h6v6h-6Z M3 15h6v6H3Z M15 15h6v6h-6Z',
} as const

defineProps<{ name: keyof typeof paths }>()
</script>

<template>
  <svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path :d="paths[name]" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</template>
