import { Typography } from 'antd';
import { useParams } from 'react-router-dom';

export function ProjectsPage() {
  const { slug } = useParams();

  return (
    <div>
      <Typography.Title level={4} style={{ marginBottom: 16 }}>
        {slug ? `Project: ${slug}` : 'Projects'}
      </Typography.Title>
      <Typography.Text type="secondary">
        GraphQL connection pending — project list will load here.
      </Typography.Text>
    </div>
  );
}
