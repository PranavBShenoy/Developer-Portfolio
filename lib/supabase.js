// lib/supabase.js
// Native lightweight Supabase client wrapper using standard Node.js fetch
// Avoids heavy runtime dependencies while guaranteeing exact PostgREST and Auth semantics.

export function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return {
    url: url.replace(/\/$/, ''),
    anonKey,
    serviceRoleKey,
  };
}

/**
 * Verifies an access token with Supabase Auth and returns the user object.
 */
export async function verifySupabaseToken(accessToken) {
  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) {
    throw new Error('Supabase configuration missing (SUPABASE_URL or SUPABASE_ANON_KEY).');
  }

  const response = await fetch(`${url}/auth/v1/user`, {
    method: 'GET',
    headers: {
      'apikey': anonKey,
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.message || errorBody.msg || 'Invalid or expired authentication token.');
  }

  return response.json();
}

/**
 * Authenticates user credentials via Supabase Auth (Native signInWithPassword).
 */
export async function signInWithSupabase(email, password) {
  const { url, anonKey } = getSupabaseConfig();
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'apikey': anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error_description || data.msg || 'Invalid login credentials.');
  }

  return data;
}

/**
 * Rotates tokens via Supabase Auth (Native refresh_token).
 */
export async function refreshSupabaseSession(refreshToken) {
  const { url, anonKey } = getSupabaseConfig();
  const response = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      'apikey': anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error_description || data.msg || 'Session expired or refresh token invalid.');
  }

  return data;
}

/**
 * Executes a PostgreSQL RPC function with the caller's JWT, ensuring auth.uid()
 * natively resolves to the authenticated administrator.
 */
export async function callAuthenticatedRpc(rpcName, params = {}, accessToken) {
  const { url, anonKey } = getSupabaseConfig();
  const response = await fetch(`${url}/rest/v1/rpc/${rpcName}`, {
    method: 'POST',
    headers: {
      'apikey': anonKey,
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(params),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.hint || `RPC ${rpcName} execution failed.`);
  }

  return data;
}

/**
 * Executes a lightweight read query using the minimal-permission anon key.
 * Used for keepalive health-checks and public queries without service-role privileges.
 */
export async function queryAnon(endpoint, options = {}) {
  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) {
    throw new Error('Supabase configuration missing (SUPABASE_URL or SUPABASE_ANON_KEY).');
  }

  const headers = {
    'apikey': anonKey,
    'Authorization': `Bearer ${anonKey}`,
    'Content-Type': 'application/json',
    'Prefer': options.prefer || 'return=representation',
    ...(options.headers || {}),
  };

  const response = await fetch(`${url}/rest/v1/${endpoint}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text();

  if (!response.ok) {
    const errorMsg = data && typeof data === 'object' ? data.message || JSON.stringify(data) : data;
    throw new Error(errorMsg || `Database query to ${endpoint} failed with HTTP ${response.status}`);
  }

  return data;
}

export async function queryServiceRole(endpoint, options = {}) {
  const { url, serviceRoleKey } = getSupabaseConfig();
  const headers = {
    'apikey': serviceRoleKey,
    'Authorization': `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
    'Prefer': options.prefer || 'return=representation',
    ...(options.headers || {}),
  };

  const response = await fetch(`${url}/rest/v1/${endpoint}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text();

  if (!response.ok) {
    const errorMsg = data && typeof data === 'object' ? data.message || JSON.stringify(data) : data;
    throw new Error(errorMsg || `Database query to ${endpoint} failed with HTTP ${response.status}`);
  }

  return data;
}
