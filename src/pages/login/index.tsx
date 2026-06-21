import { Button, Card, Form, Input, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../shared/model/auth.store';

const { Title, Text } = Typography;

export function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const [form] = Form.useForm();

  const onFinish = ({ token }: { token: string }) => {
    login(token.trim());
    navigate('/projects', { replace: true });
  };

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#141414',
      }}
    >
      <Card style={{ width: 400 }}>
        <Title level={4} style={{ marginBottom: 4 }}>
          Project Memory
        </Title>
        <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
          Enter your access token to continue
        </Text>
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item
            name="token"
            label="Bearer Token"
            rules={[{ required: true, message: 'Token is required' }]}
          >
            <Input.Password placeholder="pmem_..." autoFocus />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" block>
              Connect
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
