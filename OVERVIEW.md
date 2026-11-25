Ryugi Monitor brings Ryugi artifacts into your Paseo workflow. Open the artifacts from the Agent session that created them, then leave a comment, choose a design, or answer a question in Ryugi. The feedback goes back to that same session so the Agent can continue.

- **Ryugi included.** The plugin prepares an isolated Ryugi runtime and provides the artifact tool and workflow skills to Paseo Agents when a session opens. The workflow covers design, implementation, debugging, and verification.
- **Shortcuts above the composer.** Shortcuts appear for documents, artboards, HTML pages, slides, whiteboards, verification reports, data reports, and storyboards when the current session has the corresponding artifact. Each opens its Ryugi page in the browser.
- **Collapsible feedback.** Comments, submitted choices, and answers appear as compact notices in the session timeline. Expand a notice to see the original event, then collapse it to keep the conversation readable.

### Setup

Requires Paseo 0.17.3 or later, Node.js 20.12 or later, npm, and Git on the daemon host. The plugin's installation step downloads the pinned Ryugi Artifacts package from npm and the pinned workflow revision from GitHub. Ryugi runs on the daemon host. Open its document and artboard links from a browser that can reach the local runtime.

### Data access

The plugin reads artifact locations and feedback events from the host's Ryugi runtime. It routes events to their matching Paseo session. When an Agent reads the feedback, the results can be sent to that Agent's configured provider as part of the session. Local artifact pages do not require a Ryugi Cloud account.
