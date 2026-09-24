<script setup lang="ts">
import type { Host } from '../../data/hostSecurity'
import RiskBadge from './RiskBadge.vue'

defineProps<{ hosts: Host[] }>()
defineEmits<{ select: [id: string] }>()
</script>

<template>
  <table class="rank-table">
    <thead>
      <tr>
        <th>#</th>
        <th>主机名称</th>
        <th>IP 地址</th>
        <th>风险等级</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="(host, index) in hosts" :key="host.id">
        <td><span class="rank-index">{{ index + 1 }}</span></td>
        <td><button class="text-button" type="button" @click="$emit('select', host.id)">{{ host.name }}</button></td>
        <td>{{ host.ip }}</td>
        <td><RiskBadge :level="host.level" /></td>
      </tr>
      <tr v-if="!hosts.length">
        <td class="empty" colspan="4">暂无风险主机</td>
      </tr>
    </tbody>
  </table>
</template>
