import { useLayoutEffect, useState } from 'react'
import { ThemeProvider as NextThemesProvider } from 'next-themes'
import { setLocale } from '@/i18n'
import { runtime, subscribeBridge } from '@/desktop/bridge'
import { applyAppearance } from '@/desktop/appearance'

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(runtime().resolvedTheme || 'light')
  useLayoutEffect(() => {
    setTheme(applyAppearance(runtime()))
    return subscribeBridge((message) => {
      if (message.type !== 'stx-console-appearance') return
      setTheme(applyAppearance(message))
      void setLocale(message.locale)
    })
  }, [])
  return <NextThemesProvider attribute="class" forcedTheme={theme} storageKey="stallion-x-theme" enableSystem={false} enableColorScheme scriptProps={{ type: 'application/json' }}>
    {children}
  </NextThemesProvider>
}
