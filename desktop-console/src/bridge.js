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

// Copying. Inside the app's window WKWebView refuses (or leaves undefined) the
// page's own navigator.clipboard, which is why magpie's native pages copy
// through POST /api/copy first (app.js copy()). The Web pages here call
// navigator.clipboard.writeText directly, in 16 places: an API key, a request
// ID, an invitation code, a model name. The key copy is the worst case, as it
// awaits the full key from the BFF first, and WebKit drops the click's
// permission to write the clipboard across that wait. So writeText is replaced
// once, here, rather than patching each page: the text goes to the native
// parent over the bridge, which writes the system clipboard the way magpie's
// own pages do and answers whether it worked. Each page keeps its own success
// and failure toasts, since the replacement resolves or rejects like the real
// writeText.
const COPY_LIMIT = 64 << 10 // the parent refuses more; no console value is near it
const COPY_TIMEOUT = 10000 // a parent that never answers fails the copy, never hangs it
const pendingCopies = new Map() // copy id -> settle(ok), until the parent answers
let copySerial = 0
// The browser's own writeText, for a frame not (yet) joined to a native parent,
// e.g. the bundle opened on its own while developing.
const browserWriteText = navigator.clipboard?.writeText?.bind(navigator.clipboard)

function bridgeWriteText(text) {
  if (!parentOrigin) {
    return browserWriteText ? browserWriteText(text) : Promise.reject(new DOMException('Clipboard unavailable', 'NotAllowedError'))
  }
  const value = String(text)
  if (value.length > COPY_LIMIT) return Promise.reject(new DOMException('Text too long to copy', 'DataError'))
  const id = ++copySerial
  return new Promise((resolve, reject) => {
    const settle = (ok) => {
      clearTimeout(timer)
      pendingCopies.delete(id)
      if (ok) resolve()
      else reject(new DOMException('The desktop app could not copy this text', 'NotAllowedError'))
    }
    const timer = setTimeout(() => settle(false), COPY_TIMEOUT)
    pendingCopies.set(id, settle)
    postParent('stx-console-copy', { id, text: value })
  })
}

// Install the replacement. Clipboard.writeText is an ordinary prototype method,
// so an own property on the instance shadows it; a frame that isn't a secure
// context has no navigator.clipboard at all, and gets one with writeText only.
try {
  if (navigator.clipboard) navigator.clipboard.writeText = bridgeWriteText
  else Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: bridgeWriteText } })
} catch (error) {
  // Copies then fail with the page's own "copy failed" toast, as before.
  console.error('[desktop bridge] could not route copies to the desktop app:', error)
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
  // The parent's answer to a bridgeWriteText copy: settle that copy's promise.
  // An unknown or already-settled id (a late answer after the timeout) is ignored.
  if (data.type === 'stx-console-copied') {
    pendingCopies.get(data.id)?.(data.ok === true)
    return
  }
  if (!['stx-console-navigate', 'stx-console-session', 'stx-console-refresh', 'stx-console-appearance'].includes(data.type)) return
  if (data.type === 'stx-console-appearance') Object.assign(bootstrap, { theme: data.theme, resolvedTheme: data.resolvedTheme, tokens: data.tokens, reducedMotion: data.reducedMotion, locale: data.locale })
  if (data.type === 'stx-console-session' && ['signed_out', 'expired'].includes(data.user?.state)) expireSession()
  listeners.forEach((listener) => listener(data))
})

// No capability, account data or URL is included in the pre-handshake message.
window.parent.postMessage({ type: 'stx-console-ready' }, '*')
