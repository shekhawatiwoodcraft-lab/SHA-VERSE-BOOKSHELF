export const BACKEND_DISCONNECTED_MESSAGE =
  "Backend is disconnected. Configure a new backend to enable authentication and database sync.";

export interface DisconnectedError {
  message: string;
  code: string;
  details: string;
  hint: string;
}

function makeDisconnectedError(): DisconnectedError {
  return {
    message: BACKEND_DISCONNECTED_MESSAGE,
    code: "BACKEND_DISCONNECTED",
    details: "",
    hint: "",
  };
}

export interface QueryResult {
  data: unknown;
  error: DisconnectedError | null;
  count: number | null;
  status: number;
  statusText: string;
}

export interface DisconnectedQueryBuilder extends PromiseLike<QueryResult> {
  select: (...args: unknown[]) => DisconnectedQueryBuilder;
  insert: (...args: unknown[]) => DisconnectedQueryBuilder;
  update: (...args: unknown[]) => DisconnectedQueryBuilder;
  upsert: (...args: unknown[]) => DisconnectedQueryBuilder;
  delete: (...args: unknown[]) => DisconnectedQueryBuilder;
  eq: (...args: unknown[]) => DisconnectedQueryBuilder;
  neq: (...args: unknown[]) => DisconnectedQueryBuilder;
  gt: (...args: unknown[]) => DisconnectedQueryBuilder;
  gte: (...args: unknown[]) => DisconnectedQueryBuilder;
  lt: (...args: unknown[]) => DisconnectedQueryBuilder;
  lte: (...args: unknown[]) => DisconnectedQueryBuilder;
  in: (...args: unknown[]) => DisconnectedQueryBuilder;
  is: (...args: unknown[]) => DisconnectedQueryBuilder;
  or: (...args: unknown[]) => DisconnectedQueryBuilder;
  not: (...args: unknown[]) => DisconnectedQueryBuilder;
  filter: (...args: unknown[]) => DisconnectedQueryBuilder;
  match: (...args: unknown[]) => DisconnectedQueryBuilder;
  order: (...args: unknown[]) => DisconnectedQueryBuilder;
  limit: (...args: unknown[]) => DisconnectedQueryBuilder;
  range: (...args: unknown[]) => DisconnectedQueryBuilder;
  single: () => DisconnectedQueryBuilder;
  maybeSingle: () => DisconnectedQueryBuilder;
  catch: (onRejected?: (r: unknown) => unknown) => Promise<unknown>;
  finally: (onFinally?: () => void) => Promise<QueryResult>;
}

function createQueryBuilder(initialMode: "read" | "write" = "read"): DisconnectedQueryBuilder {
  let mode: "read" | "write" = initialMode;
  let cardinality: "many" | "single" | "maybeSingle" = "many";

  const resolveResult = (): QueryResult => {
    if (mode === "write") {
      return {
        data: null,
        error: makeDisconnectedError(),
        count: null,
        status: 503,
        statusText: "Service Unavailable",
      };
    }
    if (cardinality === "single") {
      return {
        data: null,
        error: makeDisconnectedError(),
        count: null,
        status: 503,
        statusText: "Service Unavailable",
      };
    }
    if (cardinality === "maybeSingle") {
      return {
        data: null,
        error: null,
        count: null,
        status: 200,
        statusText: "OK",
      };
    }
    return {
      data: [],
      error: null,
      count: 0,
      status: 200,
      statusText: "OK",
    };
  };

  const builder = {} as DisconnectedQueryBuilder;

  const proxy: DisconnectedQueryBuilder = new Proxy(builder, {
    get(_target, prop) {
      if (prop === "then") {
        return (onFulfilled?: (v: QueryResult) => unknown, onRejected?: (r: unknown) => unknown) =>
          Promise.resolve(resolveResult()).then(onFulfilled, onRejected);
      }
      if (prop === "catch") {
        return (onRejected?: (r: unknown) => unknown) => Promise.resolve(resolveResult()).catch(onRejected);
      }
      if (prop === "finally") {
        return (onFinally?: () => void) => Promise.resolve(resolveResult()).finally(onFinally);
      }
      if (prop === "insert" || prop === "update" || prop === "upsert" || prop === "delete") {
        return () => {
          mode = "write";
          return proxy;
        };
      }
      if (prop === "single") {
        return () => {
          cardinality = "single";
          return proxy;
        };
      }
      if (prop === "maybeSingle") {
        return () => {
          cardinality = "maybeSingle";
          return proxy;
        };
      }
      if (prop === "select") {
        return () => proxy;
      }
      return () => proxy;
    },
  });

  return proxy;
}

export interface DisconnectedChannel {
  on: (...args: unknown[]) => DisconnectedChannel;
  subscribe: (...args: unknown[]) => DisconnectedChannel;
  unsubscribe: () => Promise<string>;
  send: () => Promise<string>;
  track: () => Promise<string>;
  untrack: () => Promise<string>;
}

function createChannelStub(): DisconnectedChannel {
  const channelStub: DisconnectedChannel = {
    on: () => channelStub,
    subscribe: () => channelStub,
    unsubscribe: async () => "ok",
    send: async () => "error",
    track: async () => "error",
    untrack: async () => "ok",
  };
  return channelStub;
}

export function createDisconnectedSupabaseClient() {
  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      refreshSession: async () => ({ data: { session: null, user: null }, error: null }),
      onAuthStateChange: () => ({
        data: {
          subscription: {
            id: "disconnected",
            callback: () => {},
            unsubscribe: () => {},
          },
        },
      }),
      signInWithPassword: async () => ({
        data: { user: null, session: null },
        error: new Error(BACKEND_DISCONNECTED_MESSAGE),
      }),
      signUp: async () => ({
        data: { user: null, session: null },
        error: new Error(BACKEND_DISCONNECTED_MESSAGE),
      }),
      signInWithOtp: async () => ({
        data: { user: null, session: null },
        error: new Error(BACKEND_DISCONNECTED_MESSAGE),
      }),
      verifyOtp: async () => ({
        data: { user: null, session: null },
        error: new Error(BACKEND_DISCONNECTED_MESSAGE),
      }),
      signInWithIdToken: async () => ({
        data: { user: null, session: null },
        error: new Error(BACKEND_DISCONNECTED_MESSAGE),
      }),
      signInWithOAuth: async () => ({
        data: { provider: "google", url: null },
        error: new Error(BACKEND_DISCONNECTED_MESSAGE),
      }),
      setSession: async () => ({
        data: { user: null, session: null },
        error: new Error(BACKEND_DISCONNECTED_MESSAGE),
      }),
      signOut: async () => ({ error: null }),
      updateUser: async () => ({
        data: { user: null },
        error: new Error(BACKEND_DISCONNECTED_MESSAGE),
      }),
    },
    from: (_table: string) => createQueryBuilder("read"),
    rpc: (_fn: string, _args?: Record<string, unknown>) => createQueryBuilder("write"),
    storage: {
      from: (_bucket: string) => ({
        upload: async () => ({ data: null, error: new Error(BACKEND_DISCONNECTED_MESSAGE) }),
        update: async () => ({ data: null, error: new Error(BACKEND_DISCONNECTED_MESSAGE) }),
        download: async () => ({ data: null, error: new Error(BACKEND_DISCONNECTED_MESSAGE) }),
        list: async () => ({ data: [], error: null }),
        remove: async () => ({ data: null, error: new Error(BACKEND_DISCONNECTED_MESSAGE) }),
        move: async () => ({ data: null, error: new Error(BACKEND_DISCONNECTED_MESSAGE) }),
        copy: async () => ({ data: null, error: new Error(BACKEND_DISCONNECTED_MESSAGE) }),
        createSignedUrl: async () => ({ data: null, error: new Error(BACKEND_DISCONNECTED_MESSAGE) }),
        createSignedUrls: async () => ({ data: null, error: new Error(BACKEND_DISCONNECTED_MESSAGE) }),
        getPublicUrl: (_path: string) => ({ data: { publicUrl: "" } }),
      }),
    },
    functions: {
      invoke: async () => ({ data: null, error: new Error(BACKEND_DISCONNECTED_MESSAGE) }),
    },
    channel: (_name: string) => createChannelStub(),
    removeChannel: async () => "ok",
    removeAllChannels: async () => [],
    getChannels: () => [],
    realtime: {
      setAuth: (_token: string | null) => {},
      connect: () => {},
      disconnect: () => {},
    },
  };
}
