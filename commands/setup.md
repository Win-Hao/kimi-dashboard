---
name: setup
description: 接入 kimi-code 底栏并选择显示内容（full / compact / quota / custom）
---

**直接执行，不要探索。** 本文件已包含全部所需信息：不要读取任何文件、不要查看源码或其他命令文件、不要先运行 `--help`、不要 `ls`。除了下面列出的命令，不要执行任何其他工具调用。命令和参数以本文件为准。

把 kimi-dashboard 接到 kimi-code 底栏并设置显示内容。只通过 CLI 操作，不要手动编辑 tui.toml 或 config.toml；**只看退出码判断结果，不要解读输出文字**。

```sh
CLI="${KIMI_CODE_HOME:-$HOME/.kimi-code}/plugins/managed/kimi-dashboard/dist/cli.js"
```

## 步骤

1. 决定布局：
   - `$ARGUMENTS` 非空 → `node "$CLI" config $ARGUMENTS`（支持 `--preset full|compact|quota` 或 `key=value`，例如 `segments=model,5h,7d,git quotaStyle=bar`）。
   - `$ARGUMENTS` 为空 → 用 AskUserQuestion 问「底栏显示哪种布局？」，选项：**Full（推荐）**：模型·context·token·5h·7d·加油包·月消费·模式·分支·目录·会话时长·版本 / **Compact**：模型·context·token·5h·7d / **Quota**：5h·7d·加油包·月消费·模式·分支 / **Custom**：逐个勾选。然后 `node "$CLI" config --preset <选择>`。AskUserQuestion 不可用（auto 模式）时直接用 `--preset full`。
   - 选了 **Custom** → 再调用一次 AskUserQuestion，一次传 4 个问题，每个问题都设 `multi_select: true`（注意是蛇形 `multi_select`，不是 `multiSelect`）。每题 3 个段位 + 1 个「这组都不要」（kimi-code 每题最多 4 个选项，不要合并成套餐，让用户一个一个勾）：
     1. 「额度要显示哪些？」`5h` 5 小时额度 · `7d` 周额度 · `booster` 加油包余额 · **这组都不要**
     2. 「模型与上下文要显示哪些？」`model` 模型名 · `ctx` context 进度条 · `tokens` 已用/上限 token · **这组都不要**
     3. 「状态要显示哪些？」`spend` 加油包本月消费 · `mode` auto/yolo/plan 模式 · `session` 会话时长 · **这组都不要**
     4. 「环境要显示哪些？」`git` 分支 · `cwd` 目录名 · `version` kimi-code 版本 · **这组都不要**
     「这组都不要」优先：勾了它就忽略同组其他勾选。把结果按固定顺序 model ctx tokens 5h 7d booster spend mode git cwd session version 排好，运行 `node "$CLI" config segments=a,b,c`；四组全是「都不要」时提示至少选一个并重新问。用户想改顺序时，直接按他给的顺序写 `segments=`。
2. 接线：`node "$CLI" setup --self`。退出码 0 → 成功；退出码 2 → tui.toml 里有别的自定义命令，把输出里引号内的那条命令告诉用户，用户同意替换后再跑 `node "$CLI" setup --self --force`。

## 回复格式（严格遵守）

成功时整个回复**只有这三行**，不加任何解释、不复述命令输出、不列可用段位或后续用法：

```
✔ 已接入 · 布局 <Full/Compact/Quota/Custom>
<preview 那一行>
执行 /reload 生效
```

失败时一行说明原因加一行下一步。只有当用户主动问"还能显示什么 / 怎么改"时，才给出下面的参考。

## 参考（仅在被问到时使用）

段位：`model` 模型 · `ctx` context 条 · `tokens` 已用/上限 · `5h` · `7d` · `booster` 加油包余额 · `spend` 加油包月消费 · `mode` auto/yolo/plan · `git` 分支 · `cwd` 目录 · `session` 会话时长 · `version` 版本
其他键：`quotaStyle=text|bar` `separator=pipe|dot|arrow|space` `showReset` `icons` `barWidth` `ascii` `quotaWhenNotKimi=hide|show` `refreshIntervalMs` `staleAfterMs`
