// Payment provider adapters. The purchase flow is provider-agnostic:
// createPayment(order) → { payUrl } | { qrDataUrl } | null (manual: admin
// completes orders); pollOrder(order) → "paid" | "pending" (active query);
// verifyNotify(body) → order id | null (signature-checked callback).

import crypto from "node:crypto";
import QRCode from "qrcode";
import type { OrderRow, Store } from "./store.js";

export interface PaymentProvider {
  name: string;
  /** payment url / QR data-url for the order, or null when manual completion applies */
  createPayment(order: OrderRow, notifyUrl: string, returnUrl: string): Promise<{ payUrl?: string; qrDataUrl?: string } | null>;
  /** active query: has the order been paid? (providers without polling omit this) */
  pollOrder?(order: OrderRow): Promise<"paid" | "pending">;
  /** extract + verify the merchant order id from a provider callback body */
  verifyNotify(body: Record<string, unknown>): string | null;
}

function md5(s: string): string {
  return crypto.createHash("md5").update(s, "utf8").digest("hex");
}

/** Normalize a bare base64 key into PEM form (users paste one-liners). */
function toPem(key: string, type: "PRIVATE KEY" | "PUBLIC KEY"): string {
  if (key.includes("-----BEGIN")) return key;
  const lines = key.replace(/\s+/g, "").match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${type}-----\n${lines.join("\n")}\n-----END ${type}-----`;
}

/** Alipay 当面付 (face-to-face / QR). Official channel — personal Alipay
 *  accounts can apply. Flow: precreate → QR → active trade.query polling. */
export class AlipayFacade implements PaymentProvider {
  name = "alipay";

  constructor(private appId: string, private privateKey: string, private alipayPublicKey: string | null, private gateway = "https://openapi.alipay.com/gateway.do") {}

  static available(cfg: { appId?: string; privateKey?: string } | undefined): boolean {
    return Boolean(cfg?.appId && cfg?.privateKey);
  }

  static alipayTimestamp(now = Date.now()): string {
    // Alipay requires "yyyy-MM-dd HH:mm:ss" in Asia/Shanghai
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .format(now)
      .replace("T", " ");
  }

  /** signable string: sorted k=v joined by &, excluding sign/empty (alipay spec) */
  static signableString(params: Record<string, string>): string {
    return Object.keys(params)
      .filter((k) => k !== "sign" && params[k] !== "")
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join("&");
  }

  private sign(text: string): string {
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(text);
    return signer.sign(toPem(this.privateKey, "PRIVATE KEY"), "base64");
  }

  private async api(method: string, biz: Record<string, unknown>): Promise<Record<string, unknown>> {
    const params: Record<string, string> = {
      app_id: this.appId,
      method,
      format: "JSON",
      charset: "utf-8",
      sign_type: "RSA2",
      timestamp: AlipayFacade.alipayTimestamp(),
      version: "1.0",
      biz_content: JSON.stringify(biz),
    };
    params.sign = this.sign(AlipayFacade.signableString(params));
    const res = await fetch(this.gateway, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
    const json = (await res.json()) as Record<string, Record<string, unknown> | string>;
    const resp = json[`${method}_response`] as Record<string, unknown> | undefined;
    if (!resp || resp.code !== "10000") {
      throw new Error(`alipay ${method}: ${resp?.code ?? res.status} ${resp?.sub_msg ?? resp?.msg ?? ""}`);
    }
    return resp;
  }

  async createPayment(order: OrderRow): Promise<{ qrDataUrl?: string; payUrl?: string } | null> {
    const resp = await this.api("alipay.trade.precreate", {
      out_trade_no: order.id,
      total_amount: (order.amountFen / 100).toFixed(2),
      subject: `Publy ${order.plan} × ${order.months} 个月`,
    });
    const qr = String(resp.qr_code ?? "");
    if (!qr) throw new Error("alipay precreate returned no qr_code");
    const qrDataUrl = await QRCode.toDataURL(qr, { width: 360, margin: 1 });
    return { qrDataUrl };
  }

  async pollOrder(order: OrderRow): Promise<"paid" | "pending"> {
    const resp = await this.api("alipay.trade.query", { out_trade_no: order.id });
    return resp.trade_status === "TRADE_SUCCESS" || resp.trade_status === "TRADE_FINISHED" ? "paid" : "pending";
  }

  verifyNotify(body: Record<string, unknown>): string | null {
    if (!this.alipayPublicKey) return null;
    const signable = AlipayFacade.signableString(Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v)])));
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(signable);
    const ok = verifier.verify(toPem(this.alipayPublicKey, "PUBLIC KEY"), String(body.sign ?? ""), "base64");
    if (!ok) return null;
    if (body.trade_status !== "TRADE_SUCCESS" && body.trade_status !== "TRADE_FINISHED") return null;
    return (body.out_trade_no as string) ?? null;
  }
}

/** XunhuPay (虎皮椒) — third-party personal gateway. PC QR still works after
 *  the 2025-11 WeChat-app-wake shutdown; kept as a backup channel. */
export class XunhuPay implements PaymentProvider {
  name = "xunhupay";

  constructor(private appId: string, private secret: string) {}

  static available(cfg: { appId?: string; secret?: string } | undefined): boolean {
    return Boolean(cfg?.appId && cfg?.secret);
  }

  private sign(params: Record<string, string>): string {
    const sorted = Object.keys(params)
      .filter((k) => k !== "hash" && params[k] !== "")
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join("&");
    return md5(sorted + this.secret);
  }

  async createPayment(order: OrderRow, notifyUrl: string, returnUrl: string): Promise<{ payUrl: string } | null> {
    const params: Record<string, string> = {
      version: "1.1",
      lang: "zh-cn",
      plugins: "publy",
      appid: this.appId,
      trade_order_id: order.id,
      total_fee: (order.amountFen / 100).toFixed(2),
      title: `Publy ${order.plan} ${order.months}个月`,
      time: String(Math.floor(Date.now() / 1000)),
      notify_url: notifyUrl,
      return_url: returnUrl,
      nonce_str: crypto.randomBytes(16).toString("hex"),
    };
    params.hash = this.sign(params);
    const res = await fetch("https://pay.xunhupay.com/payment/api/do.html", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
    const data = (await res.json()) as { errno?: number; errmsg?: string; data?: { url?: string; url_qrcode?: string } };
    if (data.errno !== 0) throw new Error(`xunhupay: ${data.errmsg ?? res.status}`);
    const payUrl = data.data?.url ?? data.data?.url_qrcode;
    return payUrl ? { payUrl } : null;
  }

  verifyNotify(body: Record<string, unknown>): string | null {
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) params[k] = String(v);
    if (this.sign(params) !== params.hash) return null;
    if (params.status !== "OD") return null; // OD = paid
    return params.trade_order_id ?? null;
  }
}

/** Manual provider: orders stay pending until an admin completes them.
 *  With a static personal QR configured (manualQrUrl), the purchase page
 *  shows the QR + a short order code; the admin matches the payment remark
 *  in their Alipay/WeChat app and completes with one click. */
export class ManualProvider implements PaymentProvider {
  name = "manual";

  constructor(private qrUrl?: string) {}

  async createPayment(): Promise<{ qrDataUrl?: string; payUrl?: string } | null> {
    return this.qrUrl ? { qrDataUrl: this.qrUrl } : null;
  }

  verifyNotify(): string | null {
    return null;
  }
}

export function createProvider(
  cfg: {
    provider?: string;
    xunhupay?: { appId?: string; secret?: string };
    alipay?: { appId?: string; privateKey?: string; alipayPublicKey?: string };
    manual?: { qrUrl?: string };
  } | undefined,
  store: Store,
  onPaid: (order: OrderRow) => void,
): { provider: PaymentProvider; completeOrder: (orderId: string) => OrderRow | null } {
  let provider: PaymentProvider = new ManualProvider(cfg?.manual?.qrUrl);
  if (cfg?.provider === "alipay" && AlipayFacade.available(cfg.alipay)) {
    provider = new AlipayFacade(cfg.alipay!.appId!, cfg.alipay!.privateKey!, cfg.alipay?.alipayPublicKey ?? null);
  } else if (cfg?.provider === "xunhupay" && XunhuPay.available(cfg.xunhupay)) {
    provider = new XunhuPay(cfg.xunhupay!.appId!, cfg.xunhupay!.secret!);
  } else if (cfg?.provider === "alipay" || cfg?.provider === "xunhupay") {
    // requested but credentials incomplete → stay manual and say so loudly at boot
    console.error(`[payments] provider "${cfg.provider}" selected but credentials missing — falling back to manual`);
  }

  /** shared fulfillment: mark paid + issue/extend the user (idempotent) */
  const completeOrder = (orderId: string): OrderRow | null => {
    const order = store.findOrder(orderId);
    if (!order || order.status === "paid") return order;
    let user = store.findUserByContact(order.contact);
    if (!user) {
      user = store.createUser(order.contact, order.plan, order.months);
    } else if (order.plan === "pro") {
      store.extendPro(user.id, order.months);
    }
    store.markOrderPaid(order.id, user.id);
    onPaid(order);
    return store.findOrder(order.id);
  };

  return { provider, completeOrder };
}
