import type { SVGProps } from 'react';

/** 图标基础属性：极简线条风格统一参数 */
type IProps = SVGProps<SVGSVGElement> & { size?: number };

/** 统一的最小线条 SVG 容器：viewBox 24、无填充、currentColor、1.5 线宽、圆角笔帽、方形折角 */
function I({ size = 16, children, ...rest }: IProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/* ── 每日/日程 ── */
export const IconCalendar = (p: IProps) => (
  <I {...p}>
    <path d="M4 5.5h16a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z" />
    <path d="M3 9.5h18" />
    <path d="M8 3v3M16 3v3" />
    <path d="M8 13h3M8 16h6" />
  </I>
);

/* ── 实验/烧瓶 ── */
export const IconFlask = (p: IProps) => (
  <I {...p}>
    <path d="M9 3.5h6M10 3.5v5L5.5 17.5a1.8 1.8 0 0 0 1.6 2.5h9.8a1.8 1.8 0 0 0 1.6-2.5L14 8.5v-5" />
    <path d="M7.5 15h9" />
  </I>
);

/* ── 趋势图 ── */
export const IconChart = (p: IProps) => (
  <I {...p}>
    <path d="M3.5 4v15a1.5 1.5 0 0 0 1.5 1.5h15.5" />
    <path d="M7 14l4-4 3 3 5-6" />
  </I>
);

/* ── 文献/书 ── */
export const IconBook = (p: IProps) => (
  <I {...p}>
    <path d="M4 5a2 2 0 0 1 2-2h13.5a.5.5 0 0 1 .5.5v15a.5.5 0 0 1-.5.5H6.5A2.5 2.5 0 0 0 4 21.5Z" />
    <path d="M4 19a2 2 0 0 1 2-2h14" />
    <path d="M9 7.5h6" />
  </I>
);

/* ── 刷新 ── */
export const IconRefresh = (p: IProps) => (
  <I {...p}>
    <path d="M4 5v4h4" />
    <path d="M4.5 9a8 8 0 0 1 14-3M20 15v4h-4" />
    <path d="M19.5 15a8 8 0 0 1-14 3" />
  </I>
);

/* ── 关闭 X ── */
export const IconX = (p: IProps) => (
  <I {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </I>
);

/* ── 图钉/今日（简化为简单钉） ── */
export const IconPin = (p: IProps) => (
  <I {...p}>
    <path d="M8.5 3.5h7l1 1-5 4.5-4-4.5Z" />
    <path d="M12 9v3M10 12h4M12 12l-2.5 8M12 12l2.5 8" />
  </I>
);

/* ── 时钟 ── */
export const IconClock = (p: IProps) => (
  <I {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </I>
);

/* ── 星光/AI（简化为单一四角星） ── */
export const IconSparkle = (p: IProps) => (
  <I {...p}>
    <path d="M12 4l1.8 5.6L19 11.4l-5.2 1.8L12 19l-1.8-5.8L5 11.4l5.2-1.8Z" />
  </I>
);

/* ── 链接 ── */
export const IconLink = (p: IProps) => (
  <I {...p}>
    <path d="M9 12a3 3 0 0 1 3-3h3a3 3 0 0 1 0 6h-1.5" />
    <path d="M15 12a3 3 0 0 1-3 3H9a3 3 0 0 1 0-6h1.5" />
  </I>
);

/* ── 在线/离线 圆点（描边） ── */
export const IconDotOn = (p: IProps) => (
  <I {...p}>
    <circle cx="12" cy="12" r="7" strokeWidth={2} />
    <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
  </I>
);
export const IconDotOff = (p: IProps) => (
  <I {...p}>
    <circle cx="12" cy="12" r="7" strokeWidth={1.5} />
    <path d="M7 7l10 10" />
  </I>
);

/* ── 关机/未连接（方） ── */
export const IconFolder = (p: IProps) => (
  <I {...p}>
    <path d="M3.5 6.5a1 1 0 0 1 1-1h4l1.8 2h8.2a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1Z" />
  </I>
);

/* ── 文件/PDF ── */
export const IconDoc = (p: IProps) => (
  <I {...p}>
    <path d="M6 3.5h7.5L18.5 8v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1Z" />
    <path d="M13.5 3.5V8h5" />
    <path d="M8.5 12h7M8.5 15.5h7" />
  </I>
);

/* ── 折叠 chevron 上/下 ── */
export const IconChevronUp = (p: IProps) => (
  <I {...p}>
    <path d="M6 15l6-6 6 6" />
  </I>
);
export const IconChevronRight = (p: IProps) => (
  <I {...p}>
    <path d="M9 6l6 6-6 6" />
  </I>
);

/* ── 垃圾桶 ── */
export const IconTrash = (p: IProps) => (
  <I {...p}>
    <path d="M4.5 7h15M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M6.5 7l.7 12a1 1 0 0 0 1 .9h7.6a1 1 0 0 0 1-.9l.7-12" />
    <path d="M9.5 10.5v6M14.5 10.5v6" />
  </I>
);

/* ── 警示 ── */
export const IconWarning = (p: IProps) => (
  <I {...p}>
    <path d="M12 3.5L3 19.5h18Z" />
    <path d="M12 9.5v4M12 16.5v.01" />
  </I>
);

/* ── 外链 ── */
export const IconExternal = (p: IProps) => (
  <I {...p}>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
  </I>
);

/* ── 新 ── */
export const IconNew = (p: IProps) => (
  <I {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5v9M7.5 12h9" />
  </I>
);

/* ── 加号 ── */
export const IconPlus = (p: IProps) => (
  <I {...p}>
    <path d="M12 5v14M5 12h14" />
  </I>
);

/* ── 编辑笔（手动记录） ── */
export const IconEdit = (p: IProps) => (
  <I {...p}>
    <path d="M4 20l1-4L16.5 4.5a1.4 1.4 0 0 1 2 0l1 1a1.4 1.4 0 0 1 0 2L8 19l-4 1Z" />
  </I>
);

/* ── 导入 ── */
export const IconDownload = (p: IProps) => (
  <I {...p}>
    <path d="M12 4v10M8 10l4 4 4-4" />
    <path d="M5 18.5h14" />
  </I>
);
