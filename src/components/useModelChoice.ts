import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { promptsApi } from '@/api/prompts'
import { useAuthStore } from '@/stores/auth'

/**
 * 大模型选择：拉取可选模型列表，并把用户选择按「功能 + 用户」维度持久化到 localStorage。
 * 两处入口（提示词提炼 scope='refine'、项目问答 scope='project-chat'）各记各的、互不影响。
 *
 * - 列表用 react-query 缓存（全局共用一份 'ai-models'）；
 * - 选择无效（首次进入 / 后端下线了某模型）时自动落到列表第一个。
 */
export function useModelChoice(scope: string) {
  const userId = useAuthStore((s) => s.user?.id) ?? 0
  const storageKey = `ai-model:${scope}:${userId}`

  const { data: models } = useQuery({
    queryKey: ['ai-models'],
    queryFn: promptsApi.aiModels,
    staleTime: Infinity,
  })

  const [model, setModelState] = useState<string | undefined>(
    () => localStorage.getItem(storageKey) ?? undefined,
  )

  // 列表到达后校正：本地无选择 / 选择已不在列表中，则回退到第一个
  useEffect(() => {
    if (!models?.length) return
    setModelState((cur) => (cur && models.some((m) => m.id === cur) ? cur : models[0].id))
  }, [models])

  const setModel = (id: string) => {
    setModelState(id)
    localStorage.setItem(storageKey, id)
  }

  return { models: models ?? [], model, setModel }
}
