import { useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { SidebarProvider } from '@/components/ui/sidebar'
import Header from '@/components/layout/Header'
import NoticeBanner from '@/components/layout/NoticeBanner'
import { WorkspaceProvider, useWorkspace } from '@/contexts/WorkspaceContext'
import { getCommonNavigation, getTeamNavigation } from '@/lib/workspaceNavigation'
import { isConsoleRoute, openExternal, postParent, subscribeBridge, runtime } from '@/desktop/bridge'
import { visibleNavigation } from '@/desktop/navigation'

function ConsoleContent() {
  const location = useLocation()
  const navigate = useNavigate()
  const workspace = useWorkspace()
  runtime().workspaceId = workspace.teamId || 'personal'
  const { t } = useTranslation('layout')
  useEffect(() => subscribeBridge((message) => {
    if (message.type === 'stx-console-navigate' && isConsoleRoute(message.path)) navigate(message.path)
  }), [navigate])

  useEffect(() => {
    const groups = workspace.teamId ? getTeamNavigation(workspace, { t }) : [getCommonNavigation(workspace, { t })]
    const items = groups.flatMap((group) => group.items.filter((item) => !item.external && visibleNavigation(item)).map((item) => ({ path: item.url, title: item.title, group: group.title, icon: item.key })))
    const group = t('nav.groups.subscription.title')
    for (const [key, path] of (workspace.teamId ? [] : [['topup', '/topup'], ['orders', '/orders'], ['balanceLog', '/personal/balance-log'], ['subscription', '/subscription'], ['mySubscription', '/my-subscription']])) {
      if (!visibleNavigation({ key })) continue
      items.push({ path, title: t(`nav.items.${key}.title`), group, icon: key })
    }
    items.push({ path: '/profile', title: t('header.userMenu.profile'), group: t('common:workspace.personal'), icon: 'user' })
    items.push({ path: '/profile/teams', title: t('workspaceSwitcher.manage'), group: t('common:workspace.personal'), icon: 'users' })
    postParent('stx-console-navigation', {
      route: location.pathname + location.search + location.hash,
      items,
      workspace: { id: workspace.team?.id || 'personal', slug: workspace.team?.slug || '', name: workspace.name },
    })
  }, [location.pathname, location.search, location.hash, workspace, t])

  useEffect(() => {
    const handleLink = (event) => {
      const link = event.target.closest?.('a[href]')
      if (!link || link.download || link.href.startsWith('blob:')) return
      const url = new URL(link.href, window.location.href)
      if (url.origin !== window.location.origin || link.target === '_blank') {
        event.preventDefault()
        event.stopPropagation()
        openExternal(url.origin === window.location.origin ? (url.hash.startsWith('#/') ? url.hash.slice(1) : url.pathname + url.search) : url.href)
      }
    }
    document.addEventListener('click', handleLink, true)
    return () => document.removeEventListener('click', handleLink, true)
  }, [])

  // A new authorized workspace gets fresh form state, never another team's draft.
  const workspaceKey = workspace.team?.id || workspace.teamReference || 'personal'
  return <div className="flex min-h-svh w-full min-w-0 flex-col bg-background">
    <Header />
    <NoticeBanner />
    <main id="main-content" tabIndex={-1} className="desktop-console-main flex-1 overflow-auto bg-background p-3 outline-none sm:p-4 md:p-6 xl:p-8">
      <Outlet key={workspaceKey} />
    </main>
  </div>
}

export default function AppShell() {
  return <WorkspaceProvider><SidebarProvider className="bg-background"><ConsoleContent /></SidebarProvider></WorkspaceProvider>
}
