# ryugi-paseo-plugin

> **Paseo Plugin for Ryugi Interactive Artifacts & Coding Agent Workbench**

This plugin natively integrates [Innei/ryugi](https://github.com/Innei/ryugi) into [Paseo](https://paseo.sh), bridging interactive design documents, review comments, and multi-variant artboards directly with the Paseo agent conversation.

---

## Key Highlights

- **Floating Composer Pills (悬浮入口)**:
  Directly registers two floating buttons (`PRD 文档` and `原型画板`) in the composer track bar above every Agent's message input box. One click opens the document workspace or artboard canvas.
- **Authentic Interactive Web UI (原生 Web 画板与文档嵌入)**:
  Instead of rendering simulated mobile elements, both panels natively embed the authentic Ryugi web application (`http://localhost:27319/document/...` and `http://localhost:27319/artboard/...`) via a strict `client/web.tsx` boundary, supporting full zoom, pan, selection, inspector, and line-level annotations.
- **Session Singleton (需求会话单例约束)**:
  Enforces 1 requirement session = 1 fixed Document (`document/session-<shortId>`) + 1 fixed Artboard (`artboard/session-<shortId>`), evolving in-place rather than generating scattered artifacts.
- **Bi-Directional Message Bridge (双向消息打通)**:
  - **From Ryugi to Agent**: One-click "同步批注到对话" / "同步画板到对话" compiles review comments, anchor IDs, and layout variants directly into the current Agent dialogue via `paseo.agents.ref(agentId).send(...)`.
  - **Pattern B Composer Attachment**: Users can type `@` in the composer to search and attach specific document blocks, anchor IDs, or artboard components into their prompts.
- **Zero-Poll Daemon Integration**:
  Runs directly with the Ryugi local server on port 27319 without terminal polling or shell hooks.

---

## Project Structure

```text
ryugi-paseo-plugin/
├── paseo-plugin.json      # Plugin manifest & Paseo semver requirement
├── package.json           # Dependencies: @getpaseo/plugin, React, React Native, Zod
├── tsconfig.json          # TypeScript configuration
├── shared/
│   ├── contracts.ts       # Lowercase kebab-case RPCs and AttachmentSource contracts
│   └── types.ts           # Shared data models
├── server/
│   ├── realRyugiBridge.ts # Real CLI & artifacts engine connector, session singleton creator
│   └── ryugiStore.ts      # Data formatting & search helper
├── client/
│   ├── web.tsx            # Web boundary for iframe rendering & postMessage bridging
│   ├── DocumentPanel.tsx  # Document workspace panel embedding real Ryugi doc UI
│   └── ArtboardPanel.tsx  # Artboard workspace panel embedding real Ryugi canvas UI
├── index.client.tsx        # Client entrypoint: panels, composer pills, slash command
└── index.server.ts        # Server entrypoint: RPC handlers
```

---

## Development & Verification

```bash
# Typecheck
npm run typecheck

# Mobile/Web boundary audit (Paseo spec)
rg -n "document\.|window\.|localStorage|navigator\.|<[a-z]+[ >]|className=|onClick=" client/
```

---

## Installation in Paseo

```bash
# Install local plugin
paseo plugin install /absolute/path/to/ryugi-paseo-plugin --id ryugi-paseo

# Reload after edits
paseo plugin reload ryugi-paseo

# Inspect logs
paseo plugin logs ryugi-paseo
```
