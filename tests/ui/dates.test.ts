/**
 * 共享日期工具 dates.ts 直接单测（档 B：零宿主依赖纯函数）。
 * 覆盖：pad / todayStr / fmt / addDays / dayIndex / dateToMs / fmtDateShort / formatLogTime，
 * 为 DRY 抽取后的公共实现提供闭环保护。
 */
import { describe, it, expect } from 'vitest';
import { pad, todayStr, fmt, addDays, dayIndex, dateToMs, fmtDateShort, formatLogTime } from '../../ui/lib/dates';

function local(dateStr: string) {
  // 用本地时区构造 Date，避免字符串 UTC 解析的时区偏差
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

describe('dates.ts 共享日期工具', () => {
  it('pad 补零', () => {
    expect(pad(3)).toBe('03');
    expect(pad(12)).toBe('12');
  });

  it('fmt Date→YYYY-MM-DD', () => {
    expect(fmt(local('2026-08-05'))).toBe('2026-08-05');
    expect(fmt(local('2026-11-30'))).toBe('2026-11-30');
  });

  it('todayStr 返回当前本地日期', () => {
    const d = new Date();
    expect(todayStr()).toBe(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  });

  it('addDays 跨月进位', () => {
    expect(fmt(addDays(local('2026-08-05'), 3))).toBe('2026-08-08');
    expect(fmt(addDays(local('2026-08-31'), 1))).toBe('2026-09-01');
  });

  it('dayIndex 距起点天数，null→0', () => {
    const min = local('2026-08-01');
    expect(dayIndex('2026-08-05', min)).toBe(4);
    expect(dayIndex('2026-08-01', min)).toBe(0);
    expect(dayIndex(null, min)).toBe(0);
  });

  it('dateToMs 非法输入返回 0', () => {
    expect(dateToMs('2026-08-01T00:00:00')).toBeGreaterThan(0);
    expect(dateToMs('bad')).toBe(0);
  });

  it('fmtDateShort YYYY-MM-DD→MM/DD，非法原样返回', () => {
    expect(fmtDateShort('2026-08-05')).toBe('08/05');
    expect(fmtDateShort('not-a-date')).toBe('not-a-date');
  });

  it('formatLogTime createdAt→YYYY-MM-DD HH:mm，无 createdAt 回退 date', () => {
    expect(formatLogTime({ createdAt: '2026-08-01T10:30:00.000Z' })).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(formatLogTime({ date: '2026-08-01' })).toBe('2026-08-01');
    expect(formatLogTime({})).toBe('');
  });
});
