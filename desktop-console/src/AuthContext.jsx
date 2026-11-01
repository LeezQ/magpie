import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { get } from '@/services/api'
import { queryKeys } from '@/services/queryKeys'
import { useBranding } from '@/contexts/BrandingContext'
import { isSessionActive, signOut, subscribeBridge, postParent } from '@/desktop/bridge'

const AuthContext = createContext(null)
const EMPTY_TEAMS = []

export function AuthProvider({ children }) {
  const queryClient = useQueryClient()
  const [active, setActive] = useState(isSessionActive)
  const { setBranding, clearBranding } = useBranding()
  const userQuery = useQuery({
    queryKey: queryKeys.auth.self,
    queryFn: async ({ signal }) => (await get('/api/user/self', undefined, { signal, silent: true })).data,
    enabled: active,
    staleTime: 30_000,
  })
  const teamsQuery = useQuery({
    queryKey: queryKeys.teams.mine,
    queryFn: async ({ signal }) => (await get('/api/team/mine', undefined, { signal, silent: true })).data,
    enabled: active && !!userQuery.data,
    staleTime: 30_000,
  })
  useEffect(() => subscribeBridge((message) => {
    if (message.type === 'stx-console-expired') {
      setActive(false)
      void queryClient.cancelQueries()
      queryClient.clear()
      clearBranding()
    } else if (message.type === 'stx-console-refresh' || message.type === 'stx-console-session') {
      void queryClient.invalidateQueries()
    }
  }), [queryClient, clearBranding])
  useEffect(() => {
    if (userQuery.data?.branding) setBranding(userQuery.data.branding)
  }, [userQuery.data, setBranding])
  const value = useMemo(() => ({
    user: active ? userQuery.data ?? null : null,
    // Existing page components use token only as a truthy query gate, not a JWT.
    token: active ? 'native-session' : null,
    loading: active && userQuery.isPending,
    error: userQuery.error,
    initialized: true,
    isAdmin: false,
    isRoot: false,
    isAgent: false,
    myTeams: active && Array.isArray(teamsQuery.data) ? teamsQuery.data : EMPTY_TEAMS,
    myTeamsLoading: active && teamsQuery.isPending,
    logout: signOut,
    refreshUser: () => queryClient.invalidateQueries({ queryKey: queryKeys.auth.self }),
    setUser: (user) => queryClient.setQueryData(queryKeys.auth.self, user),
    login: () => postParent('stx-console-auth-expired'),
    register: () => postParent('stx-console-auth-expired'),
  }), [active, userQuery.data, userQuery.isPending, userQuery.error, teamsQuery.data, teamsQuery.isPending, queryClient])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() { return useContext(AuthContext) }
