export interface QueryClient {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: { hash: string; created_at: string | number }[] }>;
}

export function baseline(client: QueryClient, migrationsFolder: string): Promise<number>;
