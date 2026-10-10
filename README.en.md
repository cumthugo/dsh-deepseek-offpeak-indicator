# dsh-deepseek-offpeak-indicator

**See the current DeepSeek API pricing window at a glance in the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) Web GUI.**

A single 5px dot sits at the far left of the composer tool row (**rendered only when the
session's selected model provider is DeepSeek**):

| Color | Window | Price |
| --- | --- | --- |
| 🟡 Yellow `#f2b705` | Peak hours | Standard |
| 🟢 Green `#22c55e` | Off-peak hours | Half price |

Nothing else is rendered — no text, no icon, no placeholder copy (the dot carries an
`aria-label` for screen readers). No build step, no third-party dependencies: the whole
plugin is one file.

English | [中文](README.md)

## When it shows

The dot renders only while the session's selected model provider is DeepSeek; otherwise it
renders nothing at all and takes no space:

| Provider | Shows |
| --- | --- |
| `deepseek-official` (DeepSeek API key) | ✅ |
| `deepseek-account` (DeepSeek account) | ✅ |
| Anything else (Anthropic, an OpenAI-compatible gateway, a self-hosted proxy, …) | ❌ hidden |
| Unknown (model directory still loading) | ❌ hidden |

The provider is what counts, not the model name — a third-party gateway serving a DeepSeek
model does not get DeepSeek's time-of-day pricing. The rule lives in `isDeepSeekProvider()`;
change that one function to change the policy.

## How the window is decided

Per DeepSeek's official pricing page
([Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)):

- **Peak**: Beijing time **Monday–Friday** (excluding Chinese statutory holidays),
  **09:00–12:00** and **14:00–18:00**;
- **Off-peak**: everything else, **including weekends and statutory holidays all day**
  (off-peak = half of the peak price).

Intervals are half-open: 12:00 and 18:00 sharp already count as off-peak, while 09:00 and
14:00 sharp count as peak. All comparisons use `Asia/Shanghai`, so the machine's own time
zone does not matter.

> **Make-up workdays.** The official wording is "Monday to Friday … all other periods,
> including weekends and Chinese statutory holidays, are off-peak all day". A Saturday or
> Sunday that the government designates as a make-up workday therefore stays off-peak
> (green) here. Change the `WORKDAYS` check in `client.js` if you disagree.

## Installation

Requires a working DSH profile (desktop app or `dsh web`).

1. Clone the repository:

   ```bash
   git clone https://github.com/cumthugo/dsh-deepseek-offpeak-indicator.git
   ```

2. Install the **absolute path** of the clone into your profile. Ask the agent in a DSH
   session to run:

   ```
   plugin_manager  action=install_bundle  target=/absolute/path/to/dsh-deepseek-offpeak-indicator
   ```

   The installer writes a `link:` dependency into the profile's `package.json`, adds the
   package to `dsh.profile.bundles`, and inserts the loader row declared by this
   repository's own `cordis.patch.yml`.

3. `application: applied` means it is live immediately (no page refresh). If it reports
   `restart-required`, restart Harness.

### Installing straight from GitHub (no clone)

The installer can also pull the repository itself; the profile then records a git
dependency:

```
plugin_manager  action=install_bundle  target=github:cumthugo/dsh-deepseek-offpeak-indicator
```

Before installing, the manager runs a `git ls-remote` reachability check against the GitHub
repository (public repos need no credentials). Pin a revision with
`github:cumthugo/dsh-deepseek-offpeak-indicator#<commit-sha>`. A git install is a snapshot
copy, so **updates still go through remove → install**; pin a commit sha for reproducibility.

**Update**: re-running the install for the same local path does **not** take effect — the
dependency is unchanged, so the installer reports `ambiguous-install`. After `git pull`,
go through remove-then-install:

```
plugin_manager  action=remove_bundle  target=dsh-deepseek-offpeak-indicator
plugin_manager  action=install_bundle target=/absolute/path/to/dsh-deepseek-offpeak-indicator
```

The host re-reads the bundle and pushes it to the open page, so no restart is needed; the
Plugins page's uninstall → install does the same.
**Disable / uninstall**: toggle the row on the GUI Plugins page, or use `plugin_manager`'s
`remove_bundle` with the package name `dsh-deepseek-offpeak-indicator`.

> The package name matches the repository (`dsh-deepseek-offpeak-indicator`) and is not
> published to npm — install it by local path or from GitHub as shown above. The name must
> match the `id` in `client.js`'s `window.__ModuleLoader__.load({ id })` and the entry `name`
> in `cordis.patch.yml`: change one and all three must change, followed by a reinstall.

## Holiday data and automatic refresh

Holidays are only used to exclude statutory days off from the peak windows. Three sources,
in priority order:

1. **Local cache** — `localStorage` key `dsh-deepseek-offpeak-indicator:holidays:<year>`, considered
   fresh for 30 days;
2. **Network refresh** — the year JSON from
   [holiday-cn](https://github.com/NateScarlet/holiday-cn) (which scrapes the State Council
   holiday notices), trying `raw.githubusercontent.com` then `cdn.jsdelivr.net`, with a 6 s
   timeout;
3. **Built-in fallback** — `BUILTIN_HOLIDAYS` in `client.js` (currently 2026, 33 days off).

So **next year's schedule takes effect automatically once published**, with no code change,
provided the machine can reach one of those two hosts. Fully offline, the built-in table is
used; for a year with neither cache nor built-in data the plugin degrades to a
weekend-only rule (that year's holidays would be misread as peak during 09:00–12:00 and
14:00–18:00).

To refresh the built-in table offline:

```bash
node tools/update-holidays.mjs            # existing years + this year and the next
node tools/update-holidays.mjs 2027       # only the given years
```

Run the remove → install flow above afterwards, so the page picks up the new built-in table.

## Layout

| File | Purpose |
| --- | --- |
| `package.json` | Bundle manifest: `dsh.bundle.patch` and the `dsh.client` declaration |
| `cordis.patch.yml` | Inserts the `deepseek-offpeak-indicator` loader row |
| `index.js` | Host half, empty `apply()` (it exists so the loader has a host row) |
| `client.js` | Browser half: window logic, the dot component, slot registration (one file, no build) |
| `tools/update-holidays.mjs` | Regenerates the built-in holiday table |
| `tools/test-classify.mjs` | Regression tests for the window logic (16 cases) |

## Customizing

Everything lives at the top of `client.js`: `PEAK_WINDOWS`, `PEAK_COLOR` /
`OFFPEAK_COLOR`, `DOT_SIZE` (default `5`), `DEEPSEEK_PROVIDER_IDS` /
`isDeepSeekProvider()` (which providers count as DeepSeek), and the slot name
(`conversation.input.left` by default; other candidates are `conversation.input.right` and
`conversation.composer.dock` — change `name` in `ctx.slots.register` and adjust `id`
accordingly).

## Development

```bash
node tools/test-classify.mjs   # window-logic regression tests ("全部通过" = all passed)
node --check client.js         # syntax check
```

`client.js` is the complete browser artifact: it calls
`window.__ModuleLoader__.load({ id, factory })`, where `id` must equal the package name in
`package.json`. React comes from the host module table via `require('react')`, so the
bundle must not ship its own copy. Run the remove → install flow above after editing.

## Compatibility

Developed and verified on **macOS with DSH desktop 0.2.0-rc.2** (`install_bundle` returned
`application: applied`; the `conversation.input.left` occupant reports `active: true`).
The plugin only uses slot registration and React, so it should work on the same DSH
generation; a change to slot names or the `dsh.client` manifest contract would require an
update here.

## Disclaimer

Unofficial plugin, not affiliated with DeepSeek. Windows and prices follow the
[official pricing page](https://api-docs.deepseek.com/quick_start/pricing); if the rules
change, this project needs to follow. Holiday data comes from a third-party aggregation and
may lag or differ.

## License

[MIT](LICENSE) © 2026 ZhangYong (cumthugo)
