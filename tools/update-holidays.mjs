#!/usr/bin/env node
/**
 * 重新生成 client.js 里的内置节假日表（`<<<BUILTIN_HOLIDAYS>>>` 标记之间）。
 *
 *   node tools/update-holidays.mjs            # 刷新表里已有的年份 + 今年和明年
 *   node tools/update-holidays.mjs 2027 2028  # 只刷新指定年份
 *
 * 数据源与运行时自动刷新用的是同一个（holiday-cn，汇总国务院办公厅放假安排）。
 * 拿不到的年份保留原值，脚本不会清空已有数据。改完记得重新安装 bundle，
 * 安装的是快照，不会自动跟随工作区里的改动。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(HERE, '..', 'client.js');
const START = '// <<<BUILTIN_HOLIDAYS>>>';
const END = '// <<<END_BUILTIN_HOLIDAYS>>>';
const SOURCES = [
  (year) => `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`,
  (year) => `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`,
];

const source = await readFile(CLIENT, 'utf8');
const startAt = source.indexOf(START);
const endAt = source.indexOf(END);
if (startAt < 0 || endAt < 0) throw new Error(`client.js 里找不到标记 ${START} / ${END}`);

const block = source.slice(startAt + START.length, endAt);
const jsonText = block.slice(block.indexOf('{'), block.lastIndexOf('}') + 1);
const table = JSON.parse(jsonText);

const thisYear = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(new Date()));
const requested = process.argv.slice(2).map(Number).filter(Number.isInteger);
const years = [...new Set([...Object.keys(table).map(Number), thisYear, thisYear + 1, ...requested])].sort((a, b) => a - b);

async function load(year) {
  for (const url of SOURCES.map((build) => build(year))) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) continue;
      const payload = await response.json();
      if (!Array.isArray(payload?.days)) continue;
      const days = payload.days
        .filter((day) => day?.isOffDay === true && typeof day.date === 'string')
        .map((day) => day.date)
        .sort();
      if (days.length > 0) return days;
    } catch {
      /* 换下一个源 */
    }
  }
  return null;
}

for (const year of years) {
  const days = await load(year);
  if (days) {
    table[String(year)] = days;
    console.log(`✓ ${year}: ${days.length} 天放假日`);
  } else {
    console.log(`· ${year}: 未取到（保留原值 ${table[String(year)]?.length ?? 0} 天）`);
  }
}

const sorted = Object.fromEntries(Object.keys(table).sort().map((key) => [key, table[key]]));
const rendered = JSON.stringify(sorted, null, 2).split('\n').map((line) => `    ${line}`).join('\n');
const next = `${source.slice(0, startAt + START.length)}\n    const BUILTIN_HOLIDAYS = ${rendered.trimStart()}\n    ${END}${source.slice(endAt + END.length)}`;
await writeFile(CLIENT, next);
console.log(`已写入 ${CLIENT}`);
