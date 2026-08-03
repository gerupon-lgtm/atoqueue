import { Pool } from "pg";
import type { ApiConfig } from "../config.js";

export function createDatabasePool(config: Pick<ApiConfig, "databaseUrl">): Pool {
  return new Pool({ connectionString: config.databaseUrl });
}
