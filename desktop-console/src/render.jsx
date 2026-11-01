import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import '@/index.css'
import '@/i18n'
import '@/desktop/console.css'
import App from '@/App'
import { ThemeProvider } from '@/components/theme-provider'
import { queryClient } from '@/services/queryClient'

dayjs.extend(relativeTime)
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <HashRouter><App /></HashRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
