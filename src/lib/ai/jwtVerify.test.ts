import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyJwtWithJwks, type JwkKeyRecord } from "./jwtVerify";

function signTestEs256Jwt(
  privateKey: crypto.KeyObject,
  payload: Record<string, unknown>,
  kid = "test-ec-1",
): string {
  const header = Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT", kid })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const input = `${header}.${body}`;
  const sig = crypto
    .sign("sha256", Buffer.from(input), { key: privateKey, dsaEncoding: "ieee-p1363" })
    .toString("base64url");
  return `${input}.${sig}`;
}

test("verifyJwtWithJwks validates valid ES256 token and rejects expired or tampered tokens", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const pubJwk = {
    ...(publicKey.export({ format: "jwk" }) as JwkKeyRecord),
    kid: "test-ec-1",
    alg: "ES256",
    use: "sig",
  };

  const now = 2_000_000_000;
  const validToken = signTestEs256Jwt(privateKey, { sub: "user-123", exp: now + 3600 }, "test-ec-1");
  const ok = verifyJwtWithJwks(validToken, [pubJwk], now);
  assert.equal(ok.valid, true);
  assert.equal(ok.claims?.sub, "user-123");

  const expiredToken = signTestEs256Jwt(privateKey, { sub: "user-123", exp: now - 10 }, "test-ec-1");
  const expRes = verifyJwtWithJwks(expiredToken, [pubJwk], now);
  assert.equal(expRes.valid, false);
  assert.equal(expRes.reason, "token_expired");

  const tampered = `${validToken.slice(0, -4)}AAAA`;
  const badSig = verifyJwtWithJwks(tampered, [pubJwk], now);
  assert.equal(badSig.valid, false);
});
