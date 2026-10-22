# Baton

AI 时代的多线程任务接力工具（自用 MVP）。

同时推进好几件事、在多个 AI 和软件之间来回切换时，用它记住每个线程**做到哪、下一步做什么、提示词怎么写、上一步的结果在哪**。

## 核心概念

- **线程**：一件要推进的事，有目标和完成标准。
- **步骤**：线程里的一步，编号 S1、S2…（排序变了编号也不变）。状态有 待办 / 我在做 / AI 在跑 / 等我审核 / 完成。
- **产物**：步骤的结果（文本或链接）。下游步骤的提示词里写 `{{S1}}` 就能引用 S1 的产物，`{{目标}}` 引用线程目标，点「复制提示词」时自动替换成真实内容。
- **断点卡**：切回线程时看的卡片——停在哪、下一步、卡点、下一步提示词。可以让 AI 根据步骤和记录生成，也可以手写。
- **记录**：线程的时间线，随手记的进展、从剪贴板存进来的内容都在这里，可以一键转成某个步骤的产物。

## 全局快捷键

关掉主窗口后 Baton 仍在菜单栏运行，快捷键在任何软件里都能用：

| 快捷键 | 作用 |
|---|---|
| `⌃⌥B` | 打开「记断点」小窗：选线程、写一句做到哪了，可附带剪贴板内容，保存后可自动让 AI 更新断点卡 |
| `⌃⌥V` | 把剪贴板内容直接存到「当前线程」（最近打开的那个线程，侧栏里带蓝点） |

菜单栏图标旁的数字是「等我审核」的步骤数，点开可以直接跳到对应线程。

## 安装依赖

```bash
npm install
```

如果 Electron 下载失败（需要走代理时），用：

```bash
ELECTRON_GET_USE_PROXY=1 GLOBAL_AGENT_HTTPS_PROXY=http://127.0.0.1:7890 npm install
```

## 开发

```bash
npm run dev
```

用单独的数据目录开发，不影响日常数据：

```bash
BATON_DATA_DIR=/tmp/baton-dev npm run dev
```

## 打包成 App

```bash
npm run build:mac
```

生成 `dist/mac-arm64/Baton.app`，拖进「应用程序」文件夹即可。自用版本没有签名，首次打开如果被拦截，在 Finder 里右键 → 打开。

## AI 断点卡

在「设置」里填 Anthropic API key（在 platform.claude.com 创建，和 Claude 会员订阅分开计费），key 用系统钥匙串加密保存在本机。默认模型是 Claude Opus 5.5，设置里可以换成更便宜的 Haiku 5.5。

请求通过 Electron 的网络栈发出，会自动走系统代理。

## 数据

全部存在本机 `~/Library/Application Support/Baton/`：`baton.db`（SQLite）和 `settings.json`。

## 项目结构

```
src/
  main/       主进程：窗口、菜单栏、快捷键、数据库、AI
  preload/    主进程和界面之间的桥
  renderer/   界面（React）
  shared/     两边共用的类型和提示词展开逻辑
resources/    菜单栏图标
scripts/      生成图标的脚本
```

## 之后可以做

- MCP Server：让 Claude Code、Claude Desktop、Cursor 等工具直接读写线程（汇报进度、读取上一步结果）
- AI 帮忙拆解步骤、整理粘贴进来的长对话
- 纯文本步骤一键交给 AI 执行，中间设审核点
- 依赖关系图视图
