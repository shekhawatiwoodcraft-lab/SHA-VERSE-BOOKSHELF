import crypto from "node:crypto";

export interface JwkKeyRecord {
  kid?: string;
  kty: string;
  alg?: string;
  use?: string;
  [key: string]: unknown;
}

export interface VerifiedJwtClaims {
  sub?: string;
  exp?: number;
  iss?: string;
  aud?: string | string[];
  role?: string;
}

function decodeBase64UrlJson<T>(segment: string): T | null {
  try {
    const json = Buffer.from(segment, "base64url").toString("utf8");
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export function verifyJwtWithJwks(
  token: string,
  jwks: JwkKeyRecord[],
  nowSeconds = Math.floor(Date.now() / 1000),
): { valid: boolean; claims?: VerifiedJwtClaims; reason?: string } {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false, reason: "malformed_jwt" };
  }

  const [headerB64, payloadB64, sigB64] = parts;
  const header = decodeBase64UrlJson<{ alg?: string; kid?: string }>(headerB64);
  const claims = decodeBase64UrlJson<VerifiedJwtClaims>(payloadB64);

  if (!header || !claims) {
    return { valid: false, reason: "invalid_json" };
  }

  if (typeof claims.exp === "number" && claims.exp <= nowSeconds) {
    return { valid: false, reason: "token_expired" };
  }

  const alg = header.alg || "";
  if (alg !== "ES256" && alg !== "RS256") {
    return { valid: false, reason: "unsupported_alg" };
  }

  const candidates = header.kid
    ? jwks.filter((k) => k.kid === header.kid)
    : jwks;

  if (candidates.length === 0) {
    return { valid: false, reason: "matching_jwk_not_found" };
  }

  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, "utf8");
  const signature = Buffer.from(sigB64, "base64url");

  for (const jwk of candidates) {
    try {
      const publicKey = crypto.createPublicKey({
        key: jwk as crypto.JsonWebKey,
        format: "jwk",
      });
      const verified =
        alg === "ES256"
          ? crypto.verify(
              "sha256",
              signingInput,
              { key: publicKey, dsaEncoding: "ieee-p1363" },
              signature,
            )
          : crypto.verify("RSA-SHA256", signingInput, publicKey, signature);

      if (verified) {
        return { valid: true, claims };
      }
    } catch {
      // Try next candidate JWK
    }
  }

  return { valid: false, reason: "invalid_signature" };
}
