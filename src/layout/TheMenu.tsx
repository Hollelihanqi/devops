import { Menu, type MenuProps } from 'antd'
import type { LayoutMenuItem } from './useLayout'

interface TheMenuProps {
  items: LayoutMenuItem[]
  selectedKey: string
  onSelect: (key: string) => void
}

/** 左侧导航菜单（对标 Vue 的 TheMenu.vue）：antd inline 菜单，选中态由上层计算。 */
export default function TheMenu({ items, selectedKey, onSelect }: TheMenuProps) {
  return (
    <Menu
      mode="inline"
      selectedKeys={[selectedKey]}
      items={items as MenuProps['items']}
      onClick={({ key }) => onSelect(key)}
    />
  )
}
