# Publy distribution without npm Registry

**Status: prototype only.** Public hosted checkout and community directory installation are not qualified; no new npm Registry publication is planned.

## Policy

Customers should download platform-specific executables or installers from an audited GitHub Release without registering for npm, installing pnpm, or building from source. Obsidian distribution uses the official Community Directory and corresponding GitHub Release assets; this is separate from npm. Existing npm tags are historical and are not a recommended installation path. The development workspace still uses pnpm to build the current TypeScript renderer/server/plugin; that does not imply future npm publishing.

## Racket native feasibility probe

The read-only source `racket/publy-cli-prototype.rkt` currently supports `version` and `doctor` only. `doctor` inspects a local Publy CLI config shape; it never sends network traffic or prints API keys, account credentials, or raw config values. These commands are **not** the existing `publy render`, `card` or `publish` commands. Do not rename the probe to the production CLI or publish it as a full release.

On a development machine with Racket installed:

```sh
raco test racket/publy-cli-prototype-test.rkt
raco exe -o publy-racket-probe racket/publy-cli-prototype.rkt
raco distribute dist/publy-racket-probe publy-racket-probe
```

On Windows, the executable is named `publy-racket-probe.exe`. The distribution is an **entire directory** with dependencies: the CLI is in `bin/` on Linux/macOS and at the directory root on Windows. A bare executable from a build workstation may not be portable.

The GitHub Actions workflow [racket-probe.yml](../.github/workflows/racket-probe.yml) builds/test-packages the probe on Windows/macOS/Linux and uploads temporary **CI artifacts**, not signed public GitHub Releases. CI success on its runner is not clean-user-machine acceptance.

## Gate before a full Racket migration

Compare the native probe to a no-npm packaged version of the existing CLI, then verify strict compatibility on synthetic markdown/WeChat HTML, code/math, fonts, image cards, attachment references, `--json`, exit codes and network failure/idempotency semantics. Measure archive size, startup time, memory, install/update/uninstall, native OS warnings and licenses. Only migrate the renderer/server incrementally if those tests prove a net user benefit.

Obsidian must continue shipping compliant JavaScript (`main.js`) through its three-file directory installer; the end user must not need Racket to preview notes. Payments belong to Commerce and rights to Permit; do not rebuild the payment system during a language migration.

Tracking: [Racket/distribution experiment #18](https://github.com/turlamai/publy/issues/18), [Obsidian installer gate #12](https://github.com/turlamai/publy/issues/12), [Commerce migration #17](https://github.com/turlamai/publy/issues/17).
