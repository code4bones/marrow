import { useMutation } from '@apollo/client/react';
import { PlusCircleOutlined } from '@ant-design/icons';
import { Alert, Button, Form, Input, Modal, Radio, Select, message } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CREATE_LINK, RECORD_DECISION, SUPERSEDE_DECISION } from '../../shared/api/queries';
import { useWorkspaceStore } from '../../shared/model/workspace.store';

// Owner: "нужно уметь создать свою ноду (как потомка, или родителя) и
// сконнектить её уже в существующий флой... с пометкой 'я новая — обрати
// на меня внимание'". supersedes always goes through the dedicated
// supersedeDecision mutation (T-MEMORY-036 + the GraphQL wrapper added for
// this); every other relation goes through recordDecision(links: [...]) for
// the "descendant" direction (new → current) or recordDecision + a separate
// createLink for the "ancestor" direction (current → new), since
// recordDecision's own links field only ever creates outgoing edges from
// the record being created.
const RELATIONS = ['supersedes', 'relates_to', 'refines', 'derives_from', 'revives'] as const;
type Relation = (typeof RELATIONS)[number];
type Direction = 'descendant' | 'ancestor';

function relationLabel(t: (key: string) => string, relation: Relation): string {
  const labels: Record<Relation, string> = {
    supersedes: t('relationSupersedes'),
    relates_to: t('relationRelatesTo'),
    refines: t('relationRefines'),
    derives_from: t('relationDerivesFrom'),
    revives: t('relationRevives'),
  };
  return labels[relation];
}

interface Props {
  currentId: string;
  projectId: string | null;
}

export function CreateConnectedDecisionButton({ currentId, projectId }: Props) {
  const { t } = useTranslation('decisions');
  const [open, setOpen] = useState(false);
  const [relation, setRelation] = useState<Relation>('relates_to');
  const [direction, setDirection] = useState<Direction>('descendant');
  const [form] = Form.useForm();
  const setSelectedRecord = useWorkspaceStore((s) => s.setSelectedRecord);

  const [recordDecision, { loading: recording }] = useMutation<{ recordDecision: { id: string } }>(RECORD_DECISION);
  const [supersedeDecision, { loading: superseding }] = useMutation<{ supersedeDecision: { decision: { id: string } } }>(SUPERSEDE_DECISION);
  const [createLink, { loading: linking }] = useMutation(CREATE_LINK);
  const loading = recording || superseding || linking;

  const close = () => { setOpen(false); form.resetFields(); setRelation('relates_to'); setDirection('descendant'); };

  const onFinish = async (values: { title: string; decision: string; rationale?: string }) => {
    try {
      const tags = ['new', 'read-first'];
      let newId: string;

      if (relation === 'supersedes') {
        const res = await supersedeDecision({
          variables: {
            input: {
              project: projectId,
              supersedesId: currentId,
              title: values.title,
              decision: values.decision,
              rationale: values.rationale,
              tags,
            },
          },
          refetchQueries: ['GetProjectGraph'],
        });
        newId = res.data!.supersedeDecision.decision.id;
      } else if (direction === 'descendant') {
        const res = await recordDecision({
          variables: {
            input: {
              project: projectId,
              title: values.title,
              decision: values.decision,
              rationale: values.rationale,
              tags,
              links: [{ toId: currentId, relation }],
            },
          },
          refetchQueries: ['GetProjectGraph'],
        });
        newId = res.data!.recordDecision.id;
      } else {
        const res = await recordDecision({
          variables: {
            input: { project: projectId, title: values.title, decision: values.decision, rationale: values.rationale, tags },
          },
        });
        newId = res.data!.recordDecision.id;
        await createLink({
          variables: { input: { project: projectId, fromId: currentId, toId: newId, relation } },
          refetchQueries: ['GetProjectGraph'],
        });
      }

      message.success(t('newDecisionCreated'));
      close();
      setSelectedRecord(newId, 'decision');
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('failedToCreateDecision'));
    }
  };

  return (
    <>
      <Button size="small" icon={<PlusCircleOutlined />} onClick={() => setOpen(true)}>
        {t('addConnectedDecision')}
      </Button>
      <Modal
        open={open}
        onCancel={close}
        onOk={() => form.submit()}
        okButtonProps={{ loading }}
        okText={t('create')}
        title={t('addConnectedDecision')}
        width={520}
      >
        <Form form={form} layout="vertical" onFinish={onFinish} style={{ marginTop: 16 }}>
          <Form.Item label={t('relationToThisDecision')}>
            <Select
              value={relation}
              onChange={setRelation}
              options={RELATIONS.map((r) => ({ value: r, label: relationLabel(t, r) }))}
            />
          </Form.Item>
          {relation !== 'supersedes' && (
            <Form.Item label={t('direction')}>
              <Radio.Group value={direction} onChange={(e) => setDirection(e.target.value as Direction)}>
                <Radio.Button value="descendant">{t('newDecisionToThisOne')}</Radio.Button>
                <Radio.Button value="ancestor">{t('thisOneToNewDecision')}</Radio.Button>
              </Radio.Group>
            </Form.Item>
          )}
          <Form.Item name="title" label={t('title')} rules={[{ required: true }]}>
            <Input placeholder={t('shortTitle')} />
          </Form.Item>
          <Form.Item name="decision" label={t('decision')} rules={[{ required: true }]}>
            <Input.TextArea rows={3} placeholder={t('whatWasDecided')} style={{ fontSize: 12 }} />
          </Form.Item>
          <Form.Item
            name="rationale"
            label={t('rationale')}
            rules={relation === 'supersedes' ? [{ required: true, message: t('requiredForSupersedes') }] : []}
          >
            <Input.TextArea rows={3} placeholder={t('whyThisDecisionWhyNow')} style={{ fontSize: 12 }} />
          </Form.Item>
          <Alert
            type="info"
            showIcon
            message={t('taggedNewReadFirst')}
            style={{ marginBottom: 0 }}
          />
        </Form>
      </Modal>
    </>
  );
}
