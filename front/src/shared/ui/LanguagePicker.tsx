import { Select } from 'antd';
import { useTranslation } from 'react-i18next';

/**
 * Nobody's signed in yet on the auth screens (login, register), so the
 * profile page's language setting (LanguageSection) isn't reachable -- a
 * first-time visitor who doesn't read English needs a way to switch before
 * they can even read the form. Centered, borderless -- meant to sit quietly
 * below the form, not compete with it.
 */
export function LanguagePicker() {
  const { i18n } = useTranslation();
  return (
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
      <Select
        size="small"
        variant="borderless"
        value={i18n.language?.startsWith('ru') ? 'ru' : 'en'}
        onChange={(value: string) => void i18n.changeLanguage(value)}
        options={[
          { value: 'en', label: 'English' },
          { value: 'ru', label: 'Русский' },
        ]}
        style={{ width: 100 }}
      />
    </div>
  );
}
