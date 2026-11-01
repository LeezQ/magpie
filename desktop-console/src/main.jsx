import { ready, runtime } from '@/desktop/bridge'
import { applyAppearance } from '@/desktop/appearance'

ready.then(() => {
  applyAppearance(runtime())
  return import('@/desktop/render')
})
