import { type Constructor, BaseService } from "../base.js";

// Backend-served i18n strings (T-MEMORY i18n pilot). Self-contained: unlike
// most domain mixins this has no dependency on other mixins' state, since
// it only ever reads the flat `translations` table (see
// 018_translations.cjs) keyed by (locale, namespace, key). Called from the
// unauthenticated GET /i18n/:locale/:namespace route in http-server.ts --
// see that route's comment for why it deliberately skips the
// {ok,data} envelope every other route in this file uses.
export function I18nMixin<TBase extends Constructor<BaseService>>(Base: TBase) {
  return class extends Base {
  async i18nBundle(locale: string, namespace: string): Promise<Record<string, string>> {
    const rows = await this.db("translations")
      .select("key", "value")
      .where({ locale, namespace });
    return rows.reduce<Record<string, string>>((bundle, row) => {
      bundle[String(row.key)] = String(row.value);
      return bundle;
    }, {});
  }
  };
}
