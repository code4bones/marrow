import { useEffect, useState } from 'react';
import { useAuthStore } from '../model/auth.store';

/** null while loading or if the feature is disabled (TELEGRAM_BOT_TOKEN unset) -- callers should just skip rendering the widget in either case. */
export function useTelegramBotUsername(): string | null {
  const fetchTelegramBotUsername = useAuthStore((s) => s.fetchTelegramBotUsername);
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchTelegramBotUsername().then((value) => {
      if (!cancelled) setUsername(value);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchTelegramBotUsername]);

  return username;
}
