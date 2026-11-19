import test from "node:test";
import assert from "node:assert/strict";
import {
  BACKEND_DISCONNECTED_MESSAGE,
  createDisconnectedSupabaseClient,
} from "./disconnectedClient";

test("auth methods return null session/user cleanly without network calls", async () => {
  const sb = createDisconnectedSupabaseClient();
  const sess = await sb.auth.getSession();
  assert.equal(sess.data.session, null);
  assert.equal(sess.error, null);

  const user = await sb.auth.getUser();
  assert.equal(user.data.user, null);
  assert.equal(user.error, null);

  const sub = sb.auth.onAuthStateChange();
  assert.equal(typeof sub.data.subscription.unsubscribe, "function");

  const signIn = await sb.auth.signInWithPassword();
  assert.equal(signIn.data.session, null);
  assert.equal(signIn.error?.message, BACKEND_DISCONNECTED_MESSAGE);

  const signOut = await sb.auth.signOut();
  assert.equal(signOut.error, null);
});

test("query builder handles list reads, maybeSingle, single, writes, and rpc deterministically", async () => {
  const sb = createDisconnectedSupabaseClient();

  const listRes = await sb
    .from("books")
    .select("*")
    .eq("visibility", "public")
    .order("created_at", { ascending: false })
    .range(0, 19);
  assert.deepEqual(listRes.data, []);
  assert.equal(listRes.error, null);

  const maybeRes = await sb
    .from("profiles")
    .select("created_at")
    .eq("id", "123")
    .maybeSingle();
  assert.equal(maybeRes.data, null);
  assert.equal(maybeRes.error, null);

  const singleRes = await sb.from("books").select("*").eq("id", "123").single();
  assert.equal(singleRes.data, null);
  assert.equal(singleRes.error?.code, "BACKEND_DISCONNECTED");

  const writeRes = await sb.from("login_attempts").insert({ identifier: "a@b.com" });
  assert.equal(writeRes.data, null);
  assert.equal(writeRes.error?.code, "BACKEND_DISCONNECTED");

  const rpcRes = await sb.rpc("increment_book_views", { book_id: "123" });
  assert.equal(rpcRes.data, null);
  assert.equal(rpcRes.error?.code, "BACKEND_DISCONNECTED");
});

test("storage, functions, and realtime channels are safe no-ops", async () => {
  const sb = createDisconnectedSupabaseClient();

  const up = await sb.storage.from("books").upload();
  assert.equal(up.data, null);
  assert.equal(up.error?.message, BACKEND_DISCONNECTED_MESSAGE);

  const pub = sb.storage.from("books").getPublicUrl("foo/bar.pdf");
  assert.equal(pub.data.publicUrl, "");

  const fn = await sb.functions.invoke();
  assert.equal(fn.data, null);
  assert.equal(fn.error?.message, BACKEND_DISCONNECTED_MESSAGE);

  const ch = sb
    .channel("test")
    .on("postgres_changes", {}, () => {})
    .subscribe();
  assert.equal(typeof ch.unsubscribe, "function");
  assert.equal(await sb.removeChannel(), "ok");
});
