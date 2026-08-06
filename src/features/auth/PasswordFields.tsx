import { Form, Input } from 'antd';

/**
 * Password + confirm-password fields for any "set a new credential" form
 * (bootstrap admin setup today; invite-claim and password-reset screens
 * reuse this too). Must be rendered inside an antd <Form> whose values
 * include a `password` field with this same name, so the confirm field's
 * validator can read it via getFieldValue.
 */
export function PasswordFields({ autoFocus = false }: { autoFocus?: boolean }) {
  return (
    <>
      <Form.Item
        name="password"
        label="Password"
        rules={[
          { required: true, message: 'Password is required' },
          { min: 8, message: 'At least 8 characters' },
        ]}
      >
        <Input.Password autoComplete="new-password" autoFocus={autoFocus} />
      </Form.Item>
      <Form.Item
        name="confirmPassword"
        label="Confirm password"
        dependencies={['password']}
        rules={[
          { required: true, message: 'Please confirm your password' },
          ({ getFieldValue }) => ({
            validator(_, value) {
              if (!value || getFieldValue('password') === value) {
                return Promise.resolve();
              }
              return Promise.reject(new Error('Passwords do not match'));
            },
          }),
        ]}
      >
        <Input.Password autoComplete="new-password" />
      </Form.Item>
    </>
  );
}
