/**
 * 个人工作台标志 —— 台架（Concept B）的内联版本。
 *
 * 源文件是 brand/final/mark-24.svg，这里把 256 网格上的路径预先缩放进
 * 24 × 24 的 viewBox（scale 0.09 + translate 0.48 / -0.06），所以组件里
 * 不再需要 transform，也不会多一次图片请求。填色跟随 currentColor：
 * 放在橙块里自然就是白标，放在正文里就是墨色。
 *
 * 尺寸约定：图形墨迹只占 viewBox 的 75%，橙块 28 px 用 h-5 w-5（墨迹 15 px），
 * 48 px 用 h-8 w-8（墨迹 24 px）。小于 16 px 请改用 brand/final/symbol-small.svg
 * 的专用小尺寸稿，别把这一版缩小硬用。
 */
const MARK_PATH =
  'M3.00 4.98 L21.00 4.98 L21.00 9.66 L3.00 9.66 Z ' +
  'M4.98 9.66 L9.30 9.66 L10.20 19.02 L5.88 19.02 Z ' +
  'M14.70 9.66 L19.02 9.66 L18.12 19.02 L13.80 19.02 Z'

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true" focusable="false">
      <path d={MARK_PATH} />
    </svg>
  )
}
