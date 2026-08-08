import type { Knex } from "knex";
import type { GitHttpFetch } from "../git-credentials.js";
import { BaseService } from "./base.js";

export class PgToolService extends BaseService {
  constructor(db: Knex, gitHttpFetch: GitHttpFetch = fetch) {
    super(db, gitHttpFetch);
  }
}
