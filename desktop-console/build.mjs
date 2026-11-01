import { cp, mkdtemp, mkdir, readFile, writeFile, symlink, rm, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Copy, never patch, the sibling Web checkout. Each seam must match exactly so
// an upstream refactor fails the build rather than quietly bypassing the bridge.
const root = resolve(import.meta.dirname, '..')
const web = resolve(process.env.STALLIONX_WEB_SOURCE || join(root, '../main/web'))
const require = createRequire(join(web, 'package.json'))
const load = async (name) => import(pathToFileURL(require.resolve(name)).href)
const { build } = await load('vite')
const { default: react } = await load('@vitejs/plugin-react')
const { default: tailwind } = await load('@tailwindcss/vite')
const stage = await mkdtemp(join(tmpdir(), 'stallionx-console-'))
const hashes = {}
const sha = (value) => createHash('sha256').update(value).digest('hex')
async function treeHash(directory) {
  const digest = createHash('sha256')
  async function visit(dir, prefix = '') {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries.sort((a,b) => a.name.localeCompare(b.name, 'en'))) {
      const name = prefix + entry.name
      if (entry.isDirectory()) await visit(join(dir, entry.name), name + '/')
      else if (entry.isFile()) digest.update(name + '\0').update(await readFile(join(dir,entry.name)))
    }
  }
  await visit(directory)
  return digest.digest('hex')
}
async function patch(file, from, to) {
  const path = join(stage, 'src', file)
  const value = await readFile(path, 'utf8')
  if (!value.includes(from) || value.indexOf(from) !== value.lastIndexOf(from)) throw new Error(`Web source seam changed: ${file}: ${from.slice(0, 70)}`)
  hashes[file] ??= sha(value)
  await writeFile(path, value.replace(from, to))
}
try {
  await cp(join(web, 'src'), join(stage, 'src'), { recursive: true })
  await cp(join(web, 'public'), join(stage, 'public'), { recursive: true })
  await cp(join(web, 'package.json'), join(stage, 'package.json'))
  await symlink(join(web, 'node_modules'), join(stage, 'node_modules'), 'dir')
  await mkdir(join(stage, 'src/desktop'))
  await cp(join(import.meta.dirname, 'src'), join(stage, 'src/desktop'), { recursive: true })
  for (const [from, to] of [['App.jsx', 'App.jsx'], ['AppShell.jsx', 'components/layout/AppShell.jsx'], ['AuthContext.jsx', 'contexts/AuthContext.jsx']]) {
    hashes[to] = sha(await readFile(join(stage, 'src', to)))
    await cp(join(import.meta.dirname, 'src', from), join(stage, 'src', to))
  }
  const api = await readFile(join(web, 'src/services/api.js'), 'utf8')
  const seam = 'function splitOptions(options = {}) {'
  if (api.split(seam).length !== 2) throw new Error('Web API adapter seam changed')
  hashes['services/api.js'] = sha(api)
  let adapted = await readFile(join(import.meta.dirname, 'src/api-prefix.js'), 'utf8') + '\n' + api.slice(api.indexOf(seam))
  adapted = adapted.replace("const playgroundApiBase = import.meta.env.VITE_API_BASE_URL || ''", 'const playgroundApiBase = API_BASE')
    .replace("const token = localStorage.getItem('token')", 'const token = consoleCapability()')
  await writeFile(join(stage, 'src/services/api.js'), adapted)
  await patch('components/layout/Header.jsx', "import { THEME_OPTIONS } from '@/lib/theme'", "import { THEME_OPTIONS } from '@/lib/theme'\nimport { visibleNavigation } from '@/desktop/navigation'")
  await patch('components/layout/Header.jsx', '      items: group.items.filter((item) => {', '      items: group.items.filter((item) => {\n        if (!visibleNavigation(item)) return false')
  // Appearance belongs to native Settings; do not offer a second, divergent toggle.
  await patch('components/layout/Header.jsx', "const { theme = 'light', setTheme } = useTheme()", "const { theme = 'light', setTheme, forcedTheme } = useTheme()")
  await patch('components/layout/Header.jsx', "              <DropdownMenuRadioGroup\n                aria-label={t('header.userMenu.appearance')}", "              {!forcedTheme && <DropdownMenuRadioGroup\n                aria-label={t('header.userMenu.appearance')}")
  await patch('components/layout/Header.jsx', '              </DropdownMenuRadioGroup>\n            </div>\n            {/*', '              </DropdownMenuRadioGroup>}\n            </div>\n            {/*')
  await patch('components/ui/button.jsx', '      data-slot="button"', '      data-slot="button"\n      data-variant={variant}\n      data-size={size}')
  await patch('components/common/PageHeader.jsx', '    <header\n', '    <header data-desktop-page-header\n')
  await patch('pages/Token/TokenList.jsx', "import TokenTable from '@/pages/Token/TokenTable'", "import TokenTable from '@/pages/Token/TokenTable'\nimport { get } from '@/services/api'")
  await patch('pages/Token/TokenList.jsx', '<TokenTable tokens={tokens} loading={false} {...tableProps} />', '<TokenTable tokens={tokens} loading={false} resolveKey={async (token) => (await get(token.team_id ? `/api/team/${token.team_id}/tokens/${token.id}` : `/api/token/${token.id}`)).data.key} {...tableProps} />')
  await patch('pages/Token/TokenTable.jsx', "await put('/api/token/', { id, status })", "const key = tokens.find((key) => key.id === id)\n      await put(key?.team_id ? `/api/team/${key.team_id}/tokens/${id}` : '/api/token/', { id, status })")
  await patch('pages/Token/TokenTable.jsx', 'await del(`/api/token/${id}`)', 'const key = tokens.find((key) => key.id === id)\n      await del(key?.team_id ? `/api/team/${key.team_id}/tokens/${id}` : `/api/token/${id}`)')
  await patch('pages/Token/TokenTable.jsx', '    ...getTokenPermissions?.(token),', '    ...getTokenPermissions?.(token),\n    ...(token.desktop_managed ? { edit: false, manage: false } : {}),')
  await patch('pages/Token/TokenTable.jsx', "import TokenSourcesDialog from '@/pages/Token/TokenSourcesDialog'", "import TokenSourcesDialog from '@/pages/Token/TokenSourcesDialog'\nimport KeyDetails from '@/desktop/KeyDetails'")
  await patch('pages/Token/TokenTable.jsx', "  const { t } = useTranslation('token')", "  const { t } = useTranslation('token')\n  const [detailToken, setDetailToken] = useState(null)")
  await patch('pages/Token/TokenTable.jsx', '<TableCell className="font-medium">{token.name}</TableCell>', '<TableCell className="font-medium"><button type="button" className="text-left hover:underline" onClick={(event) => { event.stopPropagation(); setDetailToken(token) }}>{token.name}</button></TableCell>')
  await patch('pages/Token/TokenTable.jsx', '      <Dialog\n        open={modelsDialogOpen}', '      <KeyDetails token={detailToken} onClose={() => setDetailToken(null)} />\n      <Dialog\n        open={modelsDialogOpen}')
  await patch('pages/Token/TokenSourcesDialog.jsx', 'get(`/api/token/${tokenId}/sources`', 'get(token.team_id ? `/api/team/${token.team_id}/tokens/${tokenId}/sources` : `/api/token/${tokenId}/sources`')
  await patch('pages/Team/TeamAddMemberDialog.jsx', "post('/api/user/verification', payload)", 'post(`/api/team/${teamId}/members/verification`, payload)')
  for (const page of ['pages/Profile/ProfileTeams.jsx', 'pages/Team/TeamSettingsTab.jsx']) {
    await patch(page, "import { formatCurrency } from '@/lib/utils'", "import { formatCurrency } from '@/lib/utils'\nimport TeamTransferBalances from '@/desktop/TeamTransferBalances'")
  }
  await patch('pages/Profile/ProfileTeams.jsx', `<p className="text-sm text-muted-foreground">
            {/* 金额需要单独的等宽强调样式，用 Trans 承载而不把标记写进语言包 */}
            <Trans
              t={t}
              i18nKey="teams.transfer.currentBalance"
              values={{ amount: formatCurrency(team.balance) }}
              components={{ amount: <span className="font-mono font-medium text-foreground" /> }}
            />
          </p>`, '<TeamTransferBalances team={team} />')
  await patch('pages/Profile/ProfileTeams.jsx', "import { Trans, useTranslation } from 'react-i18next'", "import { useTranslation } from 'react-i18next'")
  await patch('pages/Profile/ProfileTeams.jsx', '<div className="flex gap-2">', '<div className="flex flex-col gap-2 sm:flex-row">')
  await patch('pages/Team/TeamSettingsTab.jsx', `<p className="text-sm text-muted-foreground">
              {t('settings.transfer.dialog.currentBalance', { amount: formatCurrency(team.balance) })}
            </p>`, '<TeamTransferBalances team={team} />')
  for (const [locale, labels] of Object.entries({
    en: { availableIn: 'Available to transfer in (personal balance)', availableOut: 'Available to transfer out (team balance)', unavailable: 'Unavailable' },
    'zh-CN': { availableIn: '可划入（个人余额）', availableOut: '可划出（团队余额）', unavailable: '暂不可用' },
  })) {
    const file = `i18n/locales/${locale}/profile.json`
    const value = JSON.parse(await readFile(join(stage, 'src', file), 'utf8'))
    const anchor = `"currentBalance": ${JSON.stringify(value.teams.transfer.currentBalance)},`
    await patch(file, anchor, anchor + '\n' + Object.entries(labels).map(([key, label]) => `      "${key}": ${JSON.stringify(label)},`).join('\n'))
  }
  await patch('pages/Models/ModelDetailDrawer.jsx', "import PlaygroundPanel from '@/components/playground/PlaygroundPanel'", "import PlaygroundPanel from '@/desktop/ModelPlaygroundHandoff'")
  // Preserve Web's inline disclosure, with a keyboard-operable expand control.
  await patch('pages/Log/LogTable.jsx', '<TableCell className="w-8 px-2">', '<TableCell className="w-8 px-2"><button type="button" className="flex size-7 items-center justify-center rounded hover:bg-muted" aria-label={t("billing.process") + ": " + log.request_id} aria-expanded={isExpanded} aria-controls={isExpanded ? `log-detail-${log.id}` : undefined} onClick={(event) => { event.stopPropagation(); toggleExpand(log.id) }}>')
  await patch('pages/Log/LogTable.jsx', '            </TableCell>\n\n            {/* 时间 */}', '            </button></TableCell>\n\n            {/* 时间 */}')
  await patch('pages/Log/LogTable.jsx', '          {isExpanded && (\n            <TableRow>', '          {isExpanded && (\n            <TableRow id={`log-detail-${log.id}`} data-stx-log-detail>')
  await patch('pages/Log/LogFilters.jsx', '      {/* 搜索按钮 */}', '      <div className="desktop-filter-actions flex items-center gap-2">\n      {/* 搜索按钮 */}')
  await patch('pages/Log/LogFilters.jsx', "        {t('filters.reset')}\n      </Button>", "        {t('filters.reset')}\n      </Button>\n      </div>")
  await patch('pages/TopUp/index.jsx', 'window.location.assign(data.checkout_url)', 'openExternal(data.checkout_url)')
  const topup = join(stage, 'src/pages/TopUp/index.jsx')
  await writeFile(topup, "import { openExternal } from '@/desktop/bridge'\n" + await readFile(topup, 'utf8'))
  await patch('pages/TopUp/index.jsx', 'createOrderMutation.isPending || createOrderMutation.isSuccess', 'createOrderMutation.isPending')
  // These need browser callback/download/deletion contracts, not an unsafe
  // top-level navigation out of a session-bound frame. Keep an explicit handoff.
  await patch('pages/Profile/index.jsx', '            <LinkedAccounts />\n            <DataExport />\n            <DangerZone />', '            <WebAccountActions />')
  await patch('pages/ApiReference/contexts/ApiConfigContext.jsx', 'useState(window.location.origin)', 'useState(publicOrigin())')
  const config = join(stage, 'src/pages/ApiReference/contexts/ApiConfigContext.jsx')
  await writeFile(config, "import { publicOrigin } from '@/desktop/bridge'\n" + await readFile(config, 'utf8'))
  // next-themes injects an inline boot script; our CSP deliberately forbids it.
  await cp(join(import.meta.dirname, 'src/ThemeProvider.jsx'), join(stage, 'src/components/theme-provider.jsx'))
  const profile = join(stage, 'src/pages/Profile/index.jsx')
  await writeFile(profile, "import WebAccountActions from '@/desktop/WebAccountActions'\n" + await readFile(profile, 'utf8'))
  await writeFile(join(stage, 'index.html'), '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>StallionX</title></head><body><div id="root"></div><script type="module" src="/src/desktop/main.jsx"></script></body></html>')
  await build({ root: stage, configFile: false, envDir: false, plugins: [react(), tailwind()], resolve: { alias: { '@': join(stage, 'src') } }, build: { target: 'es2022', outDir: join(root, 'internal/gui/assets/stallionx-console'), emptyOutDir: true, sourcemap: false } })
  await writeFile(join(root, 'desktop-console/source-manifest.json'), JSON.stringify({ source: '../main/web', sourceTree: await treeHash(join(web, 'src')), publicTree: await treeHash(join(web, 'public')), package: sha(await readFile(join(web, 'package.json'))), lock: sha(await readFile(join(web, 'package-lock.json'))), seams: hashes }, null, 2) + '\n')
} finally {
  await rm(stage, { recursive: true, force: true })
}
