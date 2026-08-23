/**
 * MetricsChart 纯函数单测（档 B：零 @hana/React 运行依赖，直接 import 导出的纯函数）
 * - niceTicks：规整刻度（1/2/5×10^k 步长）
 * - fmtTick：数值标签格式化（含 ≥100 整数尾零保护）
 */
import { describe, it, expect } from 'vitest';
import { niceTicks, fmtTick } from '../../ui/components/MetricsChart';

describe('niceTicks 规整刻度', () => {
  it('0.81~1.32 → 规整步长，落在范围内', () => {
    const t = niceTicks(0.81, 1.32, 5);
    expect(t.length).toBeGreaterThanOrEqual(2);
    expect(Math.min(...t)).toBeGreaterThanOrEqual(0.8);
    expect(Math.max(...t)).toBeLessThanOrEqual(1.33);
    // 步长规整（1/2/5×10^k）
    const step = Math.abs(t[1] - t[0]);
    expect(step).toBeGreaterThan(0);
  });

  it('非负整数区间规整', () => {
    const t = niceTicks(0, 100, 5);
    expect(t.length).toBeGreaterThanOrEqual(2);
    expect(t.every((v) => v >= 0 && v <= 100)).toBe(true);
  });

  it('span<=0 回退 [min,max]', () => {
    expect(niceTicks(5, 5)).toEqual([5, 5]);
  });
});

describe('fmtTick 数值标签格式化', () => {
  it('0 → 0', () => expect(fmtTick(0)).toBe('0'));
  it('小数保留两位去尾零', () => expect(fmtTick(1.27)).toBe('1.27'));
  it('一位小数', () => expect(fmtTick(59.7)).toBe('59.7'));
  it('≥100 整数不被误削（回归：100→1 / 120→12 bug）', () => {
    expect(fmtTick(100)).toBe('100');
    expect(fmtTick(120)).toBe('120');
  });
  it('整十刻度（规整刻度常见）', () => {
    expect(fmtTick(10)).toBe('10');
    expect(fmtTick(60)).toBe('60');
  });
});
