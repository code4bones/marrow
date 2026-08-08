import { Form, Input } from 'antd';
import { useTranslation } from 'react-i18next';

/**
 * Password + confirm-password fields for any "set a new credential" form
 * (bootstrap admin setup today; invite-claim and password-reset screens
 * reuse this too). Must be rendered inside an antd <Form> whose values
 * include a `password` field with this same name, so the confirm field's
 * validator can read it via getFieldValue.
 */
export function PasswordFields({ autoFocus = false }: { autoFocus?: boolean }) {
  const { t } = useTranslation('profile');
  return (
    <>
      <Form.Item
        name="password"
        label={t('password')}
        rules={[
          { required: true, message: t('passwordRequired') },
          { min: 8, message: t('atLeast8Characters') },
        ]}
      >
        <Input.Password autoComplete="new-password" autoFocus={autoFocus} />
      </Form.Item>
      <Form.Item
        name="confirmPassword"
        label={t('confirmPassword')}
        dependencies={['password']}
        rules={[
          { required: true, message: t('pleaseConfirmPassword') },
          ({ getFieldValue }) => ({
            validator(_, value) {
              if (!value || getFieldValue('password') === value) {
                return Promise.resolve();
              }
              return Promise.reject(new Error(t('passwordsDoNotMatch')));
            },
          }),
        ]}
      >
        <Input.Password autoComplete="new-password" />
      </Form.Item>
    </>
  );
}
