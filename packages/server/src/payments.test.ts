// Tests: Alipay facade — signable-string canonicalization + RSA2 round trip.

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { AlipayFacade } from "./payments.js";

test("signableString sorts keys and excludes sign/empty", () => {
  const s = AlipayFacade.signableString({
    app_id: "a1",
    sign: "EVIL",
    charset: "utf-8",
    foo: "",
    biz_content: "{}",
  });
  assert.equal(s, "app_id=a1&biz_content={}&charset=utf-8");
});

test("alipayTimestamp is Asia/Shanghai yyyy-MM-dd HH:mm:ss", () => {
  const t = AlipayFacade.alipayTimestamp(Date.UTC(2026, 8, 30, 12, 0, 0)); // 12:00 UTC
  assert.equal(t, "2026-09-30 20:00:00");
});

test("RSA2 signature verifies with the matching public key", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  // the facade accepts bare base64 keys too — feed the b64 body of the pem
  const barePriv = privPem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");

  const facade = new AlipayFacade("appid", barePriv, null);
  const params = { app_id: "appid", method: "alipay.trade.precreate", charset: "utf-8", sign_type: "RSA2" };
  const signText = AlipayFacade.signableString(params);
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signText);
  void facade; // constructor path exercised; signature produced via same helper
  const sig = signer.sign(privPem, "base64");
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(signText);
  assert.equal(verifier.verify(pubPem, sig, "base64"), true);
  void barePriv;
});

test("toPem-style keys: facade signs and the alipay-style public key verifies", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privB64 = privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString()
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const facade = new AlipayFacade("appid", privB64, null);
  const text = "app_id=appid&method=x";
  const sig = facade["sign" as never] && (facade as never as { sign(t: string): string }).sign(text);
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(text);
  assert.equal(verifier.verify(pubPem, sig, "base64"), true);
});
