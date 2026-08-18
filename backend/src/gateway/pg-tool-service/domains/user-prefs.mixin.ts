import { AppError } from "../../../shared/errors.js";
import { createUserPrefsFacade } from "../../user-prefs.js";
import type { NormalizedGatewayRequestContext, Row } from "../types.js";
import { type Constructor } from "../base.js";
import { type Tier1Instance } from "../core/links-core.mixin.js";

// T-MEMORY-086: per-user server-side preferences (pins + a generic
// scalar key/value store) -- every method here requires a real logged-in
// session (sessionUserId), same requirement credit.settings_update's admin
// gate has for a different reason: there is no meaningful "whose
// preference is this" for a static-token/OAuth-app/anonymous caller.
// Needs Tier1Instance (not just BaseService) for getProject(), used to
// resolve+membership-check the id/slug a pin call names.
export function UserPrefsMixin<TBase extends Constructor<Tier1Instance>>(Base: TBase) {
  return class extends Base {
  protected requireSessionUserId(context?: NormalizedGatewayRequestContext): string {
    if (!context?.sessionUserId) {
      throw new AppError("VALIDATION_ERROR", "This tool requires a logged-in session.");
    }
    return context.sessionUserId;
  }

  protected async pinProject(input: Row, context?: NormalizedGatewayRequestContext) {
    const userId = this.requireSessionUserId(context);
    const project = input.id
      ? await this.getProject({ id: String(input.id) }, context)
      : await this.getProject({ slug: String(input.slug) }, context);
    const pinned = Boolean(input.pinned);
    await createUserPrefsFacade(this.db).setProjectPin(userId, project.id, pinned);
    // getProject() doesn't itself join project_pins (only listProjects does)
    // -- the caller already knows the state it just set, so return the
    // already-fetched project with that override instead of a second query.
    return { ...project, pinned };
  }

  protected async userPreferencesGet(context?: NormalizedGatewayRequestContext) {
    const userId = this.requireSessionUserId(context);
    return createUserPrefsFacade(this.db).getPreferences(userId);
  }

  protected async userPreferenceSet(input: Row, context?: NormalizedGatewayRequestContext) {
    const userId = this.requireSessionUserId(context);
    const key = String(input.key);
    return createUserPrefsFacade(this.db).setPreference(userId, key, input.value);
  }
  };
}
