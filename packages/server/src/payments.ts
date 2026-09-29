// Payment provider adapters. The purchase flow is provider-agnostic:
// createPayment(order) → { payUrl } | null (manual: admin completes orders);
// verifyNotify(body) → order id | null (signature-checked callback).

import crypto from "node:crypto";
import type { OrderRow, Store } from "./store.js";

export interface PaymentProvider {
  name: string;
  /** payment url for the order, or null when the provider needs manual completion */
  createPayment(order: OrderRow, notifyUrl: string, returnUrl: string): Promise<{ payUrl: string } | null>;
  /** extract + verify the merchant order id from a provider callback body */
  verifyNotify(body: Record<string, unknown>): string | null;
}

function md5(s: string): string {
  return crypto.createHash("md5").update(s, "utf8").digest("hex");
}

/** XunhuPay (虎皮椒) — the standard personal-developer payment gateway in China.
 *  Credentials come from server.json payments.xunhupay; without them the
 *  adapter reports unavailable and the manual flow applies. */
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

/** Manual provider: orders stay pending until an admin completes them. */
export class ManualProvider implements PaymentProvider {
  name = "manual";
  async createPayment(): Promise<{ payUrl: string } | null> {
    return null;
  }
  verifyNotify(): string | null {
    return null;
  }
}

export function createProvider(
  cfg: { provider?: string; xunhupay?: { appId?: string; secret?: string } } | undefined,
  store: Store,
  onPaid: (order: OrderRow) => void,
): { provider: PaymentProvider; completeOrder: (orderId: string) => OrderRow | null } {
  const provider =
    cfg?.provider === "xunhupay" && XunhuPay.available(cfg.xunhupay)
      ? new XunhuPay(cfg.xunhupay!.appId!, cfg.xunhupay!.secret!)
      : new ManualProvider();

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
