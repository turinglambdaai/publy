# Publy product and pricing plan

**English** · [简体中文](PRICING.zh-CN.md)

## Launch status and implementation boundaries

- Policy version: `2026-10-v2`, 2026-10-23. The owner confirmed that every product is still in development and has no actual users. This document replaces conflicting previous pricing, early-bird and Pro proposals; there is no existing customer cohort to migrate. **Prices are launch targets, not live offers or claims that the listed features are implemented.**
- Entitlements cover delivered platforms only. New commercial plans do not change the LICENSE of released source. Source use, modification and redistribution rights are separate from official products, updates and services.
- Security fixes and reading, backing up or exporting your own data must not require another purchase. BYOK keys, payment-provider secrets and issuer private keys have different owners. Native hosts do not collect payment or issue credentials directly.

## Decision

**Free CLI/self-hosting with a hosted publishing subscription**

Launch target: **Personal: ¥29 / US$5 per month, or ¥290 / US$50 per year. Studio: ¥79 / US$12 per month, or ¥790 / US$120 per year**. CNY and USD are independently set regional targets, not a live exchange-rate conversion.

Stable egress, credential lifecycle, scheduling and recovery are continuous services. Use two subscription tiers rather than lifetime hosting, a theme-market commission, unlimited accounts or an enterprise SLA.

## Free and paid scope

Free / evaluation: CLI, typesetting, card rendering, official default themes, the Obsidian plugin and a self-hosted server are free. Generated content always remains exportable. No charge per local typesetting operation.

Paid: Personal: 1 WeChat Official Account, 30 successful publishing jobs per month and 1 GB of active attachments. Studio: 3 accounts, 150 successful jobs per month and 5 GB. Payment covers stable egress, credential custody, scheduling and failure recovery. One job delivers one article/card draft to one account. Failures, retries and duplicate callbacks never count twice. WeChat platform limits still apply; no additional platform permissions are promised.

## Subscription boundaries

Hosted usage is metered by account, not device. Service within the current monthly/annual period follows the published allowance. Cancellation stops renewal, while the paid period remains available. After expiry, hosted compute stops; local data remains readable and exportable. No lifetime hosting, automatic overage charge or hidden fair-use restriction. An annual prepayment does not reduce the obligation to provide the paid service. Cancellation/refund rules, retention/deletion periods, model lists and total price must be clear before real checkout and verified end to end.

## Next gate before sales

Complete idempotent publishing, duplicate prevention, credential rotation, revocation and quotas in #7. Quotas follow the UTC payment billing cycle, do not roll over, and stop new jobs when exhausted without silent overage charges. Cancellation leaves the paid period available. At expiry, stop new hosted jobs, allow 30 days to export content, then delete hosted content copies; backup/log retention must be separately published with definite periods. Local content is unaffected. Hosting is not on sale.

Execution entry: [issue #7](https://github.com/turinglambdaai/publy/issues/7). Complete this bounded slice before expanding commercial features.

Portfolio role and shared boundaries: [PORTFOLIO](https://github.com/turinglambdaai/turinglambdaai.github.io/blob/master/PORTFOLIO.md).
