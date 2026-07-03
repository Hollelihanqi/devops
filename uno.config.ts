import { defineConfig, presetUno, presetIcons, presetAttributify } from 'unocss'

// UnoCSS：布局/间距用原子类，组件内部样式走 antd token（见需求文档 §5.3 备注）
export default defineConfig({
  presets: [
    presetUno(),
    presetAttributify(),
    presetIcons({ scale: 1.2, warn: true }),
  ],
  theme: {
    colors: {
      // 与 antd ConfigProvider theme.token 保持同一组色值
      primary: '#1677ff',
      success: '#52c41a',
      warning: '#faad14',
      error: '#ff4d4f',
    },
  },
  shortcuts: {
    'flex-center': 'flex items-center justify-center',
    'flex-between': 'flex items-center justify-between',
  },
})
