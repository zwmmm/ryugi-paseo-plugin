# Ryugi 快照分享可行性验证

验证日期：2026-11-24。目标是作者离线时，同事仍能查看已发布版本和发表评论，作者上线后再接收反馈。本报告记录源码验证与打包实验；没有执行浏览器自动化，没有验证页面的实际视觉渲染。

## 结论

可实现，但现有 Ryugi CLI 没有已确认的“一键导出完整独立站点”能力。公开旧版具有工件打包、快照数据构建和可复用展示组件，足以支持自建发布器；分享页和云端评论存储、版本绑定、本地导入仍需开发。当前专有应用包与旧版渲染组件的格式兼容性必须实测，不能由旧版源码推定。

## 证据范围

- 旧版源码：`Innei/ryugi` 的 `v1.51.2`，commit `6054b65ab9b2208a234a78632eb065cfeb3eb166`。
- 当前公开 CLI 文档：核对了 [artifacts-cli.md](https://github.com/Innei/ryugi/blob/main/docs/artifacts-cli.md)。文档说明本机服务、Cloud 发布与 Cloud 下载，未说明自托管静态站点导出流程。
- 当前应用许可：[LICENSE](https://github.com/Innei/ryugi/blob/main/LICENSE)明确应用包为专有软件，1.51.2 及以前为 AGPL-3.0-only。不能把旧版可用源码等同于拥有当前发布包的源码或再分发授权。

## 已有能力与缺口

| 环节 | 源码事实 | 对分享功能的影响 |
|---|---|---|
| CLI 导出 | [commands.ts](https://github.com/Innei/ryugi/blob/v1.51.2/artifacts/src/cli/commands.ts)列出 start、stop、check、publish、comment、get、config、update，没有 standalone/static/export 命令 | 需要自己组织发布包，不是添加一个 CLI 参数即可完成 |
| 工件打包 | [pack.ts](https://github.com/Innei/ryugi/blob/v1.51.2/artifacts/src/server/pack.ts)递归收集目录内文件，跳过隐藏文件、评论文件和越出根目录的符号链接 | 本地相对路径资源可以一起打包；远端 URL、localhost API、项目外资源不会自动转换为离线资源 |
| 发布数据 | [publish-payload.ts](https://github.com/Innei/ryugi/blob/v1.51.2/artifacts/src/server/publish-payload.ts)生成画板 canvas/layout/versions；文档从 doc.xml 构造 editor state | 快照不只是复制一个 HTML，需要保存结构化元数据 |
| HTML 运行时 | 同文件的 withCloudRuntime 会注入固定的 UI runtime 地址；[inject.ts](https://github.com/Innei/ryugi/blob/v1.51.2/artifacts/src/server/inject.ts)提供交互、图标等运行时注入 | 使用 Ryugi 自定义组件时，发布器还需携带匹配版本的 runtime 与图标资源并调整地址 |
| 文档展示 | [library/document.ts](https://github.com/Innei/ryugi/blob/v1.51.2/artifacts/src/viewer/library/document.ts)导出 SnapshotDocument；[SnapshotDocument.tsx](https://github.com/Innei/ryugi/blob/v1.51.2/artifacts/src/viewer/document/SnapshotDocument.tsx)采用只读 editor，动态内容通过 contentBase 获取，send 为 no-op | 可复用快照展示，但该组件本身不能实现离线期间新增评论 |
| 画板展示 | [ArtboardView.tsx](https://github.com/Innei/ryugi/blob/v1.51.2/artifacts/src/viewer/layouts/ArtboardView.tsx)接受 canvas、layout、versions、contentBase 和 comment 回调 | 可以接自建评论后端，仍需建立前端应用和静态资源服务 |
| 内容隔离 | [board-origin.ts](https://github.com/Innei/ryugi/blob/v1.51.2/artifacts/src/viewer/lib/board-origin.ts)按内容来源决定 iframe sandbox；[content.ts](https://github.com/Innei/ryugi/blob/v1.51.2/artifacts/src/server/routes/content.ts)设置 CSP 并注入 runtime | 自定义 HTML 应在隔离来源运行，不能直接与带登录权限的评论后台共享可执行环境 |
| 现有 Cloud 评论回流 | [relay-requests.ts](https://github.com/Innei/ryugi/blob/v1.51.2/artifacts/src/server/relay-requests.ts)将 comment 请求交给本机 boardComments/documents 处理 | 证明有回流协议，但这个函数要求本机服务在线，不等于已具备作者离线期间的云端评论队列 |

## 打包实验

调用旧版真实 `packArtifact`，在临时目录创建：画板元数据、页面 HTML、目录内 SVG、comments.json、.artifact-id、指向 /etc/hosts 的符号链接；页面同时引用相对路径 SVG、localhost 地址和远端 CSS。

返回文件只有 `canvas.json`、`pages/index.html` 和 `pages/assets/logo.svg`，页面 HTML 字节保持不变。临时目录已删除。

这验证了“本地资源可以打包”，也验证了“打包器不会下载外部依赖或改写 localhost”。它没有验证浏览器渲染，也没有证明当前应用包采用完全相同的打包行为。

## 当前安装版实验

使用插件专用安装包 `ryugi-artifacts 1.108.1`，在临时目录隔离服务状态、socket 和端口，创建一个包含 HTML 与相对 SVG 资源的画板，以及一个原生 XML 文档。未发布到 Ryugi Cloud，未操作用户工件。

- `start --no-open` 成功启动独立服务并返回画板地址；`get --detail` 读出 canvas 元数据，`get --source` 读出文档 XML。
- 画板入口返回的外层 HTML 引用 `/index.js` 及多个应用资源，不是自包含页面。
- 复制工件到普通静态 HTTP 服务，并停止本次独立 Ryugi 服务后，画板 HTML、相对 SVG、canvas.json 和 doc.xml 均返回 HTTP 200。
- 复制出的外层 HTML 所需 `/index.js` 返回 404；直接复制工件没有包含 Ryugi 的展示应用。
- HTTP 验证只确认文件可访问，不证明脚本执行、布局、图标或交互正确。当前工件与旧版展示组件的端到端兼容仍未验证。

这些结果支持“静态发布工件内容”的路线，但完整分享需要单独的 viewer 和资源处理；原生文档 XML 也需要渲染器，不能直接视为最终分享页面。

## 评论关联需要保留的数据

- 文档：[comments.ts](https://github.com/Innei/ryugi/blob/v1.51.2/artifacts/src/shared/comments.ts)的锚点使用 blockId、quote、可选 blockIds/textRanges，不是单纯的页面坐标。
- 画板：[board-comments.ts](https://github.com/Innei/ryugi/blob/v1.51.2/artifacts/src/shared/board-comments.ts)使用 page、board、x/y，还可能包含 DOM node path、offset、hashes、group/round 等字段。
- 推导：分享端应保存不可变的发布版本、原始工件稳定 ID、原始节点/画板 ID 和完整锚点。本地同步时应同时提供该版本上下文；不能把旧快照上的坐标直接当成最新工件上的位置。
- 推导：新评论应通过应用的评论写入接口或独立反馈适配层导入，再通知 Paseo。直接覆盖 comments.json 可能绕过状态处理和事件通知，尚未验证为可靠接入方式。

## 可交付的最小范围

第一版采用固定版本发布，保留工件级/画板级评论，服务端存储评论和去重标识，本地上线后拉取并通过 monitor 通知 Agent。元素级锚点、文档文本选区评论和跨版本自动重定位分开验收。

实施前还需完成：当前安装版本工件格式与旧版 renderer 的真实兼容测试；全套 runtime/字体/图片资源清单；作者本机关闭后的远端页面与评论验收；评论导回本机触发 monitor 的完整链路验收。当前结果足以确认路线具备基础，不足以宣称现成导出已可交付。
