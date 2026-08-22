/**
 * 轻量 Markdown 渲染（无第三方依赖）。
 * 支持：标题 (#/##/###)、无序/有序列表（含 ≤4 空格缩进，渲染为平级项）、
 * - 行内加粗 **x**、斜体 *x*、`行内代码`、引用块 >、分隔线 ---、
 * [文字](url) 链接（仅 https/mailto/zotero 协议，其余降级为纯文本），以及 GFM 表格（| 列 | 列 | 分隔行 |...）。
 * 其余按纯文本换行。
 * 用于文献分析报告、审查报告与评估报告的可读展示。
 */
import { ReactNode } from 'react';

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // 先按代码块拆分，避免代码内字符被加粗/链接规则误处理
  const parts = text.split(/(`[^`]+`)/g);
  parts.forEach((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      nodes.push(<code key={`c${i}`} className="mrc-md-code">{part.slice(1, -1)}</code>);
      return;
    }
    // 加粗（**x**）> 斜体（*x*）> 链接，顺序保证 ** 优先于 *
    const segments = part.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|\[[^\]]+\]\([^)]+\))/g);
    segments.forEach((seg, j) => {
      if (!seg) return;
      if (seg.startsWith('**') && seg.endsWith('**')) {
        nodes.push(<strong key={`b${i}-${j}`}>{seg.slice(2, -2)}</strong>);
      } else if (seg.startsWith('*') && seg.endsWith('*') && seg.length >= 3) {
        nodes.push(<em key={`i${i}-${j}`}>{seg.slice(1, -1)}</em>);
      } else if (seg.startsWith('[') && seg.includes('](')) {
        const m = seg.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (m) {
          const href = m[2];
          // 协议白名单：外部内容（LLM 报告/文献数据）可能携带 javascript:/data: 等危险链接，
          // 非白名单协议一律降级为纯文本（不渲染 <a>）
          const safe = /^(https?:|mailto:|zotero:)/i.test(href);
          const external = /^https?:\/\//.test(href);
          nodes.push(
            safe ? (
              <a key={`l${i}-${j}`} href={href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}>
                {m[1]}
              </a>
            ) : (
              <span key={`t${i}-${j}`}>{seg}</span>
            )
          );
        } else {
          nodes.push(<span key={`t${i}-${j}`}>{seg}</span>);
        }
      } else {
        nodes.push(<span key={`t${i}-${j}`}>{seg}</span>);
      }
    });
  });
  return nodes;
}

const TABLE_SEP = /^\s*\|[\s:|-]+\|\s*$/;
const TABLE_ROW = /^\s*\|.+\|\s*$/;

function splitCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((s) => s.trim());
}

export function Markdown({ text }: { text: string }) {
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let listBuffer: string[] = [];
  let ordered = false;
  let tableBuffer: string[] | null = null;

  const flushList = (key: string) => {
    if (listBuffer.length === 0) return;
    const items = listBuffer.map((it, k) => <li key={`${key}-${k}`}>{renderInline(it)}</li>);
    out.push(ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
    listBuffer = [];
  };

  const flushTable = (key: string) => {
    if (!tableBuffer || tableBuffer.length === 0) return;
    const head = splitCells(tableBuffer[0]);
    const rows = tableBuffer.slice(2).map(splitCells);
    out.push(
      <table key={key} className="mrc-md-table">
        <thead>
          <tr>{head.map((c, i) => <th key={i}>{renderInline(c)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((cells, ri) => (
            <tr key={ri}>{cells.map((c, ci) => <td key={ci}>{renderInline(c)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    );
    tableBuffer = null;
  };

  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    // 缩进 ≤4 空格的列表项也识别（渲染为平级项，内容保真，避免落成普通段落）
    const bullet = line.match(/^\s{0,4}[-*]\s+(.*)$/);
    const numbered = line.match(/^\s{0,4}\d+\.\s+(.*)$/);
    const quote = line.match(/^>\s?(.*)$/);
    const hr = /^---+$/.test(line.trim());
    const tableSep = TABLE_SEP.test(line);
    const tableRow = TABLE_ROW.test(line);

    if (tableSep && tableBuffer) {
      // 分隔行：只出现在表格块内，入缓冲
      tableBuffer.push(line);
      return;
    }
    if (tableRow) {
      flushList(`ul-${idx}`);
      if (!tableBuffer) {
        tableBuffer = [line];
      } else {
        tableBuffer.push(line);
      }
      return;
    }
    if (tableBuffer) {
      flushTable(`t-${idx}`);
    }

    if (heading) {
      flushList(`ul-${idx}`);
      const level = heading[1].length;
      const content = renderInline(heading[2]);
      const cls = `mrc-md-h${level}`;
      if (level === 1) out.push(<h3 key={idx} className={cls}>{content}</h3>);
      else if (level === 2) out.push(<h4 key={idx} className={cls}>{content}</h4>);
      else out.push(<h5 key={idx} className={cls}>{content}</h5>);
    } else if (bullet) {
      ordered = false;
      listBuffer.push(bullet[1]);
    } else if (numbered) {
      ordered = true;
      listBuffer.push(numbered[1]);
    } else if (quote) {
      flushList(`ul-${idx}`);
      out.push(<blockquote key={idx} className="mrc-md-quote">{renderInline(quote[1])}</blockquote>);
    } else if (hr) {
      flushList(`ul-${idx}`);
      out.push(<hr key={idx} className="mrc-md-hr" />);
    } else if (line.trim() === '') {
      flushList(`ul-${idx}`);
    } else {
      flushList(`ul-${idx}`);
      out.push(<p key={idx} className="mrc-md-p">{renderInline(line)}</p>);
    }
  });
  flushList('ul-end');
  flushTable('t-end');
  return <div className="mrc-markdown">{out}</div>;
}
