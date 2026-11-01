import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/contexts/WorkspaceContext'

export default function ModelPlaygroundHandoff() {
  const workspace = useWorkspace()
  const navigate = useNavigate()
  const { i18n } = useTranslation()
  const zh = i18n.language.startsWith('zh')
  return <div className="space-y-3 p-4 text-sm">
    <p>{zh ? '客户端对话测试使用当前空间的 API Key，无需手动填写密钥。音频、视频和文件请求暂请使用 Web 测试台。' : 'Chat testing uses a key from the current workspace without manual key setup. Use the Web playground for audio, video and file requests.'}</p>
    <Button onClick={() => navigate(workspace?.teamId ? `/team/${workspace.team.slug}/playground` : '/playground')}>{zh ? '打开当前空间的 Playground' : 'Open workspace Playground'}</Button>
  </div>
}
