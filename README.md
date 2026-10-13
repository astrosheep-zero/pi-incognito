# pi-incognito

Private messages inside a Pi session. Protects the session JSONL only. Requires Pi 1.1.0 on macOS, Linux, or Windows.

```sh
pi -e ./src/index.ts
```

`/incognito` toggles the mode and reports the new status. It takes no arguments.

- On: 👻 appears in the status bar, and new messages are not saved.
- Off: the ghost disappears, private messages are discarded, and you are back in the saved session.

Toggle while the agent is idle. Works in a blank session too, so the first message can be private.

## How it works

Turning it on switches to a separate private session with a copy of the public history. The original entry IDs and active branch are preserved; appends and whole-file rewrites go to the native null device. **The original session file is never modified by this extension.**

- **macOS/Linux:** `<session>.incognito-<pid>-<id>.jsonl` is a symlink to `/dev/null`.
- **Windows:** a unique DOS-device alias is first mapped to a temporary public-history copy, then remapped to `\\Device\\Null` after Pi loads it. This uses the documented `DefineDosDevice` API through the included Windows PowerShell helper. The public copy is staged inside the session directory and deleted before accepting private input. No NTFS symlinks, drive letters, administrator elevation, or Developer Mode are needed.

Windows aliases belong to the defining logon context; they are not a way to transfer private sessions across `runas`, elevation, or service contexts.

Windows needs Windows PowerShell and permission to run the helper's `Add-Type`; restrictive enterprise policies may prevent enabling incognito. A failed initialization reports an error and keeps the session public—it never reports incognito on while using a regular shadow file.

Turning it off resumes the original file in a fresh runtime. The private session's in-memory history is dropped; its link/device alias is removed only after the old runtime finishes shutting down. Late session writes from extension shutdown handlers still go to the null device.

While on, `/fork`, `/clone`, `/new`, `/resume`, and import are blocked. Toggle off first. `/reload` keeps the mode.

## Exits and crashes

There is nothing to recover, because the public file is never touched.

- Normal exit: the empty link or device alias is removed after Pi finishes shutting down.
- Forced termination, crash, or power loss: a harmless null-device link/alias may stay behind. The next Pi start cleans entries whose process is gone. Unix scans the current session directory; Windows scans this extension's aliases in the current logon namespace. PID reuse conservatively postpones cleanup if that PID is live. An interruption while initializing can also leave a public-only bootstrap copy; dead-process bootstrap directories are cleaned on startup. Private content is never saved to the session file either way.

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
npm run typecheck
npm run check
```

Tests run Pi's actual session, extension, and runtime pipelines with synthetic inference in temporary directories. Real child processes cover normal exit and forced termination. A real Pi CLI RPC smoke uses an offline test provider; no provider credentials are sent to CI.

[Windows CI](https://github.com/astrosheep-zero/pi-incognito/actions/workflows/windows.yml) runs the suite on a Windows runner and again as a standard user with Developer Mode disabled. This verifies the Windows backend and CLI, not a graphical TUI/font rendering test.
