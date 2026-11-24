# ryugi-paseo-plugin

> **Paseo Plugin for Ryugi Interactive Artifacts & Coding Agent Workbench**

This plugin natively integrates [Innei/ryugi](https://github.com/Innei/ryugi) into [Paseo](https://paseo.sh), bridging interactive design documents, review comments, and multi-variant artboards directly with the agent composer.

---

## Features

- **Document & Review Panel (`ryugi-document`)**: View RFC specifications, paragraph anchor IDs, and review discussions. Add comments that save directly to `.ryugi/artifacts/` or push straight to active agents via `paseo.agents.ref(id).send(...)`.
- **Artboard Comparison Panel (`ryugi-artboard`)**: Multi-variant visual prototypes loaded from `canvas.json` and board HTML previews. Perform `Pass` / `Reject` verdicts with automatic comment tracking.
- **Pattern B: Composer Attachment Source**: Registers `@ryugi-attachments` as a native attachment source in Paseo. Search and reference live document paragraphs, asks, or artboard components with one click.
- **Zero-Poll Direct Engine**: Directly executes `ryugi.cjs` to communicate with the local artifacts server without relying on shell hooks or filesystem polling.

---

## Project Structure

```text
ryugi-paseo-plugin/
├── paseo-plugin.json      # Plugin manifest & Paseo semver requirement
├── package.json           # Dependencies: @getpaseo/plugin, React, React Native, Zod
├── tsconfig.json          # TypeScript configuration
├── shared/
│   ├── contracts.ts       # RPC definitions and AttachmentSource registration
│   └── types.ts           # Shared data models
├── server/
│   ├── realRyugiBridge.ts # Real CLI & artifacts engine connector
│   └── ryugiStore.ts      # Data formatting & search helper
├── client/
│   ├── DocumentPanel.tsx  # Document & line-level review panel
│   └── ArtboardPanel.tsx  # Multi-variant layout artboard panel
├── index.client.tsx        # Client entrypoint: panels & attachment source
└── index.server.ts        # Server entrypoint: RPC handlers
```

---

## Development

```bash
# Install dependencies
npm install

# Typecheck
npm run typecheck
```

---

## Installation in Paseo

```bash
# Install local plugin
paseo plugin install /absolute/path/to/ryugi-paseo-plugin --id ryugi-paseo

# Check running status
paseo plugin ls

# Inspect logs
paseo plugin logs ryugi-paseo
```
