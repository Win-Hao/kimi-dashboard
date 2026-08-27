---
name: setup
description: 接入 kimi-code 底栏并选择显示内容（full / compact / quota / custom）
---

把 kimi-dashboard 接到 kimi-code 底栏并设置显示内容。只通过 CLI 操作，不要手动编辑 tui.toml 或 config.toml；**只看退出码判断结果，不要解读输出文字**。

```sh
CLI="${KIMI_CODE_HOME:-$HOME/.kimi-code}/plugins/managed/kimi-dashboard/dist/cli.js"
```

## 步骤

1. 决定布局：
   - `$ARGUMENTS` 非空 → `node "$CLI" config $ARGUMENTS`（支持 `--preset full|compact|quota` 或 `key=value`，例如 `segments=model,5h,7d,git quotaStyle=bar`）。
   - `$ARGUMENTS` 为空 → 用 AskUserQuestion 问「底栏显示哪种布局？」，选项：**Full（推荐）**：模型·context·token·5h·7d·加油包·月消费·模式·分支·目录·会话时长·版本 / **Compact**：模型·context·token·5h·7d / **Quota**：5h·7d·加油包·月消费·模式·分支 / **Custom**：用户自己列段位。然后 `node "$CLI" config --preset <选择>`（Custom → `config segments=a,b,c`）。AskUserQuestion 不可用（auto 模式）时直接用 `--preset full`。
   - 退出码 1 → 把 stderr 的那一句转述给用户，重新问；不要自己猜。
   - 记下输出最后一行 `preview: ` 后面的内容。
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
