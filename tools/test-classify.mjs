// 用真实 client.js 源码验证时段判定逻辑（不修改插件文件）。
// 做法：把 factory 里 return 的对象加一个 __test 出口，再用桩 React / window 执行。
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const patched = source.replace(
  "    return {\n      inject: ['slots', 'modelDirectories'],",
  "    return {\n      __test: { beijingParts, isPeak, holidaysFor, isDeepSeekProvider, resolveWithRetry, BUILTIN_HOLIDAYS },\n      inject: ['slots', 'modelDirectories'],",
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
const { beijingParts, isPeak, holidaysFor, isDeepSeekProvider, resolveWithRetry } = __test;

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

// ── 显示条件：只有 DeepSeek 自家 provider 才显示 ──────────────────────────────
const providerCases = [
  ['DeepSeek 官方 API Key', 'deepseek-official', true],
  ['DeepSeek 账号', 'deepseek-account', true],
  ['将来新增的官方 provider（前缀兜底）', 'deepseek-something-new', true],
  ['大小写混写', 'DeepSeek-Official', true],
  ['Anthropic', 'anthropic', false],
  ['OpenAI 兼容中转', 'openrouter', false],
  ['自定义第三方', 'my-gateway', false],
  ['未知（目录未加载）', null, false],
  ['未知（空串）', '', false],
  ['未知（非字符串）', undefined, false],
];
let providerFailed = 0;
for (const [label, provider, expected] of providerCases) {
  const actual = isDeepSeekProvider(provider);
  const ok = actual === expected;
  if (!ok) providerFailed += 1;
  console.log(`${ok ? '✓' : '✗'} provider=${String(provider)} (${label}) → ${actual ? '显示' : '隐藏'}${ok ? '' : ` 期望 ${expected ? '显示' : '隐藏'}`}`);
}

const failures = failed + providerFailed;

// ── 切换会话时模型目录的"延迟解析 + 重试" ────────────────────────────────────
// 回归：directoryFor() 对新会话会先抛错，注册时只解析一次会让圆点整段会话消失。
const retryCases = [];
{
  // ① 前两次抛错、第三次成功 —— 这正是切换会话时的真实时序
  const store = { current: { provider: 'deepseek-official' } };
  const pending = [];
  let calls = 0;
  let received = null;
  let delays = [];
  resolveWithRetry(
    () => { calls += 1; if (calls <= 2) throw new Error('session resolved no binding'); return store; },
    (directory) => { received = directory; },
    { retryMs: 10, maxAttempts: 5, schedule: (fn, ms) => { delays.push(ms); pending.push(fn); return pending.length; }, cancel: () => {} },
  );
  const scheduledAfterFirst = pending.length;
  while (pending.length > 0) pending.shift()();
  retryCases.push(['抛错两次后成功：最终解析到目录', calls === 3 && received === store]);
  retryCases.push(['抛错两次后成功：排了两次重试且间隔正确', scheduledAfterFirst === 1 && delays.length === 2 && delays.every((ms) => ms === 10)]);
}
{
  // ② 一直失败：到达上限就放弃，不会无限重试
  const pending = [];
  let calls = 0;
  let received = null;
  resolveWithRetry(
    () => { calls += 1; throw new Error('never ready'); },
    () => { received = true; },
    { retryMs: 10, maxAttempts: 3, schedule: (fn) => { pending.push(fn); return pending.length; }, cancel: () => {} },
  );
  while (pending.length > 0) pending.shift()();
  retryCases.push(['持续失败：试满 maxAttempts 即停止', calls === 3 && received === null]);
}
{
  // ③ 取消后，已排期的回调不得再触发解析（组件卸载 / 会话切换）
  const pending = [];
  let calls = 0;
  let cancelled = 0;
  const stop = resolveWithRetry(
    () => { calls += 1; throw new Error('x'); },
    () => {},
    { retryMs: 10, maxAttempts: 10, schedule: (fn) => { pending.push(fn); return pending.length; }, cancel: () => { cancelled += 1; } },
  );
  stop();
  const stale = pending.shift();
  if (stale) stale();
  retryCases.push(['取消后：已排期回调不再解析', calls === 1 && cancelled === 1]);
}
{
  // ④ 一次就成功：不应排任何重试
  const store = { current: { provider: 'deepseek-official' } };
  let scheduled = 0;
  let received = null;
  resolveWithRetry(
    () => store,
    (directory) => { received = directory; },
    { retryMs: 10, maxAttempts: 5, schedule: () => { scheduled += 1; return 0; }, cancel: () => {} },
  );
  retryCases.push(['一次成功：同步回调且不排重试', received === store && scheduled === 0]);
}

let retryFailed = 0;
for (const [label, ok] of retryCases) {
  if (!ok) retryFailed += 1;
  console.log(`${ok ? '✓' : '✗'} ${label}`);
}

const total = failures + retryFailed;
console.log(total === 0 ? '\n全部通过' : `\n${total} 项不符`);
process.exit(total === 0 ? 0 : 1);
