import { createRef } from 'react'
import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownEditor, type MarkdownEditorHandle } from './MarkdownEditor'

describe('MarkdownEditor', () => {
  it('渲染初始 Markdown 内容', () => {
    const { container } = render(<MarkdownEditor value="## 驳回原因" onChange={() => {}} />)
    expect(container.querySelector('.cm-content')?.textContent).toContain('## 驳回原因')
  })

  it('insertMarkdown 把片段写进正文并触发 onChange', () => {
    const ref = createRef<MarkdownEditorHandle>()
    const onChange = vi.fn()
    render(<MarkdownEditor ref={ref} value="" onChange={onChange} />)

    act(() => {
      ref.current?.insertMarkdown('![截图](/api/attachments/abc/raw)')
    })

    expect(onChange).toHaveBeenCalled()
    expect(onChange.mock.calls.at(-1)?.[0]).toContain('![截图](/api/attachments/abc/raw)')
  })
})
