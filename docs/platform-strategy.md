# Publy: narrow destination strategy (2026-10-30)

**Status: active product-scope decision, not a platform integration or release.**
[中文](platform-strategy.zh-CN.md)

## One customer, one paid job to be done

Publy helps a writer keep using Typora/Obsidian/VS Code or any compatible
Markdown editor, review accurate WeChat formatting, and **explicitly deliver
to one selected WeChat Official Account draft box**, then verify/reconcile
the outcome. No separate editing database, content-library import or
automatic mass-sending.

**Editor-neutral input is in scope; multi-platform output is not.** Supporting
a saved .md from Typora is one input compatibility feature. Adding each
publication destination is a new API, review, legal, security, support,
idempotency, content-mapping and account-management product surface.

## Destination policy

| Channel | Decision | Delivery boundary |
| --- | --- | --- |
| WeChat Official Accounts | **P0: sole production publishing destination** | Existing official draft API; reliability, fixed-egress pilot and excellent onboarding take priority over other channels |
| Zhihu | **Discovery/backlog only** | Strong long-form fit, but third-party authoring/publishing authorization and policy need proof. No simulated login, private cookies, unofficial internal endpoints or unsupported automation. No delivery adapter before a verified, maintainable authorized mechanism and user demand |
| WordPress, Ghost, DEV/Forem | **Deferred** | Published APIs may make these technically tractable, but easier integration is not a reason to dilute core customer value |
| Xiaohongshu, Douyin, Weibo, Toutiao, Medium, others | **Not on current roadmap** | Distinct format/account/eligibility/operation requirements; do not imply supported automated publishing |
| Universal export | **Bounded:** preview, rendered HTML, image cards | Existing local output is not proof of platform-specific paste compatibility. Avoid destination-specific templates until tested demand |

Never present a list of potential channels as already supported. Research
notes are nonbinding and must not become feature commitments by default.

## Sequencing and kill criteria

1. **Finish WeChat P0:** original Markdown / media fidelity; safe and usable
   preflight; reliable preview; accessible explicit account/draft confirmation;
   correct statuses and idempotent unknown-outcome recovery; genuine clean
   install and real WeChat acceptance. See #7, #8, #12, #14, #15, #25, #26.
2. **Make paid value real:** hosted onboarding, stable egress, credential
   management, current Commerce/Permit entitlement, fair quota, reconciliation,
   refund/cancel and support. No checkout until approved. See #17.
3. **Evaluate only one next destination, Zhihu,** *after* the above acceptance,
   unless evidence warrants a deliberate revision. Reopen only with: verified
   lawful official/authorized access for normal users; >=5 distinct potential
   customers with a concrete repeated publishing task; bounded implementation
   and support cost; a fixture-based fidelity comparison; and evidence that
   the new destination increases conversion/retention, not merely feature count.
   If any prerequisite fails, retain only local export and defer the adapter.

No multi-channel one-click broadcast, multi-platform scheduler, marketplace,
general CMS, full text editor or AI-generated content factory as part of the
current release. Each new destination requires a separate explicit review
with customer, API contract, permissions, privacy, rollback and owner.

## Engineering consequence

Keep the core renderer and user workflow editor-neutral. An internal
destination seam may be narrow and testable, but **do not** prebuild an
abstract provider framework with speculative adapters. The WeChat publishing
protocol remains the only active production implementation. Prefer direct
product corrections and observed customer feedback over architecture that
exists only to accommodate hypothetical platforms.

This policy changes product priorities, not current licenses, billing,
official integration availability or public release status.
