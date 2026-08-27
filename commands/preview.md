---
name: preview
description: 用假数据预览底栏各种状态，不联网
---

用 Shell 运行（`--color` 强制输出颜色），把三行结果原样贴给用户，每行前面只加一个短标签（正常 / 高用量 / 非 Kimi 模型），**不要解释每一段的含义**，除非用户问：

```sh
CLI="${KIMI_CODE_HOME:-$HOME/.kimi-code}/plugins/managed/kimi-dashboard/dist/cli.js"
node "$CLI" preview --color $ARGUMENTS
node "$CLI" preview --color --hot
node "$CLI" preview --color --not-kimi
```

其他开关（用户要求时再用）：`--stale` `--no-auth` `--expired` `--empty` `--bar` `--ascii` `--width N`。想改显示内容用 `/kimi-dashboard:setup`。
