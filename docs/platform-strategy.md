# Publy destination and editor scope — 2026-10-30

[简体中文](platform-strategy.zh-CN.md) · **Active product decision**

**One publishing destination: WeChat Official Accounts. Two first-class writing
experiences: Typora and Obsidian.** Standard local Markdown is the shared file
format, not a promise to integrate every editing product.

## What Publy builds

The complete experience is **keep the existing Markdown and images → review
and check locally → choose the target WeChat Official Account → explicitly
save a draft → confirm the outcome or recover from an unknown result**.

- **Typora:** open its existing Markdown file and resolve its relative image
  paths, local `typora-root-url`, covers and math. Deliver a source-preserving,
  usable local preview and a simple future nontechnical publishing entry.
- **Obsidian:** reliable plugin preview and explicit account/draft actions;
  validate the official three-file community install with fonts, cards and
  formula rendering. No vault copying.
- **WeChat:** the only actual delivery protocol. No implicit public send,
  mass-send, cross-post or automated browser login. First earn user trust in
  media fidelity, credential boundaries, failures, idempotency and status
  recovery. Public hosted checkout remains closed until real operational and
  Commerce/Permit acceptance.

The shared Markdown engine may read ordinary `.md` files saved by other
editors, but **we do not ship dedicated integrations, marketing claims,
regression matrices or support commitments for those products**.

## Explicitly excluded

**No Zhihu, Toutiao, WordPress, Ghost, DEV/Forem, Xiaohongshu, Douyin,
Weibo, Medium, or other publishing destination work.** They are not an
active roadmap, not a discovery backlog, and not a future adapter placeholder.
Do not investigate their APIs, design a generalized provider framework,
create provider-specific account UI, or reserve engineering budget for them.

This decision supersedes earlier Zhihu candidate evaluations and all earlier
conditional references to new destinations. It also supersedes broad
multi-editor support commitments outside Typora/Obsidian; an ordinary local
Markdown file is still a valid input.

## Release priorities in order

1. **Correct source and media:** filenames and relative paths, Typora roots,
   Obsidian vault embeds, safe HTML, covers, equations and cards; no silent
   asset substitution or dropped images.
2. **User-level quality:** offline preview and visible warnings, exact selected
   account, explicit draft-only submit, status/unknown-outcome recovery, clean
   installs and first-use validation on Windows/macOS/Linux, keyboard and
   accessibility, polished error states.
3. **WeChat real-world reliability:** fixed-egress and whitelist acceptance,
   official draft confirmation, credentials and backup/restore, retry/idempotency
   after network loss and process restart.
4. **Commercial readiness:** hosted onboarding only after operations,
   entitlements via Commerce/Permit, quotas, cancellation/refund, abuse
   resistance and support are proven.

No new destination is required to call Publy complete. Any future expansion
would require an explicit **new** product decision; it should not be worked on
under this roadmap. The existing licence and public release status do not
change with this decision.
