import { useMutation } from '@apollo/client/react';
import { PlusCircleOutlined } from '@ant-design/icons';
import { Alert, Button, Form, Input, Modal, Radio, Select, message } from 'antd';
import { useState } from 'react';
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

const RELATION_LABEL: Record<Relation, string> = {
  supersedes: 'Supersedes it (replaces this decision)',
  relates_to: 'Relates to it',
  refines: 'Refines it',
  derives_from: 'Derives from it',
  revives: 'Revives it (brings a rejected/superseded idea back)',
};

interface Props {
  currentId: string;
  projectId: string | null;
}

export function CreateConnectedDecisionButton({ currentId, projectId }: Props) {
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

      message.success('New decision created and connected');
      close();
      setSelectedRecord(newId, 'decision');
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to create decision');
    }
  };

  return (
    <>
      <Button size="small" icon={<PlusCircleOutlined />} onClick={() => setOpen(true)}>
        Add connected decision
      </Button>
      <Modal
        open={open}
        onCancel={close}
        onOk={() => form.submit()}
        okButtonProps={{ loading }}
        okText="Create"
        title="Add connected decision"
        width={520}
      >
        <Form form={form} layout="vertical" onFinish={onFinish} style={{ marginTop: 16 }}>
          <Form.Item label="Relation to this decision">
            <Select
              value={relation}
              onChange={setRelation}
              options={RELATIONS.map((r) => ({ value: r, label: RELATION_LABEL[r] }))}
            />
          </Form.Item>
          {relation !== 'supersedes' && (
            <Form.Item label="Direction">
              <Radio.Group value={direction} onChange={(e) => setDirection(e.target.value as Direction)}>
                <Radio.Button value="descendant">New decision → this one</Radio.Button>
                <Radio.Button value="ancestor">This one → new decision</Radio.Button>
              </Radio.Group>
            </Form.Item>
          )}
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input placeholder="Short title" />
          </Form.Item>
          <Form.Item name="decision" label="Decision" rules={[{ required: true }]}>
            <Input.TextArea rows={3} placeholder="What was decided" style={{ fontSize: 12 }} />
          </Form.Item>
          <Form.Item
            name="rationale"
            label="Rationale"
            rules={relation === 'supersedes' ? [{ required: true, message: 'Required for supersedes — explain why the old decision no longer holds' }] : []}
          >
            <Input.TextArea rows={3} placeholder="Why this decision, why now" style={{ fontSize: 12 }} />
          </Form.Item>
          <Alert
            type="info"
            showIcon
            message="Tagged new + read-first so it stands out until reviewed."
            style={{ marginBottom: 0 }}
          />
        </Form>
      </Modal>
    </>
  );
}
