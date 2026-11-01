import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { BrandingProvider } from '@/contexts/BrandingContext'
import AppShell from '@/components/layout/AppShell'
import { openExternal, postParent } from '@/desktop/bridge'

const PersonalOverview = lazy(() => import('@/pages/Workspace/PersonalOverview'))
const Token = lazy(() => import('@/pages/Token'))
const Log = lazy(() => import('@/pages/Log'))
const Playground = lazy(() => import('@/pages/Playground'))
const Models = lazy(() => import('@/pages/Models').then((module) => ({ default: module.ModelsContent })))
const Profile = lazy(() => import('@/pages/Profile'))
const ProfileTeams = lazy(() => import('@/pages/Profile/ProfileTeams'))
const TopUp = lazy(() => import('@/pages/TopUp'))
const TopUpResult = lazy(() => import('@/pages/TopUp/Result'))
const Orders = lazy(() => import('@/pages/Order'))
const BalanceLog = lazy(() => import('@/pages/BalanceLog'))
const Team = lazy(() => import('@/pages/Team'))
const TeamDetail = lazy(() => import('@/pages/Team/TeamDetail'))
const JoinInvite = lazy(() => import('@/pages/Team/JoinInvite'))
const Notifications = lazy(() => import('@/pages/Notification'))
const Subscription = lazy(() => import('@/pages/Subscription'))
const MySubscription = lazy(() => import('@/pages/Subscription/MySubscription'))
const Forbidden = lazy(() => import('@/pages/Forbidden'))

function Loading() {
  return <div className="flex min-h-64 items-center justify-center" role="status"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
}

function AccountBoundary({ children }) {
  const { t } = useTranslation()
  const { user, token, loading, error, refreshUser } = useAuth()
  useEffect(() => { if (!token) postParent('stx-console-auth-expired') }, [token])
  if (loading || !token) return <Loading />
  if (!user) return <div className="flex min-h-64 flex-col items-center justify-center gap-3" role="alert"><p>{error?.message || t('messages.networkError')}</p><Button onClick={refreshUser}>{t('actions.retry')}</Button></div>
  return children
}

function ExternalPage() {
  const location = useLocation()
  const { t } = useTranslation('layout')
  return <div className="flex min-h-64 items-center justify-center"><Button onClick={() => openExternal(location.pathname + location.search)}>{t('nav.items.apiDocs.title')}</Button></div>
}

export default function App() {
  return <BrandingProvider><AuthProvider><TooltipProvider>
    <AccountBoundary><Suspense fallback={<Loading />}><Routes>
      <Route path="/" element={<AppShell />}>
        <Route index element={<Navigate to="/personal/dashboard" replace />} />
        <Route path="personal/dashboard" element={<PersonalOverview />} />
        <Route path="personal/token" element={<Token />} />
        <Route path="personal/log" element={<Log personal />} />
        <Route path="personal/balance-log" element={<BalanceLog />} />
        <Route path="playground" element={<Playground />} />
        <Route path="models" element={<Models />} />
        <Route path="profile" element={<Profile />} />
        <Route path="profile/teams" element={<ProfileTeams />} />
        <Route path="topup" element={<TopUp />} />
        <Route path="topup/result" element={<TopUpResult />} />
        <Route path="orders" element={<Orders />} />
        <Route path="balance-log" element={<BalanceLog />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="subscription" element={<Subscription />} />
        <Route path="my-subscription" element={<MySubscription />} />
        <Route path="team" element={<Team />} />
        <Route path="team/:slug" element={<TeamDetail />} />
        <Route path="team/:slug/:section" element={<TeamDetail />} />
        <Route path="join/:code" element={<JoinInvite />} />
        <Route path="403" element={<Forbidden />} />
        <Route path="api-reference/*" element={<ExternalPage />} />
        <Route path="dashboard" element={<Navigate to="/personal/dashboard" replace />} />
        <Route path="token" element={<Navigate to="/personal/token" replace />} />
        <Route path="log" element={<Navigate to="/personal/log" replace />} />
        <Route path="*" element={<Forbidden />} />
      </Route>
    </Routes></Suspense></AccountBoundary>
    <Toaster position="top-center" duration={1500} />
  </TooltipProvider></AuthProvider></BrandingProvider>
}
