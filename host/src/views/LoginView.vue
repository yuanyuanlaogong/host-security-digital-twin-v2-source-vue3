<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { login } from '@/services/auth'

const route = useRoute()
const router = useRouter()

const username = ref('')
const password = ref('')
const errorMessage = ref('')
const submitting = ref(false)
const usernameInput = ref<HTMLInputElement | null>(null)
const passwordInput = ref<HTMLInputElement | null>(null)

onMounted(() => {
  usernameInput.value?.focus()
})

function redirectTarget(): string {
  const value = Array.isArray(route.query.redirect) ? route.query.redirect[0] : route.query.redirect
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/dashboard'
}

async function submit(): Promise<void> {
  errorMessage.value = ''
  if (submitting.value) return

  if (!username.value || !password.value) {
    errorMessage.value = '请输入账号和密码'
    ;(username.value ? passwordInput.value : usernameInput.value)?.focus()
    return
  }

  try {
    submitting.value = true
    await login(username.value, password.value)
    await router.replace(redirectTarget())
  } catch (error) {
    errorMessage.value = error instanceof Error && error.message ? error.message : '登录失败，请稍后重试'
    password.value = ''
    passwordInput.value?.focus()
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="login-page">
    <section class="login-panel" aria-labelledby="login-title">
      <header class="login-header">
        <svg class="login-mark" viewBox="0 0 42 42" aria-hidden="true">
          <path
            d="M21 3 7 9v10c0 9 6 16 14 20 8-4 14-11 14-20V9L21 3Z"
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
          />
          <path d="M14 21h14M21 14v14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
        </svg>
        <div>
          <p>HOST SECURITY DIGITAL TWIN</p>
          <h1 id="login-title">主机安全数字孪生中心</h1>
        </div>
      </header>

      <form novalidate @submit.prevent="submit">
        <div class="field">
          <label for="username">账号</label>
          <input
            id="username"
            ref="usernameInput"
            v-model.trim="username"
            name="username"
            autocomplete="username"
            placeholder="请输入账号"
          >
        </div>

        <div class="field">
          <label for="password">密码</label>
          <input
            id="password"
            ref="passwordInput"
            v-model="password"
            name="password"
            type="password"
            autocomplete="current-password"
            placeholder="请输入密码"
          >
        </div>

        <p v-if="errorMessage" class="error-message" role="alert">{{ errorMessage }}</p>

        <button class="submit-button" type="submit" :disabled="submitting">
          {{ submitting ? '登录中...' : '登录' }}
        </button>
      </form>

      <footer>
        <span>安全访问通道</span>
        <span>V2</span>
      </footer>
    </section>
  </main>
</template>

<style scoped>
.login-page {
  position: relative;
  display: grid;
  place-items: center;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background:
    radial-gradient(ellipse at 72% 18%, #0b5c7c 0, transparent 42%),
    linear-gradient(115deg, #04213a 0, #031728 58%, #041f35 100%);
}

.login-page::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(#47e5f41b 1px, transparent 1px),
    linear-gradient(90deg, #47e5f41b 1px, transparent 1px);
  background-size: 64px 64px;
  mask-image: radial-gradient(ellipse at 50% 50%, #000 20%, transparent 72%);
}

.login-panel {
  position: relative;
  z-index: 1;
  width: min(420px, calc(100vw - 40px));
  padding: 34px 36px 26px;
  border: 1px solid #1784a9;
  border-radius: 6px;
  background: linear-gradient(155deg, #062d47f2, #031a2df8);
  box-shadow: 0 22px 70px #000c, inset 0 0 30px #08699426;
}

.login-header {
  display: flex;
  gap: 16px;
  align-items: center;
  padding-bottom: 25px;
  margin-bottom: 25px;
  border-bottom: 1px solid #165673;
}

.login-mark {
  flex: none;
  width: 46px;
  height: 46px;
  color: #28dcff;
  filter: drop-shadow(0 0 8px #0786bd);
}

.login-header p {
  margin: 0 0 4px;
  color: #48b9d9;
  font-size: 10px;
  letter-spacing: 1.2px;
}

.login-header h1 {
  margin: 0;
  color: #edf6ff;
  font-size: 20px;
  letter-spacing: 1px;
}

.field {
  margin-bottom: 16px;
}

.field label {
  display: block;
  margin-bottom: 7px;
  color: #a8d6e9;
  font-size: 13px;
}

.field input {
  width: 100%;
  height: 42px;
  padding: 0 13px;
  color: #eaf8ff;
  border: 1px solid #1b7695;
  border-radius: 4px;
  background: #031827;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.field input::placeholder {
  color: #5e8ea4;
}

.field input:focus {
  outline: none;
  border-color: #3fd8ff;
  box-shadow: 0 0 0 3px #1897cc38;
}

.error-message {
  min-height: 20px;
  margin: -4px 0 8px;
  color: #ff758c;
  font-size: 13px;
}

.submit-button {
  width: 100%;
  height: 44px;
  margin-top: 4px;
  color: #04121f;
  font-weight: 700;
  letter-spacing: 4px;
  border: 0;
  border-radius: 4px;
  background: linear-gradient(90deg, #21c8f5, #67e9dd);
  transition: filter 0.2s, transform 0.2s;
}

.submit-button:hover {
  filter: brightness(1.08);
}

.submit-button:active {
  transform: translateY(1px);
}

.login-panel footer {
  display: flex;
  justify-content: space-between;
  margin-top: 24px;
  color: #679db4;
  font-size: 11px;
}

@media (max-width: 420px) {
  .login-panel {
    padding: 28px 22px 20px;
  }

  .login-header h1 {
    font-size: 18px;
  }
}
</style>
