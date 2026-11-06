const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

function isLocalOrigin(url) {
  return localHosts.has(url.hostname);
}

function isLocalRuntime(env) {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl)
    return env.NODE_ENV === "development" || env.NODE_ENV === "test";
  try {
    return isLocalOrigin(new URL(supabaseUrl));
  } catch {
    return false;
  }
}

/**
 * Returns the canonical application origin for Auth callback links.
 * A localhost fallback is permitted only while developing or testing locally.
 */
export function resolveApplicationOrigin(
  env = process.env,
  localRequestOrigin,
) {
  const configured = env.NEXT_PUBLIC_APP_URL?.trim();
  if (isLocalRuntime(env)) {
    if (localRequestOrigin) {
      try {
        const url = new URL(localRequestOrigin);
        if (/^https?:$/.test(url.protocol) && isLocalOrigin(url)) {
          return url.origin;
        }
      } catch {
        // Ignore malformed local request origins and use the safe local default.
      }
    }
    if (configured) {
      try {
        const url = new URL(configured);
        if (/^https?:$/.test(url.protocol) && isLocalOrigin(url)) {
          return url.origin;
        }
      } catch {
        // A local environment never falls through to an invalid configured URL.
      }
    }
    return "http://127.0.0.1:3000";
  }
  if (configured) {
    let url;
    try {
      url = new URL(configured);
    } catch {
      throw new Error("APPLICATION_ORIGIN_UNAVAILABLE");
    }
    if (!/^https?:$/.test(url.protocol) || isLocalOrigin(url)) {
      throw new Error("APPLICATION_ORIGIN_UNAVAILABLE");
    }
    return url.origin;
  }
  throw new Error("APPLICATION_ORIGIN_UNAVAILABLE");
}

const internalBase = "https://internal.invalid";

/**
 * Returns an application-relative path for a user-supplied redirect target,
 * or the fallback when the target could resolve outside the application.
 */
export function safeInternalPath(value, fallback) {
  if (!value?.startsWith("/")) return fallback;
  try {
    // Prefix checks miss what URL parsing normalizes: "/\host", "/<tab>/host", "/.//host".
    const url = new URL(value, internalBase);
    if (url.origin !== internalBase || url.pathname.startsWith("//")) {
      return fallback;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function passwordRecoveryRedirectUrl(
  env = process.env,
  localRequestOrigin,
) {
  return `${resolveApplicationOrigin(env, localRequestOrigin)}/auth/callback?next=/reset-password`;
}
