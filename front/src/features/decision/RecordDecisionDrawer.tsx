import { useMutation } from '@apollo/client/react';
import { HistoryOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Drawer, Form, Input, message } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RECORD_DECISION } from '../../shared/api/queries';

interface Props {
  projectSlug: string;
  onDone?: () => void;
  /**
   * When set, this drawer records a REPLACEMENT for the decision with this
   * id -- recordDecision() (backend) already marks that old decision
   * status="superseded" the moment a new one names it as supersedesId, this
   * just surfaces that as a one-click "Supersede" action on the old
   * decision's own row instead of requiring the old id to be typed in by
   * hand from the generic "+ Decision" form. The field is pre-filled and
   * locked here since it's implied by which row you clicked.
   */
  supersedesId?: string;
}

export function RecordDecisionDrawer({ projectSlug, onDone, supersedesId }: Props) {
  const { t } = useTranslation('decisions');
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [mutate, { loading }] = useMutation(RECORD_DECISION, {
    onCompleted: () => {
      message.success(supersedesId ? t('decisionSuperseded') : t('decisionRecorded'));
      form.resetFields();
      setOpen(false);
      onDone?.();
    },
    onError: (e) => message.error(e.message),
  });

  const onFinish = (values: Record<string, unknown>) => {
    mutate({
      variables: {
        input: {
          project: projectSlug,
          title: values.title,
          decision: values.decision,
          context: values.context || undefined,
          rationale: values.rationale || undefined,
          consequences: values.consequences || undefined,
          supersedesId: supersedesId ?? (values.supersedesId || undefined),
          tags: values.tags ? String(values.tags).split(',').map((s: string) => s.trim()).filter(Boolean) : undefined,
        },
      },
    });
  };

  return (
    <>
      {supersedesId ? (
        <Button size="small" type="text" icon={<HistoryOutlined />} title={t('supersede')} onClick={() => setOpen(true)} />
      ) : (
        <Button size="small" icon={<PlusOutlined />} onClick={() => setOpen(true)}>{t('decision')}</Button>
      )}
      <Drawer
        title={supersedesId ? t('supersedeDecisionTitle', { id: supersedesId }) : t('recordDecision')}
        open={open}
        onClose={() => setOpen(false)}
        width={540}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setOpen(false)}>{t('cancel')}</Button>
            <Button type="primary" loading={loading} onClick={() => form.submit()}>
              {supersedesId ? t('supersede') : t('record')}
            </Button>
          </div>
        }
      >
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item name="title" label={t('title')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="decision" label={t('decision')} rules={[{ required: true }]}>
            <Input.TextArea rows={3} placeholder={t('whatWasDecidedQ')} />
          </Form.Item>
          <Form.Item name="context" label={t('context')}>
            <Input.TextArea rows={3} placeholder={t('whyWasThisNeeded')} />
          </Form.Item>
          <Form.Item name="rationale" label={t('rationale')}>
            <Input.TextArea rows={3} placeholder={t('whyThisOption')} />
          </Form.Item>
          <Form.Item name="consequences" label={t('consequences')}>
            <Input.TextArea rows={2} placeholder={t('tradeOffsImplications')} />
          </Form.Item>
          {supersedesId ? (
            <Form.Item label={t('supersedesId')}>
              <Input value={supersedesId} disabled style={{ fontFamily: 'monospace' }} />
            </Form.Item>
          ) : (
            <Form.Item name="supersedesId" label={t('supersedesId')}>
              <Input placeholder="D-PMEM-001" style={{ fontFamily: 'monospace' }} />
            </Form.Item>
          )}
          <Form.Item name="tags" label={t('tagsCommaSeparated')}>
            <Input placeholder="frontend, graphql" />
          </Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
