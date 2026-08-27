---
name: doctor
description: 自检 kimi-dashboard：凭证、缓存、配置、连通性、底栏配置
---

**直接执行，不要探索。** 本文件已包含全部所需信息：不要读取任何文件、不要查看源码或其他命令文件、不要先运行 `--help`、不要 `ls`。除了下面列出的命令，不要执行任何其他工具调用。命令和参数以本文件为准。

用 Shell 运行：

```sh
node "${KIMI_CODE_HOME:-$HOME/.kimi-code}/plugins/managed/kimi-dashboard/dist/cli.js" doctor
```

把每一行的 ✔ / ✖ 结果用中文解释给用户，并针对 ✖ 给出下一步：

- `credential ✖ … expired / missing`：让用户在 kimi-code 里执行 `/login`（本插件只读凭证，永远不会替用户刷新 token）。
- `tui.toml ✖`：执行 `/kimi-dashboard:setup`。
- `connectivity ✖`：检查网络或 `KIMI_CODE_BASE_URL`。
- `cache` 显示 not written yet：正常，底栏第一次渲染后才会出现。

输出里绝不会包含 token；不要去读 credentials 目录下的文件内容。
