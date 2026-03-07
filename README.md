# Flow

> 接管你的大脑工作记忆负载。让想法不丢、上下文不断、任务可回滚。  
> Offload your working memory. Keep ideas alive, context intact, and progress recoverable.

Flow 是一个面向复杂思考与长期项目的本地优先工具，专注于把零散想法变成可执行的逻辑链。  
Flow is a local-first tool for complex thinking and long-running projects, turning scattered thoughts into executable logic chains.

## 你是否也在这些时刻卡住？ / Do You Get Stuck Here Too?

- 想法很多，但脑内上下文容量有限，切一次任务就断线。  
  Too many ideas, too little working memory. One context switch and the thread is gone.
- 记录分散在文档、便签、聊天里，回看时无法还原当时思路。  
  Notes are scattered across docs, chats, and snippets, making reasoning hard to reconstruct.
- 项目推进到一半被打断，回来后很难从“原来的脑状态”继续。  
  A project gets interrupted halfway, and resuming feels like starting over.

## Flow 如何解决这些痛点 / How Flow Solves This

- **逻辑链与思维流记录 / Logic Chain + Thought Flow Logging**  
  用树状节点组织思路，把复杂问题拆成可追踪的结构。
- **科研思路整理 / Research Reasoning Organizer**  
  每个节点支持标题、摘要、正文，适合假设、证据、结论的逐层整理。
- **工作流断点恢复 / Workflow Breakpoint Recovery**  
  专注模式 + 版本历史 + 本地持久化，让你随时回到上一次有效思考现场。

## 核心特性 / Core Features

- **树状大纲编辑 / Tree-Structured Outline Editing**  
  快速插入、缩进、拖拽节点，搭建你的思维骨架。
- **双视图协同 / Outline + Editor Split View**  
  左侧看结构，右侧写内容，支持横向/纵向分栏切换。
- **专注模式 / Focus Mode**  
  锁定任一节点，仅查看其子树，降低噪音，保持深度思考。
- **状态管理与统计 / Status Tracking + Stats**  
  Waiting / In Progress / Completed / On Hold 一目了然。
- **版本历史回滚 / Version History Rollback**  
  保存关键节点，必要时一键回到稳定版本。
- **导出与备份 / Export + Backup**  
  支持导出 JSON / Markdown，并可直接推送到 GitHub（`main` 分支）。
- **PWA 离线体验 / PWA Offline Experience**  
  可安装为桌面应用，网络不稳定时也能继续工作。

## 快速开始 / Quick Start

**前置要求 / Prerequisites**

- Node.js

**本地开发 / Local Development**

1. 安装依赖 / Install dependencies
   ```bash
   npm install
   ```
2. 在 `.env.local` 设置 `GEMINI_API_KEY`（如需相关能力）  
   Set `GEMINI_API_KEY` in `.env.local` (if required by your workflow).
3. 启动开发环境 / Start dev server
   ```bash
   npm run dev
   ```

## GitHub 备份推送 / GitHub Backup Push

当你需要 `导出 -> 推送到 GitHub`：  
Use this when you need `Export -> 推送到 GitHub`.

1. 确保本机已安装 `git` 且 GitHub 凭据可用。  
   Ensure `git` is installed and GitHub credentials are already available.
2. 同时启动前端与本地 git 备份服务：  
   Start frontend + local git backup service together:
   ```bash
   npm run dev:all
   ```
3. 在应用中打开 `Export -> 推送到 GitHub`，填写仓库地址并开始推送。  
   In app UI, open `Export -> 推送到 GitHub`, fill in repo URL, and push.

备份文件保存在项目根目录 `flow-projects/`，默认推送到 `main` 分支。  
Backup files are stored under `flow-projects/` and pushed to `main`.

## PWA 桌面安装（离线/独立） / PWA Desktop Install (Standalone/Offline)

不要在 `npm run dev` 模式下安装 PWA。  
Do not install the PWA from `npm run dev`.

1. 构建并启动预览服务 / Build and start preview server
   ```bash
   npm run pwa:start
   ```
2. 打开 / Open `http://localhost:4173`
3. 在浏览器地址栏或菜单中安装到桌面。  
   Install to desktop from the browser menu/address bar.

## 适合谁 / Who Is This For?

- 需要长期维护复杂上下文的研究者与学生  
  Researchers and students managing deep, evolving context
- 经常处理中断与切换的开发者、产品和内容创作者  
  Developers, PMs, and creators who frequently context-switch
- 希望把“脑内临时记忆”变成“可追溯外部系统”的任何人  
  Anyone who wants to externalize fragile mental context into a recoverable system

---

如果你正在寻找一个不仅能“记笔记”，更能“接管思维负载”的工具，Flow 就是为你准备的。  
If you need more than note-taking, and want a tool that truly offloads cognitive load, Flow is built for that.
