import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Markdown } from '../../ui/components/Markdown';

describe('Markdown', () => {
  it('渲染标题/加粗/行内代码/链接', () => {
    render(<Markdown text={'# 标题\n正文 **加粗** 和 `code`\n[链接](https://a.com)'} />);
    expect(screen.getByText('标题')).toBeInTheDocument();
    expect(screen.getByText('加粗')).toBeInTheDocument();
    expect(screen.getByText('code')).toBeInTheDocument();
    const link = screen.getByText('链接');
    expect((link.closest('a') as HTMLAnchorElement)?.getAttribute('href')).toBe('https://a.com');
  });

  it('非白名单协议（javascript:）降级为纯文本，不渲染 <a>', () => {
    render(<Markdown text={'[x](javascript:alert(1))'} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('渲染列表与 GFM 表格', () => {
    render(<Markdown text={'| a | b |\n|---|---|\n| 1 | 2 |\n\n- 项1\n- 项2'} />);
    expect(screen.getByText('项1')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});
