import axios from 'axios'
import { toast } from 'sonner'
import i18n from '@/i18n'
import { translateServerMessage } from '@/i18n/server'
import { API_BASE, consoleCapability, consoleFetch, consoleURL, expireSession, runtime } from '@/desktop/bridge'

const API_BASE_URL = API_BASE
const fetch = consoleFetch
const instance = axios.create({ baseURL: API_BASE_URL, timeout: 30000, withCredentials: false, headers: { 'Content-Type': 'application/json' } })
instance.interceptors.request.use((config) => {
  consoleURL(config.url)
  config.baseURL = API_BASE_URL
  config.withCredentials = false
  config.headers.Authorization = `Bearer ${consoleCapability()}`
  if (config.url.startsWith('/api/playground/')) config.params = { ...config.params, workspace_id: runtime().workspaceId || 'personal' }
  return config
})
instance.interceptors.response.use((response) => {
  const body = response.data
  if (body?.success === false) {
    const message = translateServerMessage(body.message) || i18n.t('common:messages.requestFailed')
    const error = new Error(message)
    error.response = response
    if (!response.config?.metadata?.silent) toast.error(message)
    return Promise.reject(error)
  }
  return body
}, (error) => {
  if (axios.isCancel(error)) return Promise.reject(error)
  if (error.response?.status === 401) expireSession()
  const message = translateServerMessage(error.response?.data?.message)
    || i18n.t(error.response ? 'common:messages.requestFailed' : 'common:messages.networkError')
  error.message = message
  if (!error.config?.metadata?.silent) toast.error(message)
  return Promise.reject(error)
})
