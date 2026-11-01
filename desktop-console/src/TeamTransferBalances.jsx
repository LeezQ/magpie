import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency } from '@/lib/utils'
import { TEAM_STATUS_DISBANDED } from '@/pages/Team/teamConstants'

function balanceValue(value) {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export default function TeamTransferBalances({ team }) {
  const { t } = useTranslation('profile')
  const { user, error } = useAuth()
  const personal = error ? null : balanceValue(user?.balance)
  const wallet = balanceValue(team.balance)
  let incoming = personal === null ? null : Math.max(0, personal)
  const outgoing = wallet === null ? null : Math.max(0, wallet)
  // Archived wallets may only receive enough funds to repay their remaining debt.
  if (team.status === TEAM_STATUS_DISBANDED) {
    incoming = incoming === null || wallet === null ? null : Math.min(incoming, Math.max(0, -wallet))
  }
  const display = (amount) => amount === null ? t('teams.transfer.unavailable') : formatCurrency(amount)

  return (
    <dl className="grid min-w-0 grid-cols-1 gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
      {[
        ['availableIn', incoming],
        ['availableOut', outgoing],
      ].map(([key, amount]) => (
        <div key={key} className="min-w-0 space-y-1">
          <dt className="text-sm text-muted-foreground">{t(`teams.transfer.${key}`)}</dt>
          <dd className="break-words font-mono font-medium text-foreground">{display(amount)}</dd>
        </div>
      ))}
    </dl>
  )
}
