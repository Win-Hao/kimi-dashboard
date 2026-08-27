# kimi-dashboard — SPEC v1

状态：Draft · 2026-08-27
目标读者：本项目实现者与外部贡献者

---

## 1. 是什么

把官方额度（5h / 7d / 加油包）从「敲命令才看得到」变成
「底栏常驻可见」。

这是唯一的价值主张，它直接对应 kimi-code 的一处空白：

| 数据 | kimi-code 原生 | 是否常驻 |
|---|---|---|
| context 占用 | footer 第 2 行 | ✅ 已常驻 |
| 5h / 7d 额度 | `/usage` 面板 | ❌ 要手敲 |
| 加油包余额 | `/usage` 面板 | ❌ 要手敲 |
| 运行时状态 | `/status` 面板 | ❌ 要手敲 |

底栏槽位 `items` 的合法值只有七个，
`mode goal model tasks cwd git tips`，**没有 quota**，
footer 源码全文也不出现 quota——额度进不了底栏。

**因此：额度是卖点，context 是搭头。** 见 §6.4 与 §7 的取舍顺序。

三条设计原则，贯穿全文，冲突时按此顺序取舍：

1. **零配置** — 装完即用，配置文件全部可选
2. **零依赖** — 无运行时依赖，打包成单文件
3. **零常驻** — 不用时一个进程都不存在

### 非目标（v1 明确不做）

- 历史报表、热力图、成本分析（留给 v2，见 §11）
- 支持 Kimi 以外的任何 CLI
- GUI、菜单栏、托盘、Web 面板
- 修改或代理 kimi-code 的任何行为

---

## 2. 数据源（已在 kimi-code 源码与本机验证）

```
① statusline stdin payload
   来源：kimi-code 主动喂给你的 JSON
   成本：0（进程启动即到手）

② 官方额度 GET {base}/usages
   base 默认 https://api.kimi.com/coding/v1
   可被 KIMI_CODE_BASE_URL 覆盖
   成本：一次网络往返（~200-800ms）

③ OAuth 凭证
   ~/.kimi-code/credentials/<provider>.json  0600
   本项目对它 **只读，永不写**（见 §6.2）

④ 会话 token 明细（v1 不用，v2 用）
   ~/.kimi-code/sessions/wd_<proj>_<hash>/
     session_<uuid>/agents/main/wire.jsonl
```

### 2.1 ① 的字段（固定，来自 `StatusLinePayload`）

```json
{
  "model": "kimi-k2",
  "cwd": "/Users/you/proj",
  "gitBranch": "main",
  "permissionMode": "auto",
  "planMode": false,
  "contextUsage": 0.32,
  "contextTokens": 64000,
  "maxContextTokens": 200000,
  "sessionId": "session_xxx",
  "version": "1.2.3"
}
```

注意：**没有额度字段，也没有 context 分项拆解**。
额度必须走 ②。分项拆解 kimi-code 自己也没有，v1 不做。

### 2.2 ② 的返回体（原始 wire format）

```json
{
  "usage":  { "used": "40", "limit": "1000",
              "resetTime": "2026-08-03T05:20:51Z" },
  "limits": [
    { "window": { "duration": 300,
                  "timeUnit": "TIME_UNIT_MINUTE" },
      "detail": { "used": "1", "limit": "100",
                  "resetTime": "..." } }
  ],
  "boosterWallet": { "balance": { "type": "BOOSTER",
                                  "amount": ..., "amountLeft": ... },
                     "monthlyChargeLimit": { "priceInCents": ...,
                                             "currency": "CNY" } }
}
```

解析必须处理的三个坑：

| 坑 | 表现 | 处理 |
|---|---|---|
| 数字是字符串 | `"used": "40"` | 全部走 `parseInt` |
| 枚举是 proto 风格 | `TIME_UNIT_MINUTE` | 映射到 minute/hour/day/week |
| 顶层 usage 无 window | `usage` 缺 window | 补 `{1, week}`，它就是周额度 |

加油包金额是 **定点数**：`amount / 1_000_000` 得到「分」，
且 `0 < x < 1` 时向上取整为 1（避免显示成 0）。
`monthlyChargeLimit.priceInCents` 则已经是分，不要再除。

### 2.3 ③ 的磁盘格式（snake_case）

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_at": 1786080229,
  "scope": "...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

`expires_at` 是 **Unix 秒**，不是毫秒。

---

## 3. 架构

```
kimi-code TUI
    │ 每次重绘，最快 1s 一次
    │ sh -c "<command>"，stdin 灌 payload
    ▼
kimi-dashboard statusline      ← 必须 < 300ms
    │
    ├─ 读 stdin           ~1ms
    ├─ 读 quota 缓存文件   ~1ms   ← 纯本地，不碰网络
    ├─ 渲染并 println     ~1ms
    │
    └─ 若缓存过期 → detach 一个后台进程去刷新
                    自己不等它，立刻返回
                              │
                              ▼
                  kimi-dashboard refresh
                    读凭证 → GET /usages → 写缓存
```

**核心设计：读写分离。** statusline 路径永不发网络请求。
额度数据由旁路进程异步写入缓存文件，statusline 只读快照。

### 3.1 为什么不是常驻 daemon

常驻 daemon 要 launchd plist / systemd unit，安装即摩擦，
用户卸载时还会留垃圾。改用**惰性自唤醒**：

- statusline 发现缓存 stale → `spawn(detached, stdio:'ignore')` 一个
  refresh 进程 → `unref()` → 自己立刻退出
- 没人用 kimi-code 时，一个进程都不存在

代价是首次冷启动那一两秒看不到额度条（显示 `--`），可接受。

仍然保留 `kimi-dashboard daemon` 子命令给想要常驻的人（§5），
但它不是默认路径，也不写任何开机自启配置。

### 3.2 并发去重

多个 kimi-code 窗口同时开着 → 会有多个 statusline 进程同时
发现 stale → 同时 spawn refresh → 打爆 `/usages`。

用锁文件去重：

```
~/.cache/kimi-dashboard/refresh.lock
```

- refresh 启动时 `open(lock, 'wx')`，已存在则检查 mtime
- mtime 在 30s 内 → 认为有活跃 refresh，直接退出
- mtime 超过 30s → 视为死锁残留，抢占并重写
- 正常结束时删除

不用 `flock`，因为要跨平台且要能识别僵尸锁。

---

## 4. 缓存文件

路径遵循 XDG，macOS 也用同一套（不用 `~/Library/Caches`，
方便用户排查）：

```
$XDG_CACHE_HOME/kimi-dashboard/quota.json
默认 ~/.cache/kimi-dashboard/quota.json
```

Schema（归一化后的 camelCase，不是 wire format）：

```json
{
  "schemaVersion": 1,
  "fetchedAt": 1786080229400,
  "baseUrl": "https://api.kimi.com/coding/v1",
  "ok": true,
  "error": null,
  "summary": {
    "name": "weekly",
    "window": { "duration": 1, "unit": "week" },
    "used": 40, "limit": 1000,
    "resetAt": "2026-08-03T05:20:51Z"
  },
  "limits": [
    { "name": "5h",
      "window": { "duration": 300, "unit": "minute" },
      "used": 1, "limit": 100,
      "resetAt": "2026-08-03T05:20:51Z" }
  ],
  "extraUsage": {
    "balanceCents": 4200, "totalCents": 10000,
    "monthlyChargeLimitEnabled": true,
    "monthlyChargeLimitCents": 20000,
    "monthlyUsedCents": 5800,
    "currency": "CNY"
  }
}
```

写入用 `写 tmp → rename` 保证原子性，
否则 statusline 可能读到半个文件。

`schemaVersion` 不匹配时 statusline 直接当作无缓存处理，
不尝试迁移。

---

## 5. CLI 接口

```
kimi-dashboard statusline     从 stdin 读 payload，输出一行
kimi-dashboard refresh        刷一次额度写缓存（供内部 spawn）
kimi-dashboard daemon         可选常驻，按 interval 循环 refresh
kimi-dashboard setup          写 tui.toml 的 [status_line]
kimi-dashboard doctor         自检：凭证/缓存/配置/连通性
kimi-dashboard preview        用假数据预览渲染效果（不碰网络）
```

`setup` 的行为：读 `~/.kimi-code/tui.toml`，
在 `[status_line]` 段写入 `command = "kimi-dashboard statusline"`。
已存在其他 command 时**必须提示并要求确认**，不静默覆盖。

`preview` 的存在意义：贡献者改渲染逻辑时不需要有 Kimi 账号。

---

## 6. 硬约束

### 6.1 时间预算

| 常量 | 值 | 后果 |
|---|---|---|
| 超时上限 | 300ms | 超时返回 null，footer 回落内置布局 |
| 重跑间隔 | 1000ms | 每秒最多被调一次 |
| stdout 截取 | 第一行 | 多行输出后面的被丢弃 |
| 捕获上限 | 64KB | — |

Node 冷启动 40-80ms 是主要开销。因此：

- 入口文件必须是**打包后的单文件**，不做运行时 `require` 遍历
- 禁止任何运行时依赖（chalk 之类自己写 20 行 ANSI 替代）
- 禁止在 statusline 路径读 `wire.jsonl`（文件可能很大）
- 目标：p99 < 150ms

CI 里加一条基准测试守住这个数，回归就红。

### 6.2 凭证安全（最重要的一条）

**kimi-dashboard 对 credentials 目录只读，永不写、永不刷新 token。**

理由：kimi-code 的 token 事务是 **进程内** 串行化的
（`OAuthTokenTransaction` 注释原文：
"Serializes OAuth token grants for one credential identity in this process"），
**没有跨进程文件锁**。外部进程若执行 refresh，会拿到轮换后的
新 refresh_token 并写回文件，与 kimi-code 正在进行的刷新互相
覆盖，最坏情况把用户踢下线，需要重新 `/login`。

这是把用户账号搞坏的路径，不接受任何「小心一点就行」的辩解。

具体规则：

1. 只 `readFileSync` 凭证，读完立刻只保留 `access_token` 与
   `expires_at`，其余字段（尤其 `refresh_token`）不进内存变量、
   不进日志、不进错误信息
2. `expires_at <= now + 60s` → 判定为过期，**不刷新**，
   直接返回「凭证已过期」，缓存保留旧值并标记 stale
3. 任何日志、`doctor` 输出、崩溃堆栈都不得包含 token 片段
4. CI 加一条测试：断言进程从不以写模式打开 credentials 目录

过期时的用户提示：`额度不可用 · 请在 kimi-code 中继续使用以刷新凭证`。
kimi-code 自己下次发请求时会刷新，我们搭便车即可。

### 6.3 失败一律降级，永不报错

statusline 在任何异常下都必须输出**一行有效内容**：

| 情况 | 输出 |
|---|---|
| 缓存不存在 | 额度位显示 `--`，其余段正常 |
| 缓存 stale | 额度条正常显示但加 `~` 前缀标记 |
| 凭证缺失 | 额度位显示 `no auth` |
| stdin 非法 JSON | 输出空字符串，让 footer 回落 |
| 渲染逻辑抛异常 | 顶层 catch，输出空字符串 |

绝不 `process.exit(1)`，绝不写 stderr（kimi-code 忽略 stderr，
但脏输出会污染用户终端的其他工具）。

### 6.4 宿主只让出一行

footer 的 `render()` 固定返回两行，我们只拿得到第一行：

```
line 1   ← 自定义 command 的 stdout 顶替这里
         （未配置时是 items 槽位组合）

line 2   ← 无条件渲染，在 if/else 之外，关不掉
         左：warning hint
         右：context: 32% (64.0k/200.0k)
```

推论有两条，都是硬约束：

1. **context 默认不渲染**。line 2 已经有一个 context 百分比，
   我们再画一个就是同屏两份，用户还挡不掉。
   context 只作为 opt-in 段位存在（§8），默认关。
2. **输出只有一行**。多行的第二行及以后会被宿主直接丢弃，
   不要设计任何两行布局。

---

## 7. 渲染

宽度自适应，按优先级从右往左裁剪。
顺序由 §1 的价值主张决定：额度永远排在装饰位前面。

```
优先级 1  5h 额度条           永不裁
优先级 2  7d / 周额度条
优先级 3  加油包余额（仅在启用了加油包时出现）
优先级 4  model
优先级 5  git branch
优先级 6  cwd
优先级 7  context 条（默认关，见 §6.4）
```

窄终端（< 60 列）只保留优先级 1。
额度一个都放不下时才输出空字符串让 footer 回落。

默认布局：

```
5h ███░ 18%   7d ██░ 9%   kimi-k2  main
```

启用 context 段位后（opt-in，会和 line 2 重复）：

```
5h ███░ 18%   7d ██░ 9%   ctx ██████░░ 32%   kimi-k2
```

颜色分档与 kimi-code 内置一致，避免视觉割裂：

```
< 60%   绿
60-85%  黄
> 85%   红
```

真彩色不可用时（`NO_COLOR` 或 `TERM=dumb`）降级为纯文本，
进度条字符也切换为 ASCII `#` / `-`。

**未定项**：进度条字符集、百分比是否显示绝对 token 数。
先按上面实现，发布前用 `preview` 肉眼对比再定。

---

## 8. 配置

`$XDG_CONFIG_HOME/kimi-dashboard/config.toml`，全部可选：

```toml
# 默认值。"ctx" 不在其中，加进来才会渲染（§6.4）
segments = ["5h", "7d", "booster", "model", "git"]
refreshIntervalMs = 120000     # 缓存 TTL
staleAfterMs = 600000          # 超过则标额度为 stale
ascii = false
barWidth = 10
```

可用段位：`5h` `7d` `booster` `model` `git` `cwd` `ctx`。

无配置文件时全部走默认值。**不需要配置就能用**是硬要求。

---

## 9. 目录结构

```
kimi-dashboard/
  SPEC.md
  README.md            中英双语
  LICENSE              MIT
  package.json         bin: kimi-dashboard
  tsup.config.ts       打包成单文件 ESM
  src/
    cli.ts             子命令分发
    statusline.ts      热路径，依赖最少
    render.ts          纯函数，好测
    quota/
      fetch.ts         GET /usages
      parse.ts         wire → 归一化（照抄 §2.2 三个坑）
      cache.ts         原子读写
      creds.ts         只读凭证
    setup.ts
    doctor.ts
  test/
    fixtures/          真实脱敏 payload
```

`render.ts` 必须是纯函数 `(state) => string`，
这样绝大部分测试不需要文件系统和网络。

---

## 10. 开源工程

- License：MIT
- 分发：npm `kimi-dashboard`，主推 `npx kimi-dashboard setup`
- Node 版本下限：20（kimi-code 本身要求即在此之上）
- CI：lint + test + 冷启动基准，三平台矩阵
  （ubuntu / macos / windows）
- 版本：SemVer，`schemaVersion` 与包版本解耦
- 明确声明：非 Moonshot 官方项目，README 顶部即写

**上游兼容风险**：`StatusLinePayload` 与 `/usages` 都是
kimi-code 的内部契约，可能随版本变动。缓解措施：

- 解析全部走宽松模式，缺字段降级而非抛错
- `doctor` 命令输出实际收到的 payload 字段名，
  用户报 issue 时直接贴出来即可定位

---

## 11. 里程碑

额度是唯一卖点，所以它必须在第一个版本里，
不能先发一个和 line 2 重复的 context 条充数。

```
v0.1  额度条打通全链路
      statusline + refresh + cache + creds + 锁文件
      + preview + setup
      验收 1：底栏常驻显示 5h / 7d，数字与 /usage 一致
      验收 2：断网、缺凭证、过期凭证三种情况都不炸
      验收 3：真实 kimi-code 里 p99 < 150ms

v0.2  装饰段位：model / git / cwd / ctx(opt-in)
      + 窄终端裁剪 + 配置文件
      验收：60 列终端下额度条完好

v0.3  doctor + 三平台 CI 全绿

v1.0  README 双语 + npm 发布

v2    report 子命令：扫 wire.jsonl 出按天/项目/模型的报表
      与 statusline 完全解耦，可独立演进
      ⚠ 需求尚未验证，v1 发布收到真实反馈后再决定是否做
```

---

## 12. 待确认

1. 进度条字符集与是否显示绝对 token 数（§7）
2. 是否需要 `KIMI_CODE_HOME` 环境变量覆盖（kimi-code 支持，
   我们是否跟进）

已确认：包名 `kimi-dashboard`，npm 可用。
