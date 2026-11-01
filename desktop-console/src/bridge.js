// The only browser credential is a short-lived, account-bound local capability.
// Native account JWTs and refresh tokens never enter this origin.
export const API_BASE = '/api/stallionx/console'

let bootstrap
let parentOrigin
let active = true
const listeners = new Set()
let resolveReady
export const ready = new Promise((resolve) => { resolveReady = resolve })

export function postParent(type, values = {}) {
  if (parentOrigin) window.parent.postMessage({ ...values, type }, parentOrigin)
}

export function subscribeBridge(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function runtime() { return bootstrap }
export function isSessionActive() { return active }
export function consoleCapability() {
  if (!bootstrap || !active) throw new Error('Desktop account session unavailable')
  return bootstrap.capability
}

export function expireSession() {
  if (!active) return
  active = false
  listeners.forEach((listener) => listener({ type: 'stx-console-expired' }))
  postParent('stx-console-auth-expired')
}

export function signOut() {
  active = false
  listeners.forEach((listener) => listener({ type: 'stx-console-expired' }))
  postParent('stx-console-signout')
}

export function publicOrigin() { return bootstrap.service }

export function openExternal(raw) {
  const url = new URL(raw, `${publicOrigin()}/`)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Unsupported external destination')
  }
  // The native parent independently validates allowed destinations.
  postParent('stx-console-open-external', { url: url.href })
}

export function consoleURL(path) {
  if (typeof path !== 'string' || !path.startsWith('/api/') || /[\\\r\n]/.test(path)) {
    throw new Error('Unsupported account endpoint')
  }
  const url = new URL(`${API_BASE}${path}`, window.location.origin)
  if (url.origin !== window.location.origin || !url.pathname.startsWith(`${API_BASE}/api/`)) {
    throw new Error('Unsupported account endpoint')
  }
  return url
}

export async function consoleFetch(raw, init = {}) {
  const url = new URL(raw, window.location.origin)
  if (url.origin !== window.location.origin || !url.pathname.startsWith(`${API_BASE}/api/`)) {
    throw new Error('Unsupported account endpoint')
  }
  const headers = new Headers(init.headers)
  if (url.pathname.startsWith(`${API_BASE}/api/playground/`)) url.searchParams.set('workspace_id', bootstrap.workspaceId || 'personal')
  headers.set('Authorization', `Bearer ${consoleCapability()}`)
  const response = await window.fetch(url, { ...init, headers, credentials: 'omit', redirect: 'error' })
  if (response.status === 401) expireSession()
  return response
}

export function isConsoleRoute(path) {
  if (typeof path !== 'string' || path.length > 2048 || /[\\\r\n]/.test(path)) return false
  return /^(?:\/(?:personal\/(?:dashboard|token|log|balance-log)|profile(?:\/teams)?|team(?:\/[a-zA-Z0-9_-]+(?:\/(?:overview|tokens|playground|models|logs|usage|members|wallet|activity|settings))?)?|join\/[a-zA-Z0-9_-]+|topup(?:\/result)?|orders|balance-log|playground|models|notifications|subscription|my-subscription|token|log|dashboard|api-reference(?:\/[a-zA-Z0-9_-]+)?|terms|privacy|refund-policy|status|403)?)(?:[?#].*)?$/.test(path)
}

window.addEventListener('message', (event) => {
  if (event.source !== window.parent || window.parent === window) return
  const data = event.data
  if (!data || typeof data !== 'object') return
  if (!bootstrap) {
    if (data.type !== 'stx-console-init' || typeof data.capability !== 'string' || data.capability.length < 16) return
    let service
    try {
      const url = new URL(data.service)
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return
      service = url.origin
    } catch { return }
    parentOrigin = event.origin
    bootstrap = { capability: data.capability, service, user: data.user ?? null, theme: data.theme, resolvedTheme: data.resolvedTheme, tokens: data.tokens, reducedMotion: data.reducedMotion, locale: data.locale }
    if (['light', 'dark', 'system'].includes(data.theme)) localStorage.setItem('stallion-x-theme', data.theme)
    if (['en', 'zh-CN'].includes(data.locale)) localStorage.setItem('locale', data.locale)
    resolveReady(bootstrap)
    return
  }
  if (event.origin !== parentOrigin) return
  if (!['stx-console-navigate', 'stx-console-session', 'stx-console-refresh', 'stx-console-appearance'].includes(data.type)) return
  if (data.type === 'stx-console-appearance') Object.assign(bootstrap, { theme: data.theme, resolvedTheme: data.resolvedTheme, tokens: data.tokens, reducedMotion: data.reducedMotion, locale: data.locale })
  if (data.type === 'stx-console-session' && ['signed_out', 'expired'].includes(data.user?.state)) expireSession()
  listeners.forEach((listener) => listener(data))
})

// No capability, account data or URL is included in the pre-handshake message.
window.parent.postMessage({ type: 'stx-console-ready' }, '*')
