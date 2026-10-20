import * as React from 'react'

/**
 * 统一的 Esc 关闭。
 *
 * 采用「栈」结构：后打开的浮层先响应。
 * 这样弹窗里再开下拉/日期面板时，按 Esc 只关最上层，
 * 而不是把整个弹窗一起关掉。
 */
const stack: Array<{ id: symbol; close: () => void }> = []

if (typeof document !== 'undefined') {
  document.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || stack.length === 0) return
      const top = stack[stack.length - 1]
      e.preventDefault()
      e.stopPropagation()
      top.close()
    },
    true, // 捕获阶段，抢在 React 的冒泡处理器之前
  )
}

/**
 * @param active 是否处于打开状态
 * @param onClose 关闭回调
 * @param enabled 传 false 可临时禁用（如提交中）
 */
export function useEscClose(active: boolean, onClose: () => void, enabled = true) {
  const closeRef = React.useRef(onClose)
  closeRef.current = onClose

  React.useEffect(() => {
    if (!active || !enabled) return
    const id = Symbol('esc')
    stack.push({ id, close: () => closeRef.current() })
    return () => {
      const i = stack.findIndex((s) => s.id === id)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [active, enabled])
}
