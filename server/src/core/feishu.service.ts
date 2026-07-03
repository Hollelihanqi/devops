import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'
import type { Deployment } from '../common/types'

/**
 * 默认飞书群机器人 webhook（.env 未配置 FEISHU_WEBHOOK 时使用）。
 * 想换群/换机器人，在 server/.env 里设 FEISHU_WEBHOOK 覆盖即可。
 */
const DEFAULT_FEISHU_WEBHOOK =
  'https://open.feishu.cn/open-apis/bot/v2/hook/b37057a7-b677-4096-a191-35138042e7cc'

/** 秒数 → "X min Y sec" / "Y sec"，给卡片「运行时长」用 */
function fmtDuration(sec?: number): string {
  if (!sec || sec < 0) return '-'
  if (sec < 60) return `${Math.round(sec)} sec`
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return s ? `${m} min ${s} sec` : `${m} min`
}

/**
 * 飞书群机器人通知：部署进入终态（success/failed/canceled）时发一张交互卡片。
 * 卡片「查看构建详情」按钮跳转到本次部署对应的 GitLab pipeline 详情页：
 *   `${projectWebUrl}/-/pipelines/${gitlabPipelineId}`
 * webhook 走环境变量 FEISHU_WEBHOOK，未配置时用内置默认群机器人地址；发送失败只记日志，不影响部署主流程。
 */
@Injectable()
export class FeishuService {
  private readonly logger = new Logger(FeishuService.name)

  constructor(private readonly config: ConfigService) {}

  async notifyDeployment(dep: Deployment): Promise<void> {
    const webhook = this.config.get<string>('FEISHU_WEBHOOK') || DEFAULT_FEISHU_WEBHOOK

    const ok = dep.status === 'success'
    const pipelineUrl =
      dep.projectWebUrl && dep.gitlabPipelineId
        ? `${dep.projectWebUrl}/-/pipelines/${dep.gitlabPipelineId}`
        : undefined

    // 2×2 网格单元格：标签（灰色 note）在上、值在下
    const cell = (label: string, value: string) => ({
      tag: 'column',
      width: 'weighted',
      weight: 1,
      vertical_align: 'top' as const,
      elements: [
        { tag: 'note', elements: [{ tag: 'plain_text', content: label }] },
        { tag: 'div', text: { tag: 'lark_md', content: value } },
      ],
    })

    const payload = {
      msg_type: 'interactive',
      card: {
        config: { wide_screen_mode: true },
        header: {
          title: { tag: 'plain_text', content: `${dep.projectName} 部署${ok ? '成功' : '失败'}` },
          template: ok ? 'green' : 'red',
        },
        elements: [
          {
            tag: 'column_set',
            flex_mode: 'none',
            background_style: 'default',
            columns: [
              cell('📋 构建状态', ok ? '✅ SUCCESS' : `❌ ${dep.status.toUpperCase()}`),
              cell('⏱️ 运行时长', fmtDuration(dep.durationSec)),
            ],
          },
          { tag: 'hr' },
          {
            tag: 'column_set',
            flex_mode: 'none',
            background_style: 'default',
            columns: [
              cell('📁 项目名称', dep.projectName),
              cell('🔢 构建编号', `#${dep.gitlabPipelineId ?? '-'}`),
            ],
          },
          ...(pipelineUrl
            ? [
                {
                  tag: 'action',
                  actions: [
                    {
                      tag: 'button',
                      text: { tag: 'plain_text', content: '查看构建详情' },
                      type: 'primary',
                      url: pipelineUrl,
                    },
                  ],
                },
              ]
            : []),
        ],
      },
    }

    try {
      await axios.post(webhook, payload, { timeout: 10_000 })
    } catch (e: any) {
      // 通知失败不影响部署主流程，仅记录日志
      this.logger.warn(`飞书通知发送失败：${e?.message}`)
    }
  }
}
