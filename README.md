# Ryugi Monitor

插件为 Paseo 会话提供隔离的 Ryugi 工件 CLI 和完整 workflow skills。Agent 创建工件后，评论、方案选择、问答提交及撤回通过本机 socket 通知对应 Agent 继续处理。传输确认不代表反馈已经处理。时间线中的 monitor 通知默认折叠为摘要，点击可展开原始内容；Agent 仍收到完整通知。通知摘要和工件入口随 Paseo 语言在中英文间切换，其他语言回退英文；评论正文与原始通知保留原文。

输入框上方仅在当前会话存在对应工件时显示文档、画板入口，点击直接打开工件地址。Agent 不自动打开或操作浏览器，不需要各 Agent 的 Ryugi hook 或 Paseo Hub Triggers。

安装插件：

```bash
paseo plugin install npm:ryugi-paseo-plugin@0.1.0
```

需要 Paseo 0.17.3 及以上、Node.js、npm 和 Git。首次安装需要联网下载固定版本 `ryugi-artifacts@1.108.1` 与固定提交的 full skills；插件安装的 build 步骤自动准备运行时。本地目录开发先运行：

```bash
npm install
npm run setup:runtime
npm run typecheck
npm test
```

运行时位于 `~/.paseo/ryugi-runtime/1.108.1`，可通过启动插件进程前设置 `PASEO_RYUGI_RUNTIME_DIR` 调整。底层 CLI 位于 `node_modules/ryugi-artifacts/dist/cli.cjs`，完整技能位于 `workflow/skills`，服务状态位于 `state/server`。主服务候选端口为 27419–27421，画板服务候选端口为 27429–27431，Unix socket 使用独立目录。每个工作区的工件位于 `projects/<工作区绝对路径的 SHA256 前16位>/.ryugi/artifacts`。

插件不运行 Ryugi launcher，不安装宿主 hook，不修改用户 PATH 或 Agent 配置，也不向用户全局 skill 目录安装文件。每次交互会话打开时，插件临时注入 full skills 索引和绝对路径，并提供 `ryugi` 工具。Agent 按阶段直接读取技能文件，通过工具操作私有工件目录；项目组件与设计规范仍从实际源码工作区读取。默认按上游 `using-ryugi` 自动路由新需求、设计、实现和问题排查，无需明确提到 Ryugi；普通问答和只读检查不进入工作流。用户指令和项目规范优先。

新建会话可直接说：“开发一个新需求：……”或“设计一个新功能：……”。插件重载后，空闲会话会在下次发送消息前重新打开并获得工具和指令，正在执行的轮次不会被打断。原用户 Ryugi 的工件不会自动迁移到私有目录。

会话绑定来自工具启动工件及 Agent 实际交付的本机地址。同一工件被多个会话引用时，各绑定会话都会接收通知。客户端退出不会停止已有 monitor；插件重载后在会话恢复、完成一轮或界面同步时重建绑定。文档、画板入口由文件事件刷新，60 秒查询仅作入口刷新兜底，反馈通知通过 socket 主动推送。
