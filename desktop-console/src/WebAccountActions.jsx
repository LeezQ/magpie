import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { openExternal } from '@/desktop/bridge'

export default function WebAccountActions() {
  const { i18n } = useTranslation()
  const zh = i18n.language.startsWith('zh')
  return <Card><CardContent className="space-y-3 pt-6">
    <p className="text-sm text-muted-foreground">{zh ? '第三方账号绑定、个人数据导出和账号注销请在 Web 用户中心完成。客户端与 Web 使用同一账号。' : 'Use the Web account center for linked accounts, data export and account deletion. The desktop and Web use the same account.'}</p>
    <Button variant="outline" onClick={() => openExternal('/profile')}>{zh ? '在浏览器打开用户中心' : 'Open Web account center'}</Button>
  </CardContent></Card>
}
