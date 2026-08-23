/**
 * O-10 单元测试：extractFirstJson 从 LLM 输出中提取第一个完整 JSON 对象。
 * 覆盖：多对象取第一个、嵌套对象、字符串内 {}/" 不干扰、无 { 与未闭合返回 null。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFirstJson } from '../src-server/server/json-util.ts';

test('多对象：取第一个完整 JSON', () => {
  assert.equal(extractFirstJson('前文 {"a":1} 后文 {"b":2}'), '{"a":1}');
});

test('嵌套对象：深度配对到匹配的 }', () => {
  assert.equal(extractFirstJson('{"x":{"y":1}} tail'), '{"x":{"y":1}}');
});

test('字符串内的 { } 不干扰配对', () => {
  assert.equal(extractFirstJson('{"a":"含{花括号}"} tail'), '{"a":"含{花括号}"}');
});

test('无 { 返回 null', () => {
  assert.equal(extractFirstJson('没有 json 的内容'), null);
});

test('未闭合返回 null', () => {
  assert.equal(extractFirstJson('{"a":1'), null);
});
