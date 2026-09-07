/**
 * 统一 id 生成（自 v1 ids.ts 平移，纯函数）
 * 时间戳 + Math.random 兜底（不依赖 crypto），同毫秒连写不撞 id。
 */
export function newId(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
