# Ryugi Claude Code 原生 monitor 源码调查

调查对象：公开仓库 `Innei/ryugi`，提交 `6f5b4cc70c0493f4848a8ec1fa090258389eff08`。所有链接固定到该提交。范围为公开源码、配置和测试；没有读取安装包或 `dist` 编译产物。真实协议验证使用独立测试身份和临时工件，不向业务会话发送测试消息。

## 结论与证据边界

Claude Code 的原生 monitor 是一个随会话启动的常驻子进程：连接 Ryugi hub 的 Unix socket，接收 JSON Lines，将业务事件格式化为文本写入 stdout；Claude Code 负责把 monitor 输出变成当前会话的通知。Ryugi 客户端写入并 flush 成功后立即回传 `delivered`。它不是监控所有页面操作的 DOM 监听器，也不是由每次模型执行工具主动轮询评论。

公开仓库能确认三种业务通知：`ryugi-comments`、`ryugi-choices`、`ryugi-answers`。后两种还可带 `withdrawn` 撤回状态。另有 `retract` 控制消息，它与业务事件的 `withdrawn` 不同。客户端不对 `type` 做白名单验证，所以准确说法是“三种明确支持的业务类型”，不能证明服务端永远只发这三种类型。

**不能据此穷举服务端原始事件。** 仓库明确说明 artifacts CLI、server、viewer 在另一个项目开发，不提交在本库，npm 包为专有软件。因此“新增评论、编辑评论、删除评论、回复、解决、重新打开、已读、选项暂存、提交、撤回、页面/CRDT 变化”分别是否产生原始事件，以及哪些最终触发通知，不能全部从公开库确证。不能把 UI 状态变化、CLI 命令名称或测试注入的通知直接当作服务端事件枚举。证据：[AGENTS.md:15–20](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/AGENTS.md#L15-L20)。

## 1. 启动与会话身份

唯一的 monitor 配置名称为 `artifact-comments`，命令为 `hooks/run-hook.cmd watch-comments`，`when: always`。这意味着它面向每个 Claude 会话启动，不要求会话先使用 artifacts skill；对应测试特意覆盖“未运行 artifacts skill 的会话也能收到 Preview 评论”。证据：[monitors/monitors.json:1–8](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/monitors/monitors.json#L1-L8)、[test-comment-watch.cjs:98–102](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/tests/hooks/test-comment-watch.cjs#L98-L102)。

shell 使用 `CLAUDE_PROJECT_DIR` 或当前目录解析项目根，等待 hook binary 最多约 60 次、每次 1 秒，找到后 `exec ryugi-hook watch claude <project>`。这是避免首次下载导致整场会话没有 monitor。证据：[hooks/watch-comments:8–29](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/hooks/watch-comments#L8-L29)。

`watch::claude` 的身份规则：

- `CLAUDE_CODE_SESSION_ID` 必须是 UUID，否则静默退出。
- 若匹配到一个自定义 host，Claude watcher 直接退出，避免同时使用原生与自定义通道。
- 项目来自首个参数，缺省当前目录。
- host 固定 `claude`；agent 显示名称通常是 `Claude Code`，`CLAUDE_CODE_IS_COWORK` 非空时为 `Claude Cowork`。
- 处理 interrupt；收到 `bye/replaced` 退出，不重新争抢连接。

证据：[watch.rs::claude_session/claude:6–35](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/hook/src/watch.rs#L6-L35)。

## 2. 三层事件必须分开

| 层次 | 方向 | 可确认内容 | 是否直接唤醒 Claude |
| --- | --- | --- | --- |
| agent 生命周期遥测 | Claude hooks → HTTP hub | 用户提交、工具前后、权限、停止、会话结束 | 否；这是发送给服务端的状态信息 |
| 业务通知 | hub socket → watcher | comments、choices、answers，以及业务撤回状态 | 是；符合基础格式就输出 stdout |
| 传输控制 | hub socket ↔ watcher | hello、welcome、delivered、retract、bye、refuse、unsubscribe | 通常否；只控制连接或队列 |

### 2.1 Claude 上报的生命周期事件：完整注册表

| Hook | 注册和调用方式 | 上报附加信息 |
| --- | --- | --- |
| `UserPromptSubmit` | 同步 bootstrap 命令 + 异步 `agent-event`，后者超时 5 秒 | host/session/event/at |
| `PreToolUse` | 异步 `agent-event`，超时 5 秒 | 另带 `paths`，以及长度合规的 `tool` |
| `PostToolUse` | 异步 `agent-event`，超时 5 秒 | host/session/event/at |
| `PostToolUseFailure` | 同上 | 同上 |
| `PermissionRequest` | 同上 | 同上 |
| `PermissionDenied` | 同上 | 同上 |
| `Stop` | 同步 `stop`，超时 5 秒，实际运行 `flush` | 上报 Stop，同时触发 cloud flush |
| `SessionEnd` | 异步 `agent-event`，超时 5 秒 | host/session/event/at |

`SessionStart` 也有注册，匹配 `startup|clear|compact`，用于 bootstrap；它没有在 Claude 配置中走 `agent-event`。因此不能将其列为已确认的 Claude 生命周期遥测消息。也不能把 Codex 的 `Interrupt` 或 Antigravity 的 `PreInvocation` 混入 Claude 注册表。

配置证据：[hooks/hooks.json:3–138](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/hooks/hooks.json#L3-L138)；完整注册表断言：[test-agent-event.cjs:216–237](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/tests/hooks/test-agent-event.cjs#L216-L237)；Stop：[flush.rs::run:10–39](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/hook/src/flush.rs#L10-L39)。

`event_from` 要求输入是对象且 session/event 名称非空；它保留任意事件名称，本身没有固定白名单。通用兼容逻辑把 Antigravity 首次 `PreInvocation` 归一为 `UserPromptSubmit`，丢弃 `invocationNum > 0`。`PreToolUse` 从六个路径字段及嵌套 patch 文本提取文件，解析为绝对路径、去重、最多 64 项；工具名最多 64 个 UTF-16 单位。这里只提取“工具即将操作的路径”，并不证明该工具最终修改成功。证据：[event.rs::paths_of/event_from:8–112](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/hook/src/event.rs#L8-L112)。

上报传输为 `POST /api/agent/event?key=...`，项目在 URL 编码后的 `X-Ryugi-Project` header 中，body 是 JSON。`hub::post_to_hub` 总期限为 1500 ms，失败不向调用方抛出，也没有持久化重试；缺 server-info 即返回。shell 另有项目状态门槛：存在 `.ryugi/artifacts/.state/server-info` 或 `.git` 是文件才继续。证据：[event.rs::run:115–133](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/hook/src/event.rs#L115-L133)、[hub.rs:4–32](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/hook/src/hub.rs#L4-L32)、[hooks/agent-event:29–35](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/hooks/agent-event#L29-L35)。

### 2.2 业务通知：实际输出条件与内容

| `event.type` | 消费字段 | 格式和后续读取 |
| --- | --- | --- |
| `ryugi-comments` | project、artifact、unread、threads；thread 的 thread/status/block/messages；message 的 id/name/at/text；omitted | 展示 unread 和评论摘要；提示将评论作为 review input，使用证据后确认 receipt；读取 `threads` |
| `ryugi-choices` | project、artifact、round、groups、submit、withdrawn | 提交：据 choices 和 threads 画下一轮；撤回：尚未写下一轮时暂停等待新提交；读取 `groups --kind choose` |
| `ryugi-answers` | project、artifact、questions、submit、withdrawn | 提交：逐条应用并用 `comment note --ask` settle；撤回：尚未处理时暂停等待新提交；读取 `asks --status submitted` |
| 其他/缺失 type | 仍可有 project/artifact | formatter 走 comments 分支；不能据此宣称这些是已定义服务端类型 |

消费规则证据：[wake.rs::wake_parts:133–208](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/hook/src/wake.rs#L133-L208)、[channel.rs::section_for/section_flags:19–32](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/hook/src/channel.rs#L19-L32)。

**实际唤醒判定在 native watcher 内非常宽：**收到 `t=event`，event.project 为绝对路径，artifact 合规，就调用 callback 输出。没有额外检查 unread 是否大于零、submit 是否首次出现、withdrawn 是否为真、是否来自人类、是否当前项目、是否当前会话或是否已处理。上述业务筛选如存在，必须位于 hub；公开客户端不提供其实现。artifact 类型允许 `document/artboard/whiteboard/slides/storyboard/preview`，id 以小写字母或数字开头，其余允许小写字母、数字和连字符。证据：[channel.rs::valid_artifact/well_formed:92–102](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/hook/src/channel.rs#L92-L102)、[channel.rs::open:303–307](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/hook/src/channel.rs#L303-L307)。

通知附带的读取命令由客户端重建，覆盖传入 `command`；普通 artifact 是 `node <launcher> comment list --section ... --detail --format brief --project-dir ... --artifact ...`，Preview 是 `node <launcher> preview comments --id ... --project-dir ...`。非 comments 类型额外附带 argv。Claude 使用 500 字符通知模式，只输出提示与命令，**不会在格式化时执行读取命令**；无长度限制的其他宿主可通过 argv 拉取全文。500 限制针对通知文本/行布局，head、tail 极长时并非通用硬截断保证。证据：[channel.rs::command/list_argv:35–55](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/hook/src/channel.rs#L35-L55)、[channel.rs::decorate:220–232](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/hook/src/channel.rs#L220-L232)、[wake.rs::wake_message:265–290](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/hook/src/wake.rs#L265-L290)。

## 3. Socket 协议与全部客户端分支

Unix socket 上每行一个 JSON 对象。默认 socket 为 `/tmp/ryugi-<uid>/hub.sock`；可由 `RYUGI_HUB_SOCKET` 覆盖，或由 `RYUGI_RUNTIME_DIR` 改运行目录。非默认 `RYUGI_SERVER_HOME` 对路径做 SHA-256 并取 12 位作为 socket 后缀，以隔离 hub。连接前检查 socket 父目录必须是当前用户拥有的目录、不能被 group/others 写入；不存在则允许后续连接尝试。证据：[channel.rs::hub_socket_path/safe_socket_dir:65–89](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/hook/src/channel.rs#L65-L89)。

| 方向 | 消息 | 客户端行为 |
| --- | --- | --- |
| client → hub | `hello {protocol:1, version, host, session, agent}` | 每次连上都发送；没有 project 字段 |
| hub → client | `welcome` | 标记握手成功并重置启动 hub 的退避计数；不校验响应 version/protocol |
| hub → client | `event {id,event}` | 基础格式合法才回调；缺 id 时传 Null；未知 type 也能通过 |
| client → hub | `delivered {id}` | Claude stdout write+flush 成功后发送 |
| hub → client | `retract {project,artifact,type,...}` | channel 转为 Signal::Retract；Claude callback 忽略 |
| hub → client | `bye {reason:"replaced"}` | 关闭 channel，Signal::Replaced，Claude 进程退出 |
| hub → client | 其他 reason 的 `bye` | 忽略 |
| hub → client | `refuse` | 断开当前连接，进入重连；未 welcome 时可触发启动 hub |
| client → hub | `unsubscribe` | 通用 Channel API 可用：设 closed、发送消息、shutdown write、不重连；Claude watcher 没有主动调用路径 |
| 任意方向异常 | 非 JSON/未知 t | 入站非 JSON 与未知 t 被忽略；读错误/EOF 进入断线流程 |

证据：[channel.rs::Channel:187–217](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/hook/src/channel.rs#L187-L217)、[channel.rs::open:278–336](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/hook/src/channel.rs#L278-L336)。

## 4. 订阅绑定与项目过滤位置

`hello` 只标识 host/session/agent，并不订阅项目全部 artifact。显式订阅是另一条 HTTP 路径：launcher 先调用 `launch-prepare` 计算 `{host,session,project,artifact}`，CLI 子进程退出后再调用 `subscribe`，向 `/api/agent/subscribe` POST。源码没有限定 CLI 必须以零状态退出才执行订阅。证据：[ryugi.cjs:307–346](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/skills/artifacts/app/ryugi.cjs#L307-L346)。

`subscription_for` 仅接受：

1. `start` 且提供合法 `--artifact`。
2. `comment list` 或 `comment read` 且 artifact 为 `preview/...`。

因此 `start --background --no-open` 不会订阅项目所有反馈；读取 document 等普通评论不会自动订阅未来反馈。身份解析支持自定义 host 优先、Codex 进程绑定、Antigravity、Claude/Pi 标记；Claude 与 Pi 同时有效时拒绝歧义。内置 Claude 标记必须为 UUID。项目路径经 `project_root` 解析。若使用隔离 server home，订阅还会镜像至默认 home 的 hub，因为会话可能监听默认 hub。证据：[subs.rs::session_of:8–23](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/hook/src/subs.rs#L8-L23)、[subs.rs::identity/subscription_for:239–289](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/hook/src/subs.rs#L239-L289)、[subs.rs::subscribe:334–344](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/hook/src/subs.rs#L334-L344)、[test-comment-subscriptions.cjs:128–141](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/tests/hooks/test-comment-subscriptions.cjs#L128-L141)。

客户端可证明“订阅请求发送到哪个 host/session/project/artifact”，但不能证明服务端如何合并订阅、如何用生命周期路径推断 Preview 所属、如何处理多个会话同时关注、如何选定接收者或多久过期。原生 watcher 本身不比较 event.project 与启动项目；项目主要用于 hub 不可达时决定是否启动服务。设计 Paseo 时应保留 session 与 artifact 的绑定，不能用“同一 workspace 的所有评论都投给当前 agent”替代。

## 5. Ack、重试、撤回与重连

### Native Claude 的确认语义

`watch::claude` 同步生成消息，`writeln(stdout)` 并 `flush`，成功后调用 `channel.delivered(id)`；写失败直接进程退出。**delivered 仅证明通知写入 monitor stdout，不证明 Claude 已阅读、执行下一轮、应用答案、回复/解决评论或确认业务 receipt。** 文案中的“acknowledge receipt”属于后续业务处理，不是 socket `delivered` 的同义词。

`Channel::send` 的结果在 `delivered` 中被忽略；native watcher 没有 ack 缓冲、ack 重试、持久化收件箱、id 去重或合并。同一事件如果再次到达会再次输出。公开库无法证明 hub 是否重发未确认消息、重发期限或是否提供跨连接 exactly-once。证据：[watch.rs:23–34](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/hook/src/watch.rs#L23-L34)、[channel.rs:188–198](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/hook/src/channel.rs#L188-L198)。

### 连接重试与启动 hub

默认每秒尝试重新连接。不存在 `.ryugi/artifacts` 时继续等但不启动；`server-stopped` reason 为 `stop`、`stale_pid`、`SIGINT` 时尊重用户停止而不启动，仍每秒尝试连接；`SIGTERM` 不属于禁止重启原因。不可达时启动 hub 的间隔指数增长、上限约 30 秒；连接拨号频率不随之变慢。启动命令为 `node <launcher> start --background --no-open --project-dir <project>`，隐藏输出、禁 update check，子进程最多等 60 秒。一次启动本身可阻塞连接线程至其返回或超时，因此“每秒连接”指普通重试间隔，不是严格实时调度保证。welcome 后重置退避。证据：[channel.rs:10–13](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/hook/src/channel.rs#L10-L13)、[channel.rs::stopped_by_user/launch_hub:108–138](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/hook/src/channel.rs#L108-L138)、[channel.rs::open:241–301](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/hook/src/channel.rs#L241-L301)。

### 不同宿主不要混为一谈

Pi/DSH 的 stdio 协议输出 `{id,type,artifact,content}` JSON，只有从 stdin 收到 `{"delivered":id}` 才确认；Claude 原生 monitor 输出纯文本并自动确认。证据：[watch.rs::stdio_watch:46–83](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/hook/src/watch.rs#L46-L83)。

Codex/Antigravity/自定义命令宿主使用共享 Queue：按 `project + artifact + kind` 合并待投递项，保留需确认的 id；投递失败指数退避至 30 秒；成功后回传相关 delivered；`retract` 删除等待项。此队列是其他 transport 的能力，**Claude native monitor 不使用它**。撤回不能撤销已送入宿主的文本，队列也无法取消已经在执行的外部投递。证据：[queue.rs::key_of/Queue:9–155](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/hook/src/queue.rs#L9-L155)。

## 6. 已有测试提供的证据

本次只阅读测试，没有运行会创建消息的集成场景。

| 测试 | 证明内容 |
| --- | --- |
| [test-comment-watch.cjs:104–168](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/tests/hooks/test-comment-watch.cjs#L104-L168) | 模拟 hub 事件变成文本并确认 id；典型长评论通知按 500 字符布局；缺 session 静默退出 |
| [test-comment-watch.cjs:171–194](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/tests/hooks/test-comment-watch.cjs#L171-L194) | shell 等待下载中的 binary |
| [channel_tests.rs:164–228](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/hook/src/channel_tests.rs#L164-L228) | 非法 artifact/相对 project 不输出也不确认；目录权限；hello 身份；客户端构造读取命令 |
| [channel_tests.rs:232–359](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/hook/src/channel_tests.rs#L232-L359) | 重连、自动启动、用户停止、refuse、replaced、retract 转发、退避、unsubscribe |
| [test-agent-event.cjs:130–159](https://github.com/Innei/ryugi/blob/6f5b4cc70c0493f4848a8ec1fa090258389eff08/tests/hooks/test-agent-event.cjs#L130-L159) | Claude PreToolUse 转为包含文件绝对路径的 HTTP 遥测 |

这些测试大多使用 fake hub，验证的是客户端契约，不能当作真实 artifacts server 的过滤或可靠性测试。

## 7. Paseo 达到相同 monitor 效果的可执行要求

**复用可行性：** socket `hello` 与 HTTP `subscribe` 本身不要求启用 Claude 的原生 hooks；Paseo 可以实现独立客户端，或使用 Ryugi 自定义 host 接口。原生 hooks 的作用是启动/引导与上报 agent 生命周期；若不启用，需要由 Paseo 补足需要的生命周期与绑定能力，不能假定服务端自动获得这些状态。主调查已在本机 `/tmp/ryugi-501/hub.sock` 用随机 session、`host=paseo`、`protocol=1`、`version=1.108.5` 发出只读 hello 并收到 welcome，随后断开。**只证明握手接受，尚未真实订阅工件，也未消费/投递业务事件或确认 delivered。**

**交互约束：** 原生 monitor 效果意味着通知自动进入 agent 会话并可能唤醒下一轮，相较“先放入输入框草稿供用户发送”是交互变化。本报告说明可行性与契约，不代表本轮已经获得切换为自动发送模式的决定。

1. **会话级常驻监听。** 在 agent 会话可投递时启动 watcher，而不是等待 skill 首次调用；同一 agent session 只保留一个连接，结束时清理，重连时仍使用原 session 标识。
2. **独立订阅绑定。** 记录实际打开/关注的 artifact 与正确项目，复用 `/api/agent/subscribe` 契约；对嵌套宿主不能盲用继承来的 Claude/Codex id。现有自定义 host 通道也可作为接入点，是否采用需结合 Paseo 投递接口验证。
3. **支持完整业务通知。** 接受 comments、choices、answers，以及 choices/answers 的 withdrawn；保留 project/artifact/submit/round/receipt 等上下文。不能仅监听“新评论”而漏掉用户提交选项或答案。
4. **区分控制与业务撤回。** `retract` 用于取消尚未投递的通知，`withdrawn` 是给 agent 的业务指令。两者不应转为同一种“评论删除”。
5. **以实际投递成功确认。** Paseo 应在目标会话接受消息后再 ack hub；失败留待重试。采用 queue 可实现合并、退避和 retract，但它是增强的其他宿主模式，并非 Claude native 自带能力。还应界定投递结果不确定时的重复策略。
6. **把生命周期遥测与唤醒解耦。** 若服务端需要 agent 忙闲、权限、工具路径来决定通知时机，应映射 Paseo 实际可用事件；不能看到一条 PreToolUse 就向 agent 追加一条用户消息。
7. **验收使用真实消费闭环。** 至少覆盖未使用 skill 的会话、两个会话不同 artifact、提交/撤回 choices、提交/撤回 answers、评论通知、断线重连、宿主忙碌、投递失败不 ack、replaced 退出，以及业务 receipt 与 transport delivered 分离。真实服务端的事件发生条件仍需公开协议文档或受授权的真实环境观察补足，不能根据客户端猜测。

## 8. 历史 UI 消息清单不能代替当前 monitor 协议

主调查另取得 `v1.51.2` 的 artifacts 源码快照，`src/shared/types.ts:136` 中 `ServerMessage` 有七类：`cloud-publication`、`change`、`doc-update`、`doc-status`、`doc-comments`、`board-comments`、`cloud-published`。它们面向 viewer 的文档/文件更新、评论数据与发布状态，区别于当前 monitor 的三个语义通知。当前快照本地证据：[types.ts](/tmp/artifacts/src/shared/types.ts:136)。历史 inspector 通信还涉及 `selection`、`loaded`、`runtime-error`，其中 `selection` 已在该快照的 runtime 中确认，后两项由主调查提供历史证据。本段只是历史分层清单，不承诺当前 UI 的完整事件集合，也不能据此声称所有 UI 更新都会唤醒 agent。

## 插件真实链路验证

插件的独立 `paseo` 身份已获得本机 socket 的 `welcome`，工件订阅接口返回 HTTP 200。在临时项目的画板上通过本机接口创建测试评论，测试接收器收到 `ryugi-comments`，project 与 artifact 匹配。测试结束后关闭通道并删除临时项目。方案选择、问答和撤回由模拟 socket 测试覆盖，尚未逐一通过真实页面操作验收。
