# Ryugi Monitor

插件为 Paseo 会话提供隔离的 Ryugi 工件 CLI 和完整 workflow skills。Agent 创建工件后，评论、方案选择、问答提交及撤回通过本机 socket 通知对应 Agent 继续处理。传输确认不代表反馈已经处理。时间线中的 monitor 通知默认折叠为摘要，点击可展开原始内容；Agent 仍收到完整通知。通知摘要和工件入口随 Paseo 语言在中英文间切换，其他语言回退英文；评论正文与原始通知保留原文。

输入框上方支持文档、画板、HTML、幻灯片、白板、验证报告、数据报告和分镜入口，仅在当前会话存在对应工件时显示，每类一个入口，点击直接打开工件地址。幻灯片对应 Ryugi 的 `slides` 类型，主文件为 HTML，并非 PowerPoint `.pptx` 文件。Agent 不自动打开或操作浏览器，不需要各 Agent 的 Ryugi hook 或 Paseo Hub Triggers。

安装插件：

```bash
paseo plugin install git:zwmmm/ryugi-paseo-plugin
```

需要 Paseo 0.17.3 及以上、Node.js、npm 和 Git。首次安装需要联网下载固定版本 `ryugi-artifacts@1.108.1`、固定提交的 full skills 和受支持平台的 cloudflared；插件安装的 build 步骤自动准备运行时。本地目录开发先运行：

```bash
npm install
npm run setup:runtime
npm run typecheck
npm test
```

运行时位于 `~/.paseo/ryugi-runtime/1.108.1`，可通过启动插件进程前设置 `PASEO_RYUGI_RUNTIME_DIR` 调整。底层 CLI 位于 `node_modules/ryugi-artifacts/dist/cli.cjs`，完整技能位于 `workflow/skills`，服务状态位于 `state/server`。主服务候选端口为 27419–27421，画板服务候选端口为 27429–27431，Unix socket 使用独立目录。每个工作区的工件位于 `projects/<工作区绝对路径的 SHA256 前16位>/.ryugi/artifacts`。

## 从其他设备打开工件

在运行会话的 Paseo 宿主上，打开插件的「远程访问工件」设置并输入访问密码，停止输入后自动保存。也可在同一设置页点击「开启 Ryugi 隧道」，提前启动宿主的 Ryugi 服务和隧道。远程客户端点击原会话入口时，插件会按需启动 TryCloudflare，并打开临时 HTTPS 链接。同机探测成功时直接打开本机链接。两种路径都使用插件的浏览器打开方式。密码验证通过后，公网域名转发整个 Ryugi 主端口，包括其他会话的工件、内嵌资源、HTTP API 和 WebSocket。访问域名根路径会打开 Ryugi 的主页。

cloudflared 由插件安装流程从官方发布下载，校验 SHA-256 后放入私有运行时。cloudflared 自动下载覆盖 macOS 和 Linux 的 x64/arm64，以及 Windows x64。实际转发端口来自 Ryugi 启动结果，代理端口由操作系统分配。同一宿主、同一 Ryugi 端口下的工件共用一个公网域名，各自保留页面路径。此宿主生成的远程工件链接共用这个密码，同一隧道的浏览器登录状态可复用。「远程访问工件」设置里的「关闭 Ryugi 隧道」可让当前宿主的隧道链接立即失效，之后从远程客户端点击会话入口会生成新地址。更改密码也会结束现有隧道，清空密码会关闭远程访问。宿主和插件需在线，隧道进程重启后再次点击入口可取得新地址。

## 会话运行时

插件不运行 Ryugi launcher，不安装宿主 hook，不修改用户 PATH 或 Agent 配置，也不向用户全局 skill 目录安装文件。每次交互会话打开时，插件临时注入 full skills 索引和绝对路径，并提供 `ryugi` 工具。Agent 按阶段直接读取技能文件，通过工具操作私有工件目录；项目组件与设计规范仍从实际源码工作区读取。默认按上游 `using-ryugi` 自动路由新需求、设计、实现和问题排查，无需明确提到 Ryugi；普通问答和只读检查不进入工作流。用户指令和项目规范优先。

新建会话可直接说：“开发一个新需求：……”或“设计一个新功能：……”。插件重载后，空闲会话会在下次发送消息前重新打开并获得工具和指令，正在执行的轮次不会被打断。原用户 Ryugi 的工件不会自动迁移到私有目录。

会话绑定来自工具启动工件及 Agent 实际交付的本机地址。同一工件被多个会话引用时，各绑定会话都会接收通知。客户端退出不会停止已有 monitor；插件重载后在会话恢复、完成一轮或界面同步时重建绑定。文档、画板入口由文件事件刷新，60 秒查询仅作入口刷新兜底，反馈通知通过 socket 主动推送。

Ryugi Monitor 是面向 Paseo 的独立集成。Ryugi 工件工具、工作流和标识来自 [Innei/ryugi](https://github.com/Innei/ryugi)。
