# dsh-deepseek-offpeak-indicator

**在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）Web GUI 里一眼看出当前 DeepSeek API 的计费时段。**

输入框工具行最左侧常驻一颗 5px 小圆点（**仅当当前会话选中的模型 provider 属于 DeepSeek 时才渲染**）：

| 颜色 | 时段 | 价格 |
| --- | --- | --- |
| 🟡 黄 `#f2b705` | 高峰时段 | 标准价 |
| 🟢 绿 `#22c55e` | 空闲时段 | 半价 |

除颜色外不显示任何文字、图标或占位文案（圆点带 `aria-label`，屏幕阅读器可读）。
不需要构建步骤，也不依赖任何第三方库；全部逻辑在一个单文件里。

[English](README.en.md) | 中文

## 显示条件

只有当前会话选中的模型 provider 属于 DeepSeek 时才渲染；其余情况下彻底不渲染，不占位：

| provider | 显示 |
| --- | --- |
| `deepseek-official`（DeepSeek 官方 API Key） | ✅ |
| `deepseek-account`（DeepSeek 账号） | ✅ |
| 其他（Anthropic、OpenAI 兼容中转、自建网关……） | ❌ 不渲染 |
| 未知（模型目录尚未加载完） | ❌ 不渲染 |

只看 provider，不看模型名——第三方中转即便转发的是 DeepSeek 模型，也不适用 DeepSeek 的分时计价。
判定逻辑是 `isDeepSeekProvider()`，想改口径只动这一个函数。

## 判定规则

依据 DeepSeek 官方定价说明（[模型 & 价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)）：

- **高峰时段**：北京时间**周一至周五**（不含中国法定节假日）**9:00–12:00**、**14:00–18:00**；
- **空闲时段**：其余全部时间，**包括周末与法定节假日全天**（空闲价 = 高峰价的一半）。

边界按左闭右开处理：12:00 与 18:00 整点即进入空闲时段，9:00、14:00 整点即进入高峰时段。
时间一律按 `Asia/Shanghai` 计算，改本机时区不影响结果。

> **关于"调休上班的周末"**：官方原文是"周一至周五……其余时段，包括周末及中国法定节假日
> 全天均为空闲时段"，因此调休上班的周六/周日仍按空闲时段（绿色）处理。若你认为应当算高峰，
> 改 `client.js` 里的 `WORKDAYS` 判定即可。

## 安装

前置：一个可用的 DSH profile（桌面版或 `dsh web` 均可），并且已能正常启动会话。

1. 克隆到本地：

   ```bash
   git clone https://github.com/cumthugo/dsh-deepseek-offpeak-indicator.git
   ```

2. 把**克隆下来的绝对路径**装进 profile。在 DSH 会话里让 Agent 执行：

   ```
   plugin_manager  action=install_bundle  target=/绝对路径/dsh-deepseek-offpeak-indicator
   ```

   或在 GUI 的**插件**页面里选择"从本地目录安装"。安装器会自动：
   在 profile 的 `package.json` 里写入 `link:` 依赖、把它加入 `dsh.profile.bundles`，
   并按本仓库自带的 `cordis.patch.yml` 插入 Loader 条目。

3. 结果是 `application: applied` 就立刻生效（当前页面无需刷新）；若返回
   `restart-required`，重启 Harness 即可。

### 直接从 GitHub 安装（免克隆）

让安装器直接从仓库拉取也可以，profile 里会记成 git 依赖：

```
plugin_manager  action=install_bundle  target=github:cumthugo/dsh-deepseek-offpeak-indicator
```

安装前安装器会对 GitHub 仓库做一次 `git ls-remote` 连通性检查（公开仓库无需凭据）。
想锁定版本就写死提交号或分支：`github:cumthugo/dsh-deepseek-offpeak-indicator#<commit-sha>`。
注意 git 安装下来的是一份快照副本，**更新同样要走 remove → install**；要可复现就固定 commit sha。

**更新**：对同一个本地路径**重复安装不会生效**——依赖没变化，安装器会报
`ambiguous-install`。`git pull` 之后要走"先移除、再安装"这一趟：

```
plugin_manager  action=remove_bundle  target=@local/dsh-deepseek-offpeak-indicator
plugin_manager  action=install_bundle target=/绝对路径/dsh-deepseek-offpeak-indicator
```

宿主会重新读取 bundle 并通知页面热更新，无需重启。GUI 插件页里的"卸载 → 安装"同理。
（只想让改动生效而不卸载的话，也可以改一下 `package.json` 的 `version` 让依赖串变化，但不如
上面这条可靠。）
**停用/卸载**：在 GUI 插件页关闭该条目，或让 Agent 执行 `plugin_manager` 的
`remove_bundle`（包名 `@local/dsh-deepseek-offpeak-indicator`）。

> 包名保持 `@local/dsh-deepseek-offpeak-indicator`——这是 DSH 对本地 workspace bundle 的
> 约定作用域（官方插件模板同样用 `@local/`），与仓库名不同不影响使用。它没有发布到 npm，
> 安装走的就是上面的本地路径方式。

## 节假日数据与自动更新

节假日只用于"把放假日从高峰里排除"，共三层来源，按优先级取用：

1. **本地缓存**：`localStorage` 的 `dsh-deepseek-offpeak-indicator:holidays:<年>`，30 天内视为新鲜；
2. **联网刷新**：[holiday-cn](https://github.com/NateScarlet/holiday-cn)（自动抓取国务院办公厅
   放假安排）的年份 JSON，依次尝试 `raw.githubusercontent.com` 与 `cdn.jsdelivr.net`，6 秒超时；
3. **内置兜底**：`client.js` 里的 `BUILTIN_HOLIDAYS`（当前含 2026 年，33 个放假日）。

因此**次年安排一公布就会自动生效，无需改代码**——前提是机器能访问上述两个地址之一。
完全离线时回落到内置表；若某年既无缓存也无内置数据，则退化为"只按周末判断"（该年节假日的
9:00–12:00 / 14:00–18:00 会被误判为高峰）。

想离线更新内置表：

```bash
node tools/update-holidays.mjs            # 刷新已有年份 + 今年和明年
node tools/update-holidays.mjs 2027       # 只刷新指定年份
```

改完按上面的"更新"流程走一趟（remove → install），页面才会用上新的内置表。

## 文件结构

| 文件 | 作用 |
| --- | --- |
| `package.json` | bundle 清单：`dsh.bundle.patch` 指向补丁，`dsh.client` 声明浏览器半边 |
| `cordis.patch.yml` | 向 profile 插入一行 `deepseek-offpeak-indicator` 条目 |
| `index.js` | Host 半边，空 `apply()`（仅为让 Loader 有对应条目） |
| `client.js` | 浏览器半边：时段判定 + 圆点组件 + 槽位注册（单文件、无构建） |
| `tools/update-holidays.mjs` | 重新生成内置节假日表 |
| `tools/test-classify.mjs` | 时段判定逻辑的回归测试（16 个用例） |

## 自定义

都在 `client.js` 顶部：

- `PEAK_WINDOWS`：高峰区间（当日分钟数）；
- `PEAK_COLOR` / `OFFPEAK_COLOR`：两种颜色；
- `DOT_SIZE`：圆点直径（默认 `5`）；
- `DEEPSEEK_PROVIDER_IDS` / `isDeepSeekProvider()`：哪些 provider 算 DeepSeek；
- 槽位名：默认 `conversation.input.left`（输入框工具行左侧）。换成
  `conversation.input.right`（右侧）、`conversation.composer.dock`（输入框下方通栏）等，
  只需改 `ctx.slots.register` 里的 `name`，并把 `id` 一并调整。

## 开发

```bash
node tools/test-classify.mjs   # 时段判定回归测试，应输出"全部通过"
node --check client.js         # 语法检查
```

`client.js` 是浏览器半边的完整产物：它用 `window.__ModuleLoader__.load({ id, factory })`
注册一个惰性工厂，`id` 必须等于 `package.json` 的包名。React 由宿主的模块表提供
（`require('react')`），因此不需要也不应自带 React。改动后按上面的"更新"流程走一趟生效。

## 兼容性

在 **macOS + DSH 桌面版 0.2.0-rc.2** 上开发并验证（`install_bundle` 返回
`application: applied`，`conversation.input.left` 槽位占用项 `active: true`）。
插件只用到槽位注册与 React，理论上兼容同代 DSH；DSH 若调整槽位名或 `dsh.client`
清单约定，需要跟着改。

## 免责声明

这是非官方插件，与 DeepSeek 无隶属关系。计费时段与价格以
[官方定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)为准；若规则调整，
本项目需要相应更新。节假日数据来自第三方汇总，可能存在延迟或误差。

## License

[MIT](LICENSE) © 2026 ZhangYong (cumthugo)
