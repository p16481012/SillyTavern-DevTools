# Architecture

## Read-only boundary

ST DevTools does not declare a `generate_interceptor`. Prompt-ready event payloads are cloned immediately and never mutated. Expensive token calculations and IndexedDB writes run after the event listener returns so normal generation is not deliberately blocked.

## Capture pipeline

1. `GENERATION_STARTED` resets generation-local state.
2. `WORLD_INFO_ACTIVATED` records the activated entry objects.
3. The Chat or Text Completion prompt-ready event is cloned.
4. A context state snapshot captures character, persona, note, configured prompt, extension prompt, API, model, and context settings.
5. Token counts and source attribution are calculated asynchronously.
6. The normalized snapshot is appended to the current chat's IndexedDB timeline.
7. An internal `snapshot` event refreshes the UI when it is open.

## Snapshot schema

Schema version 1 contains:

- identity: `id`, timestamp, extension version, chat ID, message count
- generation: API, model, preset, prompt type, generation type
- payload: immutable cloned request prompt and flattened text
- provenance: known sources with match confidence and metadata
- Lorebook: activated entry objects
- statistics: tokens, context limit, reserved output, usage, remaining tokens

## Compatibility boundary

The captured Chat Completion payload is the prompt-ready message collection before any backend-only post-processing. Text Completion capture occurs after SillyTavern combines the prompt. Provider/server transformations that happen after these events are outside the `0.1.0` capture boundary.
