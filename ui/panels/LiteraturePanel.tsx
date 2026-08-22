import { useEffect, useMemo, useState } from 'react';
import { api, hana } from '../api';
import { Markdown } from '../components/Markdown';

type Props = {
  state: any;
  onStateChange: () => Promise<void>;
  showToast: (msg: string, opts?: { error?: boolean }) => void;
};

const SOURCE_LABELS: Record<string, string> = {
  online: '在线检索',
  zotero: 'Zotero',
};

export function LiteraturePanel({ state, onStateChange, showToast }: Props) {
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [sort, setSort] = useState<'recent' | 'year' | 'cites'>('recent');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [reportBusy, setReportBusy] = useState(false);
  const [reportZoom, setReportZoom] = useState(false);
  const [zotero, setZotero] = useState<any>(null);
  const [enhanceBusy, setEnhanceBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [reportScope, setReportScope] = useState<string>('all');
  // 任务 4：待整理移除两段式确认（行内 state，同 purgeGone 模式；沙箱 iframe 中 window.confirm 会被静默拦截）
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [purgeBusy, setPurgeBusy] = useState(false);

  const entries: any[] = state?.literature?.entries || [];
  const report = state?.report?.content || '';
  const reportUpdatedAt = state?.report?.updatedAt || null;
  const reportClusters: string[] = state?.report?.clusters || [];
  // P1#4：文献报告「已过期」标记——报告生成时的方案/文献库版本快照，与当前版本比较
  const reportPlanVersion: number | null = state?.report?.planVersion ?? null;
  const reportLiteratureVersion: number | null = state?.report?.literatureVersion ?? null;
  const currentPlanVersion: number | null = state?.plan?.version ?? null;
  const currentLiteratureVersion: number | null = state?.literature?.version ?? null;
  const reportStale =
    !!report &&
    reportPlanVersion != null &&
    reportLiteratureVersion != null &&
    (reportPlanVersion !== currentPlanVersion || reportLiteratureVersion !== currentLiteratureVersion);

  // Zotero collection 树（key/name/parentCollection）
  const collections: any[] = state?.collections?.collections || [];
  const collectionMap = useMemo(() => new Map(collections.map((c: any) => [c.key, c])), [collections]);
  const depthOf = (c: any) => {
    let d = 0;
    let cur = c.parentCollection;
    let guard = 0;
    while (cur && collectionMap.has(cur) && guard++ < 10) {
      d += 1;
      cur = collectionMap.get(cur).parentCollection;
    }
    return d;
  };
  const sortedCollections = useMemo(
    () => [...collections].sort((a, b) => depthOf(a) - depthOf(b) || (a.name || '').localeCompare(b.name || '')),
    [collections, collectionMap]
  );
  // 计数：每个 collection / 未分类（zotero 无 collection）/ 待整理（非 zotero）
  const collCounts = useMemo(() => {
    const cc: Record<string, number> = {};
    let uncategorized = 0;
    let toOrganize = 0;
    for (const e of entries) {
      if (e.source !== 'zotero') {
        toOrganize += 1;
        continue;
      }
      const keys = (e.collectionKeys || []).filter((k: string) => collectionMap.has(k));
      if (keys.length === 0) {
        uncategorized += 1;
        continue;
      }
      for (const k of keys) cc[k] = (cc[k] || 0) + 1;
    }
    return { cc, uncategorized, toOrganize };
  }, [entries, collectionMap]);

  const years = useMemo(
    () => [...new Set(entries.map((e) => Number(e.year)).filter((y) => y > 1900))].sort((a, b) => b - a),
    [entries]
  );

  useEffect(() => {
    api.zoteroStatus().then(setZotero).catch(() => setZotero({ ok: false, error: 'unavailable' }));
  }, []);

  const filtered = useMemo(() => {
    let list = entries;
    if (filter === 'uncategorized') {
      list = list.filter((e) => e.source === 'zotero' && (e.collectionKeys || []).filter((k: string) => collectionMap.has(k)).length === 0);
    } else if (filter === 'to-organize') {
      list = list.filter((e) => e.source !== 'zotero');
    } else if (filter !== 'all') {
      list = list.filter((e) => (e.collectionKeys || []).includes(filter));
    }
    if (yearFilter !== 'all') {
      list = list.filter((e) => String(e.year) === yearFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      // 聚类筛选：整串匹配优先；无命中时拆词 OR 匹配（中文按 2 字滑窗，过滤停用词；下标字符归一化）
      const STOP = new Set(['的', '和', '与', '及', '在', '中', '上', '下', '对', '为', '于', '其', '等', '之', '并', '或', '以', '用', '来', '使', '从', '向', '被', '把', '让', '到', '和']);
      const SUB: Record<string, string> = { '\u2080': '0', '\u2081': '1', '\u2082': '2', '\u2083': '3', '\u2084': '4', '\u2085': '5', '\u2086': '6', '\u2087': '7', '\u2088': '8', '\u2089': '9', '\u00b2': '2', '\u00b3': '3' };
      const norm = q.replace(/[\u2080-\u2089\u00b2\u00b3]/g, (ch) => SUB[ch] || ch);
      const words: string[] = [];
      // 拉丁/数字段整段作为词
      for (const w of norm.match(/[a-z0-9]+/g) || []) {
        if (w.length >= 3) words.push(w);
      }
      // 剩余中文段按 2 字滑窗
      const rest = norm.replace(/[a-z0-9]+/g, '|').split(/[^\p{L}\p{N}]+/u);
      for (const raw of rest) {
        if (!raw) continue;
        for (let i = 0; i + 2 <= raw.length; i++) {
          const bigram = raw.slice(i, i + 2);
          if (!STOP.has(bigram)) words.push(bigram);
        }
      }
      const deduped = [...new Set(words)];
      list = list.filter((e) => {
        const hay = [e.title, e.venue, ...(e.authors || [])].filter(Boolean).join(' ').toLowerCase();
        const abs = (e.abstract || '').toLowerCase();
        if (hay.includes(norm) || abs.includes(norm)) return true;
        return deduped.some((w) => hay.includes(w) || abs.includes(w));
      });
    }
    const sorted = [...list];
    if (sort === 'year') sorted.sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0));
    else if (sort === 'cites') sorted.sort((a, b) => (Number(b.citationCount) || 0) - (Number(a.citationCount) || 0));
    else sorted.reverse(); // 最近入库在前
    return sorted;
  }, [entries, filter, search, sort, yearFilter]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const refreshReport = async () => {
    setReportBusy(true);
    try {
      const scope =
        reportScope === 'all'
          ? { type: 'all' as const }
          : reportScope.startsWith('coll:')
            ? { type: 'collection' as const, key: reportScope.slice(5), label: collectionMap.get(reportScope.slice(5))?.name || reportScope.slice(5) }
            : { type: 'recent' as const, n: Number(reportScope) };
      await api.refreshReport(scope);
      await onStateChange();
      showToast('分析报告已更新');
    } catch (err: any) {
      showToast(`报告生成失败：${err.message}`, { error: true });
    } finally {
      setReportBusy(false);
    }
  };

  /** E4：一键清除 Zotero 失效镜像（两段式确认，沙箱 iframe 中 window.confirm 会被静默拦截） */
  const [confirmPurge, setConfirmPurge] = useState(false);
  const purgeGone = async () => {
    setConfirmPurge(false);
    try {
      const r = await api.purgeGone();
      await onStateChange();
      showToast(r.ok ? `已清除 ${r.purged} 条失效镜像` : '清除失败');
    } catch (err: any) {
      showToast(`清除失败：${err.message}`, { error: true });
    }
  };

  /** 面板内一键导出（依赖会话绑定；未绑定时展示服务端 hint） */
  const exportFile = async (type: string, label: string) => {
    try {
      const r = await api.exportFile(type);
      showToast(`${label}已导出：${r.file?.label || '已发送到会话文件'}`);
    } catch (err: any) {
      showToast(err.hint || err.message || '导出失败', { error: true });
    }
  };

  /** 任务 4：手动扫描（全量同步：Zotero 镜像 + 工作区扫描 + 去重；复用既有 POST /scan） */
  const scanNow = async () => {
    setScanning(true);
    try {
      const r = await api.scan();
      await onStateChange();
      showToast(`扫描完成：发现 ${r.found ?? 0} 条，入库 ${r.appended ?? 0} 条`);
    } catch (err: any) {
      showToast(`扫描失败：${err.message}`, { error: true });
    } finally {
      setScanning(false);
    }
  };

  /** E3：手动 AI 摘要（✨ AI 摘要：生成/翻译摘要 + 提取关键词；fire-and-forget 启动新一轮循环铺完） */
  const enhancePdfs = async () => {
    setEnhanceBusy(true);
    try {
      const r = await api.enhancePdfs();
      showToast(r.ok ? 'AI 摘要已在后台启动（解析 PDF + 中文摘要/翻译 + 关键词），约 10-20 分钟完成，稍后刷新查看' : '补全启动失败');
    } catch (err: any) {
      showToast(`补全启动失败：${err.message}`, { error: true });
    } finally {
      setEnhanceBusy(false);
    }
  };

  /** 任务 4：待整理条目移除（单条 ids / 清空 all；Zotero 镜像由服务端拒绝） */
  const removeEntries = async (ids: string[] | 'all') => {
    setPurgeBusy(true);
    try {
      const r = ids === 'all' ? await api.deleteLiterature({ all: true }) : await api.deleteLiterature({ ids });
      setRemoveId(null);
      await onStateChange();
      showToast(`已移除 ${r.removed} 条`);
    } catch (err: any) {
      showToast(`移除失败：${err.message}`, { error: true });
    } finally {
      setPurgeBusy(false);
    }
  };

  /** 摘要展示：三级标记 + 原文对照（E2）；剥离 Zotero 摘要的 HTML 标签 */
  const AbstractBlock = ({ entry, expanded, onToggle }: { entry: any; expanded: boolean; onToggle: () => void }) => {
    const stripHtml = (s: string) => String(s).replace(/<[^>]+>/g, '').replace(/&nbsp;|&amp;|&lt;|&gt;/g, (m) => ({ '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>' }[m] || m));
    const abs = stripHtml(entry.abstract || '').trim();
    const absEn = stripHtml(entry.abstractEn || '').trim();
    const source = entry.abstractSource;
    const isAi = source === 'ai_generated' || source === 'ai_translated' || source === 'fulltext';
    const showEn = absEn && (expanded || !abs);
    if (!abs && !absEn && source !== 'none') return null;
    if (source === 'none' && !abs) {
      return <p className="mrc-paper-abstract none">⚠️ 暂无摘要（无 PDF 或扫描版），可在 Zotero 中补充后同步。</p>;
    }
    const body = showEn ? absEn : abs;
    return (
      <p className={`mrc-paper-abstract ${expanded ? 'expanded' : ''}`}>
        {isAi && <span className="mrc-ai-badge" title={source === 'ai_translated' ? 'AI 翻译自英文原文' : 'AI 从全文生成'}>✨ AI</span>}
        {body.slice(0, expanded ? body.length : 200)}
        {!expanded && body.length > 200 ? '…' : ''}
        {(body.length > 200 || absEn) && (
          <button className="mrc-link-btn" onClick={onToggle}>
            {expanded ? (absEn ? ' 收起' : ' 收起') : absEn ? ' 展开（原文对照）' : ' 展开全文'}
          </button>
        )}
      </p>
    );
  };

  /** E1：在 Zotero 中定位（深链；失败降级显示 zoteroKey 文本） */
  const openInZotero = (entry: any) => {
    const key = entry?.zoteroKey;
    if (!key) {
      showToast('该条目无 Zotero key，无法定位', { error: true });
      return;
    }
    try {
      window.open(`zotero://select/library/items/${key}`, '_blank');
    } catch { /* 忽略 */ }
    // 无法可靠检测深链是否被 Zotero 协议接管，常显 key 兜底
    showToast(`已尝试在 Zotero 中定位；未跳转时可用 key 手动查找：${key}`);
  };

  /** E1：待整理分组批量导出 RIS */
  const exportToOrganizeRis = async () => {
    try {
      const r = await api.exportRisBatch();
      showToast(r.ok ? `已导出 ${r.count} 条 RIS：${r.file?.label || '已发送到会话文件'}` : '导出失败');
    } catch (err: any) {
      showToast(err.hint || err.message || '导出失败', { error: true });
    }
  };

  return (
    <div className="mrc-literature">
      <div className="mrc-panel-section">
        <div className="mrc-section-head">
          <span className="mrc-section-title">📚 文献库</span>
          <span className="mrc-count">{entries.length}</span>
          <span className="mrc-zotero-status" title={zotero?.ok ? `Zotero 已连接：${zotero.total} 条` : `Zotero 未连接${zotero?.error ? `：${zotero.error}` : ''}`}>
            {zotero?.ok ? '● Zotero 在线' : '○ Zotero 离线'}
          </span>
          <button className="mrc-btn small" onClick={scanNow} disabled={scanning} title="全量同步：Zotero 镜像 + 工作区扫描 + 去重">
            {scanning ? '⏳ 扫描中…' : '🔄 扫描'}
          </button>
          <button className="mrc-btn small" onClick={enhancePdfs} disabled={enhanceBusy} title="生成/翻译摘要 + 提取关键词（解析 PDF）">
            {enhanceBusy ? '补全中…' : '✨ AI 摘要'}
          </button>
          {entries.some((e) => e.zoteroGone) &&
            (confirmPurge ? (
              <span className="mrc-inline-confirm">
                <span className="mrc-confirm-tip">删除全部失效镜像？（不可恢复）</span>
                <button className="mrc-btn small danger" onClick={purgeGone}>确认删除</button>
                <button className="mrc-btn small" onClick={() => setConfirmPurge(false)}>取消</button>
              </span>
            ) : (
              <button className="mrc-btn small danger" onClick={() => setConfirmPurge(true)} title="删除 Zotero 中已删除文献的失效镜像">
                🗑 清除失效
              </button>
            ))}
        </div>

        <div className="mrc-filter-row mrc-coll-filter">
          <button className={`mrc-chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
            全部 {entries.length}
          </button>
          {sortedCollections.map((c) => (
            <button
              key={c.key}
              className={`mrc-chip ${filter === c.key ? 'active' : ''}`}
              style={{ marginLeft: depthOf(c) * 12 }}
              onClick={() => setFilter(c.key)}
              title={c.name}
            >
              {depthOf(c) > 0 ? '└ ' : ''}{c.name}
              {collCounts.cc[c.key] ? ` (${collCounts.cc[c.key]})` : ''}
            </button>
          ))}
          {collCounts.uncategorized > 0 && (
            <button className={`mrc-chip ${filter === 'uncategorized' ? 'active' : ''}`} onClick={() => setFilter('uncategorized')}>
              🗂 未分类 {collCounts.uncategorized}
            </button>
          )}
          {collCounts.toOrganize > 0 && (
            <button className={`mrc-chip ${filter === 'to-organize' ? 'active' : ''}`} onClick={() => setFilter('to-organize')}>
              📥 待整理 {collCounts.toOrganize}
            </button>
          )}
        </div>

        <div className="mrc-lit-toolbar">
          <input
            className="mrc-lit-search"
            placeholder="搜索标题 / 作者 / 摘要…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="mrc-lit-year" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} title="按年份过滤">
            <option value="all">全部年份</option>
            {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
          </select>
          <select className="mrc-lit-sort" value={sort} onChange={(e) => setSort(e.target.value as any)}>
            <option value="recent">最近入库</option>
            <option value="year">年份新→旧</option>
            <option value="cites">引用多→少</option>
          </select>
          {filter === 'to-organize' && collCounts.toOrganize > 0 && (
            removeId === '__all__' ? (
              <span className="mrc-inline-confirm">
                <span className="mrc-confirm-tip">将删除全部待整理条目（非 Zotero 共 {collCounts.toOrganize} 条，不可恢复；Zotero 镜像不受影响）</span>
                <button className="mrc-btn small danger" disabled={purgeBusy} onClick={() => removeEntries('all')}>确认清空</button>
                <button className="mrc-btn small" disabled={purgeBusy} onClick={() => setRemoveId(null)}>取消</button>
              </span>
            ) : (
              <button className="mrc-btn small danger" onClick={() => setRemoveId('__all__')} title="删除全部待整理条目（Zotero 镜像不受影响）">
                🗑 清空待整理（{collCounts.toOrganize}）
              </button>
            )
          )}
          {filter === 'to-organize' && collCounts.toOrganize > 0 && (
            <button className="mrc-btn small" onClick={exportToOrganizeRis} title="将待整理条目导出为 RIS，在 Zotero 中导入归类">
              📤 导出 RIS（{collCounts.toOrganize}）
            </button>
          )}
        </div>

        <div className="mrc-literature-list">
          {filtered.length === 0 && (
            <div className="mrc-empty">
              {filter === 'to-organize'
                ? '「待整理」里是在线检索 / 工作区里的文献。点上方「📤 导出 RIS」导出后在 Zotero 中导入归类；已归入 Zotero 的条目会在下次同步后移出此分组。'
                : filter === 'uncategorized'
                  ? '当前没有未分类的 Zotero 文献。可在 Zotero 中为文献建立分类（collection），同步后这里会显示分类树。'
                  : '没有匹配的文献。点击上方「🔄 扫描」或让助手用 collect_literature 搜集。'}
            </div>
          )}
          {filtered.map((entry) => {
            const id = entry.id || entry.title;
            const isExpanded = expanded.has(id);
            return (
              <article key={id} className={`mrc-paper-card ${entry.zoteroGone ? 'gone' : ''}`}>
                <div className="mrc-paper-title">{entry.title || '（未命名文献）'}</div>
                <div className="mrc-paper-meta">
                  {entry.year ? <span className="mrc-paper-year">{entry.year}</span> : null}
                  {entry.firstSeenAt && Date.now() - new Date(entry.firstSeenAt).getTime() < 7 * 24 * 3600 * 1000 && (
                    <span className="mrc-paper-new" title="7 天内新入库">🆕</span>
                  )}
                  {entry.venue ? <span className="mrc-paper-venue">{entry.venue}</span> : null}
                  {entry.source === 'zotero' ? (
                    <span className="mrc-paper-source src-zotero">
                      {entry.readOnly ? 'Zotero 镜像' : 'Zotero'}
                    </span>
                  ) : entry.collectedWith ? (
                    <span
                      className={`mrc-paper-source src-${entry.source || 'unknown'}`}
                      title={`检索词：${entry.collectedWith.query}；时间 ${entry.collectedWith.fromYear}-${entry.collectedWith.toYear}`}
                    >
                      在线 · {String(entry.collectedWith.fromYear).slice(2)}-{String(entry.collectedWith.toYear).slice(2)}
                    </span>
                  ) : (
                    <span className={`mrc-paper-source src-${entry.source || 'unknown'}`}>
                      {SOURCE_LABELS[entry.source] || entry.source}
                    </span>
                  )}
                  {entry.unsupported ? '（暂不支持解析）' : ''}
                  {entry.citationCount != null && <span className="mrc-paper-cites">引用 {entry.citationCount}</span>}
                  {entry.fullTextParsed === 'ok' && <span className="mrc-paper-ft" title="已解析 PDF 全文">📄 全文已解析</span>}
                  {entry.fullTextParsed === 'scan' && <span className="mrc-paper-ft scan" title="扫描版 PDF，无法提取文本">📄 扫描版需人工补全</span>}
                  {entry.abstractSource === 'ai_generated' && <span className="mrc-paper-ft" title="AI 从全文生成的摘要">✨ AI 摘要</span>}
                  {entry.abstractSource === 'ai_translated' && <span className="mrc-paper-ft trans" title="AI 翻译自英文原文">✨ AI 翻译</span>}
                  {entry.abstractSource === 'none' && <span className="mrc-paper-ft none" title="无 PDF 或无摘要">⚠️ 待补全</span>}
                </div>
                {Array.isArray(entry.keywords) && entry.keywords.length > 0 && (
                  <div className="mrc-paper-keywords" title={entry.keywordsSource === 'ai' ? 'AI 提取的关键词' : undefined}>
                    {entry.keywordsSource === 'ai' && <span className="mrc-ai-badge">✨</span>}
                    <span>关键词：{entry.keywords.join(' · ')}</span>
                  </div>
                )}
                {entry.authors?.length > 0 && (
                  <div className="mrc-paper-authors">{entry.authors.slice(0, 6).join(', ')}{entry.authors.length > 6 ? ' et al.' : ''}</div>
                )}
                <AbstractBlock entry={entry} expanded={isExpanded} onToggle={() => toggleExpand(id)} />
                <div className="mrc-paper-actions">
                  {entry.source !== 'zotero' && typeof entry.id === 'string' && entry.id && (removeId === entry.id ? (
                      <span className="mrc-inline-confirm">
                        <span className="mrc-confirm-tip">确认移除该条目？</span>
                        <button className="mrc-btn small danger" disabled={purgeBusy} onClick={() => removeEntries([entry.id])}>确认移除</button>
                        <button className="mrc-btn small" disabled={purgeBusy} onClick={() => setRemoveId(null)}>取消</button>
                      </span>
                    ) : (
                      <button className="mrc-btn small danger" onClick={() => setRemoveId(entry.id)} title="从文献库移除该条目（Zotero 镜像不受影响）">✕ 移除</button>
                    ))}
                  {entry.zoteroKey && (
                    <button className="mrc-btn small" title={`在 Zotero 中定位该条目（key: ${entry.zoteroKey}）`} onClick={() => openInZotero(entry)}>
                      🔗 Zotero
                    </button>
                  )}
                  {entry.doi && <span className="mrc-paper-doi">DOI: {entry.doi}</span>}
                  {/* 宿主 external.open 安全封装 + https 协议白名单（技术栈复审：window.open 无协议校验） */}
                  {entry.url && /^https?:\/\//i.test(entry.url) && (
                    <a className="mrc-paper-link" href="#" onClick={(e) => { e.preventDefault(); void hana.external.open(entry.url); }}>链接 ↗</a>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <div className="mrc-panel-section mrc-report-block">
        <div className="mrc-section-head">
          <span className="mrc-section-title">📑 文献分析报告</span>
          {reportUpdatedAt && <span className="mrc-report-time">更新于 {new Date(reportUpdatedAt).toLocaleString('zh-CN')}</span>}
          {reportPlanVersion != null && reportLiteratureVersion != null && (
            <span className="mrc-report-snapshot" title="本报告的生成基准">
              基于 方案 v{reportPlanVersion} · 文献库 v{reportLiteratureVersion}
            </span>
          )}
          {reportStale && (
            <span
              className="mrc-report-stale"
              title={`研究方案或文献库自报告生成后已变动（当前：方案 v${currentPlanVersion ?? '?'} · 文献库 v${currentLiteratureVersion ?? '?'}），结论可能不再准确，建议更新`}
            >
              ⚠️ 已过期，建议更新
            </span>
          )}
          <span className="mrc-head-actions">
            <select className="mrc-lit-sort" value={reportScope} onChange={(e) => setReportScope(e.target.value)} title="报告分析范围">
              <option value="all">全库</option>
              <option value="10">最近 10 篇</option>
              <option value="20">最近 20 篇</option>
              <option value="50">最近 50 篇</option>
              {collections.length > 0 && <option disabled>── 按分类 ──</option>}
              {collections.map((c) => (
                <option key={c.key} value={`coll:${c.key}`}>
                  {c.name}（{collCounts.cc[c.key] || 0}）
                </option>
              ))}
            </select>
            {report && <button className="mrc-btn small" onClick={() => setReportZoom(true)}>⤢ 放大阅读</button>}
            {report && <button className="mrc-btn small" onClick={() => exportFile('report', '分析报告')} title="导出 Markdown 到会话文件">📤 导出</button>}
            <button className="mrc-btn small" onClick={refreshReport} disabled={reportBusy}>
              {reportBusy ? '生成中…' : '🔄 更新报告'}
            </button>
          </span>
        </div>
        {reportClusters.length > 0 && (
          <div className="mrc-cluster-row">
            <span className="mrc-template-label">聚类筛选：</span>
            {reportClusters.map((name) => (
              <button
                key={name}
                className={`mrc-chip ${search === name ? 'active' : ''}`}
                onClick={() => setSearch(search === name ? '' : name)}
                title="按聚类名筛选文献（标题/摘要包含）"
              >
                {name}
              </button>
            ))}
          </div>
        )}
        {report ? (
          <div className="mrc-report-body">
            <Markdown text={report} />
          </div>
        ) : (
          <div className="mrc-empty">报告未生成。点击「🔄 更新报告」生成（文献分析基于文献库全部条目，含 Zotero 镜像）。</div>
        )}
        <div className="mrc-export-row">
          <span className="mrc-template-label">导出：</span>
          <button className="mrc-btn small" onClick={() => exportFile('worklog', '实验记录')}>实验记录</button>
          <button className="mrc-btn small" onClick={() => exportFile('review', '审查报告')}>最近审查报告</button>
        </div>
      </div>

      {reportZoom && (
        <div className="mrc-drawer-mask" onClick={() => setReportZoom(false)}>
          <div className="mrc-report-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mrc-drawer-head">
              <span>📑 文献分析报告</span>
              <span className="mrc-head-actions">
                <button className="mrc-btn small" onClick={() => exportFile('report', '分析报告')}>📤 导出</button>
                <button className="mrc-btn small" onClick={() => setReportZoom(false)}>✕</button>
              </span>
            </div>
            <div className="mrc-report-modal-body">
              <Markdown text={report} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

