# pi-incognito

Private messages inside a Pi session. Protects the session JSONL only. Requires Pi 1.1.0 on macOS or Linux.

```sh
pi -e ./src/index.ts
```

`/incognito` toggles the mode and reports the new status. It takes no arguments.

- On: 👻 appears in the status bar, and new messages are not saved.
- Off: the ghost disappears, private messages are discarded, and you are back in the saved session.

Toggle while the agent is idle. Works in a blank session too, so the first message can be private.

## How it works

Turning it on switches to a separate private session next to the original, named `<session>.incognito-<pid>-<id>.jsonl`. It gets a copy of the public history, and its file is a symlink to `/dev/null`. Appends and full rewrites both go nowhere. **The original session file is never modified.**

Turning it off resumes the original file in a fresh runtime. The private session's in-memory history is dropped, and its link is removed only after the old runtime finishes shutting down. A late write from another extension still goes to `/dev/null`.

While on, `/fork`, `/clone`, `/new`, `/resume`, and import are blocked. Toggle off first. `/reload` keeps the mode.

## Exits and crashes

There is nothing to recover, because the public file is never touched.

- Normal exit: the empty link is removed after Pi finishes shutting down.
- SIGKILL, crash, or power loss: an empty link may stay behind. The next Pi start in that session directory removes links whose process is gone. Private content is never on disk either way.

## Boundaries

This is not a sandbox or forensic erasure:

- Providers still receive your prompts and may keep records.
- Tools, notes or history extensions, telemetry, shell history, and terminal scrollback are not intercepted.
- Exports and sharing are not blocked. They read the in-memory private conversation, so don't use them while incognito is on.
- Other extensions can write their own files.
- Memory, swap, crash dumps, and filesystem snapshots are out of scope.

## Development

```sh
npm install --ignore-scripts
npm test
npm run check
```

Tests run Pi's actual session, extension, and runtime pipelines with synthetic inference in temporary directories. Real child processes cover normal exit and SIGKILL.
