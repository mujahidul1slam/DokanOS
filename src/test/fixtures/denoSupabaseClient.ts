/** Vitest replacement target for the Edge Runtime's version-pinned npm: import. */
export function createClient(...args: unknown[]): never {
  throw new Error(`Unexpected unmocked Supabase client creation: ${args.length} arguments`);
}
