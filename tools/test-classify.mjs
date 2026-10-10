// 用真实 client.js 源码验证时段判定逻辑（不修改插件文件）。
// 做法：把 factory 里 return 的对象加一个 __test 出口，再用桩 React / window 执行。
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const patched = source.replace(
  "    return {\n      inject: ['slots'],",
  "    return {\n      __test: { beijingParts, isPeak, holidaysFor, BUILTIN_HOLIDAYS },\n      inject: ['slots'],",
);
if (patched === source) throw new Error('未能注入 __test 出口（源码结构变了？）');

let captured = null;
globalThis.window = {
  __ModuleLoader__: { load: (definition) => { captured = definition; } },
  localStorage: {
    store: new Map(),
    getItem(key) { return this.store.has(key) ? this.store.get(key) : null; },
    setItem(key, value) { this.store.set(key, String(value)); },
  },
};
const reactStub = { createElement: () => null, useState: () => [undefined, () => {}], useEffect: () => {} };
const requireStub = (id) => {
  if (id === 'react') return reactStub;
  throw new Error(`意外 require: ${id}`);
};

// 直接执行源码：client.js 结尾会调用 window.__ModuleLoader__.load（被桩捕获）
new Function('window', patched)(globalThis.window);
if (!captured) throw new Error('window.__ModuleLoader__.load 未被调用');
const { __test } = captured.factory(requireStub);
const { beijingParts, isPeak, holidaysFor } = __test;

const holidays2026 = holidaysFor(2026);
const cases = [
  // [说明, ISO 时刻(UTC), 期望是否高峰]
  ['周一 10:00 北京', '2026-10-12T02:00:00Z', true],
  ['周一 09:00 北京（区间起点）', '2026-10-12T01:00:00Z', true],
  ['周一 12:00 北京（午休起点）', '2026-10-12T04:00:00Z', false],
  ['周一 13:59 北京（午休中）', '2026-10-12T05:59:00Z', false],
  ['周一 14:00 北京（下午起点）', '2026-10-12T06:00:00Z', true],
  ['周一 17:59 北京', '2026-10-12T09:59:00Z', true],
  ['周一 18:00 北京（区间终点）', '2026-10-12T10:00:00Z', false],
  ['周五 10:00 北京', '2026-10-16T02:00:00Z', true],
  ['周六 10:00 北京（周末全天空闲）', '2026-10-10T02:00:00Z', false],
  ['周六 11:31 北京（今天，调休上班日仍是周末）', '2026-10-10T03:31:00Z', false],
  ['周日 15:00 北京', '2026-10-11T07:00:00Z', false],
  ['国庆 2026-10-01 周四 10:00（法定节假日）', '2026-10-01T02:00:00Z', false],
  ['春节 2026-02-16 周一 10:00（法定节假日）', '2026-02-16T02:00:00Z', false],
  ['中秋 2026-09-25 周五 15:00（法定节假日）', '2026-09-25T07:00:00Z', false],
  ['清明 2026-04-06 周一 10:00（法定节假日）', '2026-04-06T02:00:00Z', false],
  ['节后首个工作日 2026-10-08 周四 10:00', '2026-10-08T02:00:00Z', true],
];

let failed = 0;
for (const [label, iso, expected] of cases) {
  const instant = new Date(iso);
  const parts = beijingParts(instant);
  const actual = isPeak(parts, holidays2026);
  const ok = actual === expected;
  if (!ok) failed += 1;
  console.log(`${ok ? '✓' : '✗'} ${label} → ${actual ? '高峰(黄)' : '空闲(绿)'}${ok ? '' : ` 期望 ${expected ? '高峰' : '空闲'}`}`);
}
console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项不符`);
process.exit(failed === 0 ? 0 : 1);
