<script setup lang="ts">
import { riskColors, riskLevels, type RiskLevel } from '../../data/hostSecurity'

defineProps<{ level: RiskLevel }>()
</script>

<template>
  <span class="badge" :style="{ '--tone': riskColors[level] }">{{ riskLevels[level] }}</span>
</template>
