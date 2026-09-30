export class RpcError extends Error {
  code: number

  constructor(message: string, code: number) {
    super(message)
    this.name = 'RpcError'
    this.code = code
  }
}

interface JsonRpcErrorBody {
  code: number
  message: string
}

interface JsonRpcResponseBody<T> {
  jsonrpc?: string
  id?: string | number | null
  result?: T
  error?: JsonRpcErrorBody
}

export interface RpcCallOptions {
  orgId?: string
}

const RPC_ENDPOINT = '/rpc'
const SESSION_TOKEN_KEY = 'Session-Token'

let requestCounter = 0

function nextRequestId(): string {
  requestCounter += 1
  return `screen-${Date.now().toString(36)}-${requestCounter.toString(36)}`
}

export function getSessionToken(): string {
  return sessionStorage.getItem(SESSION_TOKEN_KEY) ?? ''
}

export function setSessionToken(token: string): void {
  if (token) sessionStorage.setItem(SESSION_TOKEN_KEY, token)
  else sessionStorage.removeItem(SESSION_TOKEN_KEY)
}

export async function rpcCall<T = unknown>(
  method: string,
  params?: unknown,
  options?: RpcCallOptions
): Promise<T> {
  const response = await fetch(RPC_ENDPOINT, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(getSessionToken() ? { 'Session-Token': getSessionToken() } : {}),
      ...(options?.orgId ? { 'X-CW-OID': options.orgId } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: nextRequestId(),
      method,
      ...(params === undefined ? {} : { params }),
    }),
  })

  if (!response.ok) {
    throw new RpcError(`JSON-RPC request failed: ${response.status}`, response.status)
  }

  let data: JsonRpcResponseBody<T>
  try {
    data = await response.json() as JsonRpcResponseBody<T>
  } catch {
    throw new RpcError('JSON-RPC response is not valid JSON', -1)
  }

  if (data.error) {
    throw new RpcError(data.error.message || 'JSON-RPC request failed', data.error.code)
  }

  return data.result as T
}
