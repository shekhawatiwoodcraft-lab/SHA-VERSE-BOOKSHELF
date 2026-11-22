import test from "node:test";
import assert from "node:assert/strict";
import {
  classifySignUpOutcome,
  extractOAuthErrorFromLocation,
  formatAuthErrorMessage,
  normalizeAuthEmail,
} from "./authHelpers";

test("normalizeAuthEmail trims whitespace and lowercases email", () => {
  assert.equal(normalizeAuthEmail("  NewUser@Example.COM  "), "newuser@example.com");
});

test("classifySignUpOutcome distinguishes signed_in, needs_email_confirmation, and already_registered_unconfirmed", () => {
  assert.equal(
    classifySignUpOutcome({ user: { identities: [{}] }, session: { access_token: "abc" } }),
    "signed_in"
  );
  assert.equal(
    classifySignUpOutcome({ user: { identities: [{}] }, session: null }),
    "needs_email_confirmation"
  );
  assert.equal(
    classifySignUpOutcome({ user: { identities: [] }, session: null }),
    "already_registered_unconfirmed"
  );
});

test("formatAuthErrorMessage flags email not confirmed and rate limits cleanly", () => {
  const unconfirmed = formatAuthErrorMessage(new Error("Email not confirmed"));
  assert.equal(unconfirmed.isEmailNotConfirmed, true);
  assert.equal(unconfirmed.isRateLimited, false);

  const invalid = formatAuthErrorMessage({ message: "Invalid login credentials" });
  assert.equal(invalid.isInvalidCredentials, true);

  const rateLimited = formatAuthErrorMessage(new Error("Email rate limit exceeded"));
  assert.equal(rateLimited.isRateLimited, true);
});

test("extractOAuthErrorFromLocation parses query and hash OAuth errors", () => {
  assert.equal(
    extractOAuthErrorFromLocation("?error=server_error&error_description=Database+error+saving+new+user", ""),
    "Database error saving new user"
  );
  assert.match(
    extractOAuthErrorFromLocation("", "#error=access_denied&error_description=User+cancelled") || "",
    /Access Denied/i
  );
  assert.equal(extractOAuthErrorFromLocation("?tab=email", "#access_token=xyz"), null);
});
