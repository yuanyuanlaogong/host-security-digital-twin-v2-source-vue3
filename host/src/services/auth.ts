import { encryptPassword } from './cloudwalkerCrypto'
import { rpcCall, setSessionToken } from './rpc'

export interface AuthUser {
  username: string
  displayName: string
}

const AUTH_STORAGE_KEY = 'host-security-auth-user'

interface PublicKeyResult {
  public_key?: string
}

interface CaptchaResult {
  captcha_id?: string
}

interface CloudwalkerLoginResult {
  id?: number
  next_types?: string[]
}

interface SessionTokenResult {
  token?: string
}

interface CurrentUserInfo {
  current_name?: unknown
  name?: unknown
  current_id?: unknown
  id?: unknown
}

export function getAuthUser(): AuthUser | null {
  const stored = sessionStorage.getItem(AUTH_STORAGE_KEY)
  if (!stored) return null

  try {
    const user = JSON.parse(stored) as Partial<AuthUser>
    return typeof user.username === 'string' && typeof user.displayName === 'string' ? user as AuthUser : null
  } catch {
    return null
  }
}

export function isLoggedIn(): boolean {
  return getAuthUser() !== null
}

export async function login(username: string, password: string): Promise<AuthUser> {
  setSessionToken('')

  try {
    await rpcCall('AccountAuthService.Logout', {})
  } catch {
    // A stale server session should not block a fresh login.
  }

  const [publicKeyResult, captchaResult] = await Promise.all([
    rpcCall<PublicKeyResult>('CloudwalkerSettingService.GetPublicKey', {}),
    rpcCall<CaptchaResult>('AccountNoAuthService.GetCaptcha', {}),
  ])
  const encryptedPassword = await encryptPassword(publicKeyResult.public_key ?? '', password)
  const credentials: Record<string, string> = { password: encryptedPassword }
  if (captchaResult.captcha_id) credentials.captcha_id = captchaResult.captcha_id

  const loginResult = await rpcCall<CloudwalkerLoginResult>('AccountNoAuthService.Login', {
    username,
    type: '',
    credentials,
  })
  if (loginResult.next_types?.length) {
    throw new Error(`登录还需要额外认证：${loginResult.next_types.join('、')}`)
  }

  const sessionResult = await rpcCall<SessionTokenResult>(
    'AccountAuthService.CreateSessionToken',
    {
      credentials: { password: encryptedPassword },
      duration: 3600,
      permissions: ['privileged'],
    }
  )
  setSessionToken(sessionResult.token ?? '')

  let displayName = username
  try {
    const info = await rpcCall<CurrentUserInfo>('AccountAuthService.GetCurrentUserInfo', {})
    const name = info.current_name ?? info.name
    if (typeof name === 'string' && name) displayName = name
  } catch {
    // The dashboard only needs a display name; the cookie session is already valid.
  }

  const user: AuthUser = { username, displayName }
  sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user))
  return user
}

export async function logout(): Promise<void> {
  try {
    await rpcCall('AccountAuthService.Logout', {})
  } catch {
    // Always clear the local screen session, even if the server session is gone.
  } finally {
    sessionStorage.removeItem(AUTH_STORAGE_KEY)
    setSessionToken('')
  }
}
