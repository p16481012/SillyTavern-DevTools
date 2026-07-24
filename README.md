# ST DevTools

ST DevTools is a read-only prompt pipeline debugger for SillyTavern. It captures the assembled prompt locally and provides a DevTools-style explorer, timeline, diff, context view, search, and exports without changing normal chat prompts.

## Status

Version `0.1.0` is the first installable foundation release.

Included:

- Magic Wand menu entry
- draggable and resizable native-style window
- Chat Completion and Text Completion prompt capture
- activated Lorebook entry capture
- per-chat local timeline with a 100-snapshot retention limit
- prompt source explorer with token counts and attribution confidence
- any-snapshot-to-any-snapshot diff
- final payload/context viewer
- literal and regular expression search
- JSON, TXT, and Markdown export
- remembered window geometry and last selected tab

Planned for `0.2.0`:

- local Rule Inspector
- duplicate and repeated-instruction detection
- explicit language, role, identity, and output-format conflict checks
- severity and confidence levels
- prompt growth charts and improved source attribution

## Installation

1. Open SillyTavern.
2. Open **Extensions → Install Extension**.
3. Enter:

   ```text
   https://github.com/p16481012/SillyTavern-DevTools
   ```

4. Reload SillyTavern.
5. Open the Magic Wand menu and select **ST DevTools**.

SillyTavern `1.13.5` or later is required.

## How capture works

ST DevTools listens to SillyTavern's public prompt-ready events:

- `CHAT_COMPLETION_PROMPT_READY`
- `GENERATE_AFTER_COMBINE_PROMPTS`
- `WORLD_INFO_ACTIVATED`

The prompt payload is cloned synchronously and all token counting and persistence work is deferred. The extension never registers a prompt interceptor and never mutates the event payload.

Snapshots are stored locally with SillyTavern's bundled `localforage`/IndexedDB instance. They are separated by chat ID and are not added to character cards or chat files.

## Attribution labels

- `exact`: the captured final prompt contains the source text unchanged
- `derived`: the source was reconstructed from the captured payload rather than matched as one unchanged block
- `unmatched`: the source was available in current SillyTavern state but could not be matched after macro, template, regex, or provider processing

Source attribution is intentionally conservative. An unmatched item is not claimed to have been sent.

## Privacy

Core features do not use external services. Exporting data creates a local download. Prompt snapshots may contain private conversation and character data, so review exported files before sharing them.

## Development

Requires Node.js 20 or later.

```bash
npm run check
npm test
```

No production dependencies or build step are required.

## License

GNU Affero General Public License v3.0 or later.
