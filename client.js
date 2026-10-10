window.__ModuleLoader__.load({
  id: '@local/dsh-deepseek-offpeak-indicator',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // ── 规则（据 DeepSeek 官方定价页）──────────────────────────────────────
    // 北京时间周一至周五（不含中国法定节假日）9:00-12:00、14:00-18:00 为
    // 高峰时段；其余时段（含周末与法定节假日全天）为空闲时段，价格为高峰的
    // 一半。本插件只判断"现在属于哪一段"，因此全部逻辑都在浏览器半边完成，
    // 不需要请求后端。
    const TZ = 'Asia/Shanghai';
    const PEAK_WINDOWS = [[9 * 60, 12 * 60], [14 * 60, 18 * 60]];
    const WORKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

    // 颜色：黄 = 高峰时段，绿 = 空闲时段。两个值在浅色/深色主题下都足够醒目，
    // 再叠一圈半透明描边保证在浅色背景上不糊。
    const PEAK_COLOR = '#f2b705';
    const OFFPEAK_COLOR = '#22c55e';
    const RING = '0 0 0 1px rgba(127,127,127,0.45)';

    // ── 中国法定节假日（放假日）─────────────────────────────────────────────
    // 数据源：国务院办公厅放假安排通知，经 holiday-cn 汇总为机器可读 JSON。
    // 下面这张表是离线兜底；运行时会尝试联网刷新并按年缓存到 localStorage，
    // 因此 2027 年的安排公布后无需改代码即可生效。改表也可以直接跑
    // tools/update-holidays.mjs 重新生成本段。
    // <<<BUILTIN_HOLIDAYS>>>
    const BUILTIN_HOLIDAYS = {
      "2026": ["2026-01-01", "2026-01-02", "2026-01-03", "2026-02-15", "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20", "2026-02-21", "2026-02-22", "2026-02-23", "2026-04-04", "2026-04-05", "2026-04-06", "2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05", "2026-06-19", "2026-06-20", "2026-06-21", "2026-09-25", "2026-09-26", "2026-09-27", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"]
    };
    // <<<END_BUILTIN_HOLIDAYS>>>
    const HOLIDAY_SOURCES = [
      (year) => `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`,
      (year) => `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`,
    ];
    const CACHE_KEY = 'dsh-offpeak-indicator:holidays:';
    const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    const FETCH_TIMEOUT_MS = 6000;
    const TICK_MS = 15000;

    /** 北京时间的日期、星期与当日分钟数；不依赖本机时区。 */
    function beijingParts(date) {
      const parts = {};
      const formatted = new Intl.DateTimeFormat('en-GB', {
        timeZone: TZ,
        hourCycle: 'h23',
        weekday: 'short',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).formatToParts(date);
      for (const part of formatted) parts[part.type] = part.value;
      return {
        year: Number(parts.year),
        dateKey: `${parts.year}-${parts.month}-${parts.day}`,
        weekday: parts.weekday,
        minutes: Number(parts.hour) * 60 + Number(parts.minute),
      };
    }

    function readCache(year) {
      try {
        const raw = window.localStorage.getItem(CACHE_KEY + year);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.days) || typeof parsed.at !== 'number') return null;
        return parsed;
      } catch (error) {
        return null;
      }
    }

    function writeCache(year, days) {
      try {
        window.localStorage.setItem(CACHE_KEY + year, JSON.stringify({ at: Date.now(), days }));
      } catch (error) {
        /* 隐私模式或配额满：忽略，回落到内置表。 */
      }
    }

    /** 同步初值：本地缓存优先，其次内置表，最后退化为"只按周末判断"。 */
    function holidaysFor(year) {
      const cached = readCache(year);
      if (cached) return new Set(cached.days);
      const builtin = BUILTIN_HOLIDAYS[String(year)];
      return new Set(Array.isArray(builtin) ? builtin : []);
    }

    async function fetchHolidays(year) {
      for (const source of HOLIDAY_SOURCES) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
          const response = await fetch(source(year), { signal: controller.signal, cache: 'no-store' });
          if (!response.ok) continue;
          const payload = await response.json();
          if (!payload || !Array.isArray(payload.days)) continue;
          const days = payload.days
            .filter((day) => day && day.isOffDay === true && typeof day.date === 'string')
            .map((day) => day.date);
          if (days.length > 0) return days;
        } catch (error) {
          /* 网络不可达 / 被墙 / 超时：换下一个源。 */
        } finally {
          clearTimeout(timer);
        }
      }
      return null;
    }

    function isPeak(parts, holidays) {
      if (!WORKDAYS.includes(parts.weekday)) return false;
      if (holidays.has(parts.dateKey)) return false;
      return PEAK_WINDOWS.some(([start, end]) => parts.minutes >= start && parts.minutes < end);
    }

    /**
     * 工具行左侧的那颗小圆点。自身持有 15 秒心跳与按年的节假日刷新，
     * 卸载时随 effect 清理；不读取任何其他插件的状态。
     */
    function PeakDot() {
      const [now, setNow] = React.useState(() => Date.now());
      const [year, setYear] = React.useState(() => beijingParts(new Date()).year);
      const [holidays, setHolidays] = React.useState(() => holidaysFor(beijingParts(new Date()).year));

      React.useEffect(() => {
        const timer = setInterval(() => {
          setNow(Date.now());
          setYear(beijingParts(new Date()).year);
        }, TICK_MS);
        return () => clearInterval(timer);
      }, []);

      React.useEffect(() => {
        let alive = true;
        const cached = readCache(year);
        if (cached) setHolidays(new Set(cached.days));
        else setHolidays(holidaysFor(year));
        if (cached && Date.now() - cached.at < CACHE_TTL_MS) return () => { alive = false; };
        fetchHolidays(year).then((days) => {
          if (!alive || !days) return;
          writeCache(year, days);
          setHolidays(new Set(days));
        });
        return () => { alive = false; };
      }, [year]);

      const peak = isPeak(beijingParts(new Date(now)), holidays);
      return h(
        'span',
        {
          role: 'img',
          'aria-label': peak ? '高峰时段' : '空闲时段',
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '22px',
            height: '24px',
            flex: '0 0 auto',
          },
        },
        h('span', {
          style: {
            width: '9px',
            height: '9px',
            borderRadius: '999px',
            background: peak ? PEAK_COLOR : OFFPEAK_COLOR,
            boxShadow: RING,
          },
        }),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'deepseek-offpeak-indicator',
          order: 0,
        }, PeakDot));
      },
    };
  },
});
