import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'

export default function KeyDetails({ token, onClose }) {
  const { t } = useTranslation('token')
  const entries = token ? [
    [t('table.key'), token.key],
    [t('common:labels.status'), t(token.status === 1 ? 'common:status.enabled' : 'common:status.disabled')],
    [t('table.quota'), token.quota], [t('table.usedAmount'), token.used_amount],
    [t('table.models'), token.models?.join(', ') || '-'],
    [t('table.allowedIps'), token.allowed_ips?.join(', ') || '-'],
    [t('common:labels.createdAt'), token.created_at], [t('table.lastUsedAt'), token.last_used_at || '-'],
    [t('table.expiresAt'), token.expires_at || '-'],
  ] : []
  return <Dialog open={!!token} onOpenChange={(open) => { if (!open) onClose() }}>
    <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>{token?.name}</DialogTitle><DialogDescription>{token?.id}</DialogDescription></DialogHeader>
      <dl className="grid grid-cols-[minmax(100px,1fr)_minmax(0,2fr)] gap-x-4 gap-y-3 text-sm">
        {entries.map(([label,value]) => <div key={label} className="contents"><dt className="text-muted-foreground">{label}</dt><dd className="break-words font-mono">{value ?? '-'}</dd></div>)}
      </dl>
    </DialogContent>
  </Dialog>
}
