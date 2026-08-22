import { useEffect, useRef } from 'react';

interface Props {
  botUsername: string;
  authUrl: string;
  size?: 'large' | 'medium' | 'small';
}

// T-MEMORY-094: the official Telegram Login Widget isn't a normal React
// element -- Telegram's own script (loaded from telegram.org) rewrites this
// <script> tag into an iframe button itself, so it has to be injected
// imperatively into a ref'd container rather than declared in JSX. Widget
// redirects the browser to `authUrl` on success, with its own signed fields
// (id/first_name/username/auth_date/hash) appended as query params --
// intent/returnTo baked into authUrl by the caller travel alongside them
// untouched (see verifyTelegramLoginPayload's field allowlist on the
// backend, which only ever reads Telegram's own fields out of the query).
export function TelegramLoginButton({ botUsername, authUrl, size = 'large' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    container.innerHTML = '';
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.setAttribute('data-telegram-login', botUsername);
    script.setAttribute('data-size', size);
    script.setAttribute('data-auth-url', authUrl);
    script.setAttribute('data-request-access', 'write');
    container.appendChild(script);
    return () => {
      container.innerHTML = '';
    };
  }, [botUsername, authUrl, size]);

  return <div ref={containerRef} />;
}
