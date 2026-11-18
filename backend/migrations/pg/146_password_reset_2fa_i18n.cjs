const previous = {
  users: {
    resetPasswordWarning: {
      en: "Previous reset links will stop working. The password changes only when the user follows the new link.",
      ru: "Предыдущие ссылки для сброса перестанут работать. Пароль изменится, когда пользователь воспользуется новой ссылкой."
    },
    resetLinkInstructions: {
      en: "The link is valid for 24 hours and can be used once. After the password changes, all browser sessions end. Two-factor authentication remains enabled if configured.",
      ru: "Ссылка действует 24 часа и используется один раз. После смены пароля все сессии в браузерах завершатся. Настройки двухфакторной аутентификации сохранятся."
    }
  },
  auth: {
    passwordResetNotice: {
      en: "Your password has been reset. Sign in with your new password.",
      ru: "Ваш пароль сброшен. Войдите с новым паролем."
    }
  }
};

const entries = {
  users: {
    resetPasswordWarning: {
      en: "Previous reset links will stop working. When the user sets a new password, two-factor authentication and recovery codes will also be reset and all browser sessions will end.",
      ru: "Предыдущие ссылки для сброса перестанут работать. Когда пользователь задаст новый пароль, двухфакторная аутентификация и резервные коды также будут сброшены, а все сессии в браузерах завершатся."
    },
    resetLinkInstructions: {
      en: "The link is valid for 24 hours and can be used once. Setting a new password also disables two-factor authentication, removes the authenticator secret and recovery codes, and ends all browser sessions. The user can set up 2FA again in their profile.",
      ru: "Ссылка действует 24 часа и используется один раз. При установке нового пароля двухфакторная аутентификация отключится, секрет аутентификатора и резервные коды будут удалены, а все сессии в браузерах завершатся. Пользователь сможет настроить 2FA заново в профиле."
    }
  },
  auth: {
    passwordReset2faWarning: {
      en: "Setting a new password will also disable two-factor authentication, remove your authenticator secret and recovery codes, and end all browser sessions. After signing in, set up 2FA again in your profile.",
      ru: "При установке нового пароля двухфакторная аутентификация отключится, секрет аутентификатора и резервные коды будут удалены, а все сессии в браузерах завершатся. После входа настройте 2FA заново в профиле."
    },
    passwordResetNotice: {
      en: "Your password and two-factor authentication have been reset. Sign in with your new password, then set up 2FA again in your profile.",
      ru: "Ваш пароль и двухфакторная аутентификация сброшены. Войдите с новым паролем, затем настройте 2FA заново в профиле."
    }
  }
};

async function writeEntries(knex, values) {
  const updated_at = new Date().toISOString();
  const rows = Object.entries(values).flatMap(([namespace, keys]) =>
    Object.entries(keys).flatMap(([key, locales]) =>
      Object.entries(locales).map(([locale, value]) => ({ locale, namespace, key, value, updated_at }))
    )
  );
  await knex("translations").insert(rows).onConflict(["locale", "namespace", "key"]).merge(["value", "updated_at"]);
}

exports.up = async function up(knex) { await writeEntries(knex, entries); };
exports.down = async function down(knex) {
  await writeEntries(knex, previous);
  await knex("translations").where({ namespace: "auth", key: "passwordReset2faWarning" }).del();
};
