import { createClient } from '@supabase/supabase-js'

let _client: ReturnType<typeof createClient> | null = null

function getClient() {
  if (!_client) {
    _client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    )
  }
  return _client
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getClient() as any).rpc('exec_sql', {
    query_text: sql,
    params: params ?? [],
  })
  if (error) throw new Error(`DB error: ${error.message}`)
  return (Array.isArray(data) ? data : []) as T[]
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(sql, params)
  return rows[0] ?? null
}

export async function execute(sql: string, params?: unknown[]): Promise<void> {
  await query(sql, params)
}
