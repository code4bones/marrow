import type { Knex } from "knex";
import * as z from "zod/v4";
import { defaultGatewayOutputSchema, gatewayToolSpecs } from "../tool-definitions.js";
import type { GitHttpFetch } from "../git-credentials.js";

export class BaseService {
  // T-MEMORY-044: injectable HTTP client for git.pipeline_status's outbound
  // GitLab REST calls -- defaults to the real global `fetch`, but a smoke
  // test can pass a fake here instead of this constructor reaching a real
  // GitLab instance over the network (the task's own acceptance criteria:
  // "the smoke test should NOT make real network calls").
  constructor(
    protected readonly db: Knex,
    protected readonly gitHttpFetch: GitHttpFetch = fetch
  ) {}

  listTools() {
    return gatewayToolSpecs.map(({ name, description, outputSchema }) => ({
      name,
      description,
      outputSchema: z.toJSONSchema(outputSchema ?? defaultGatewayOutputSchema)
    }));
  }
}
