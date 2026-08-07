import { useMutation, useQuery } from '@apollo/client/react';
import { EditOutlined, MessageOutlined } from '@ant-design/icons';
import { Button, Input, Space, Tag, Typography, message } from 'antd';
import { useState } from 'react';
import { CREATE_MEMORY, GET_MEMORY, GET_RECORD_LINKS, UPDATE_MEMORY } from '../../shared/api/queries';
import { Timestamp } from '../../shared/ui/Timestamp';
import { TONE_META, toneOf, type Tone } from './tone';

const { Text, Paragraph } = Typography;

// Remarks (I-PMEM idea, owner: "дополнить ноду своим комментарием... отметить
// как 'я ошибся' или 'это гениально — имей в виду'") are ordinary memory
// items (type: "remark") linked to their target via relation "annotates" —
// no backend change needed, this reuses memory.create/memory.update/links
// (T-MEMORY-032) end to end. Both strong tones get tagged read-first;
// surfacing read-first ahead of everything else in search/preflight is a
// separate backend follow-up, not done here. Tone/TONE_META/toneOf live in
// ./tone.tsx (not here) so this file keeps exporting only its component —
// T-MEMORY-045's timeline bottom remark indicator imports from there too.

function ToneButtons({ value, onChange, compact }: { value: Tone; onChange: (t: Tone) => void; compact?: boolean }) {
  return (
    <Space size={4} style={{ marginBottom: 6 }}>
      {(Object.keys(TONE_META) as Tone[]).map((t) => (
        <Button
          key={t}
          size="small"
          type={value === t ? 'primary' : 'default'}
          icon={TONE_META[t].icon}
          onClick={() => onChange(t)}
        >
          {compact ? null : TONE_META[t].label}
        </Button>
      ))}
    </Space>
  );
}

interface MemoryQueryResult {
  memory: { id: string; title: string; body: string | null; tags: string[]; createdAt: string | null; updatedAt: string | null };
}

function RemarkCard({ id }: { id: string }) {
  const { data, loading, refetch } = useQuery<MemoryQueryResult>(GET_MEMORY, { variables: { id } });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [tone, setTone] = useState<Tone>('note');
  const [update, { loading: saving }] = useMutation(UPDATE_MEMORY, {
    onCompleted: () => { message.success('Remark updated'); setEditing(false); void refetch(); },
    onError: (e) => message.error(e.message),
  });

  if (loading || !data?.memory) return null;
  const r = data.memory;
  const currentTone = toneOf(r.tags);
  const meta = TONE_META[currentTone];

  const startEdit = () => {
    setDraft(r.body ?? '');
    setTone(currentTone);
    setEditing(true);
  };

  const save = () => {
    if (!draft.trim()) return;
    const otherTags = r.tags.filter((t) => !t.startsWith('tone:') && t !== 'read-first');
    const tags = [...otherTags, ...(tone !== 'note' ? [`tone:${tone}`, 'read-first'] : [])];
    void update({ variables: { input: { id: r.id, body: draft, tags } } });
  };

  return (
    <div style={{
      border: `1px solid ${meta.color}55`, borderLeft: `3px solid ${meta.color}`,
      borderRadius: 4, padding: '8px 10px', marginBottom: 8, background: 'rgba(255,255,255,0.02)',
    }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <Space size={6}>
          <span style={{ color: meta.color }}>{meta.icon}</span>
          <Text style={{ fontSize: 11, color: meta.color, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            {meta.label}
          </Text>
          {r.tags.includes('read-first') && <Tag color="gold" style={{ fontSize: 9 }}>read first</Tag>}
        </Space>
        {!editing && <Button size="small" type="text" icon={<EditOutlined />} onClick={startEdit} />}
      </div>
      {editing ? (
        <>
          <ToneButtons value={tone} onChange={setTone} compact />
          <Input.TextArea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} style={{ fontSize: 12 }} />
          <Space style={{ marginTop: 6 }}>
            <Button size="small" type="primary" loading={saving} disabled={!draft.trim()} onClick={save}>Save</Button>
            <Button size="small" onClick={() => setEditing(false)}>Cancel</Button>
          </Space>
        </>
      ) : (
        <Paragraph style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>{r.body}</Paragraph>
      )}
      <Text type="secondary" style={{ fontSize: 10 }}>
        <Timestamp value={r.updatedAt ?? r.createdAt} />
      </Text>
    </div>
  );
}

function AddRemarkForm({ targetId, projectId, onDone }: { targetId: string; projectId: string | null; onDone: () => void }) {
  const [tone, setTone] = useState<Tone>('note');
  const [body, setBody] = useState('');
  const [create, { loading }] = useMutation(CREATE_MEMORY, {
    onCompleted: () => { message.success('Remark added'); setBody(''); onDone(); },
    onError: (e) => message.error(e.message),
  });

  const submit = () => {
    if (!body.trim()) return;
    const tags = ['remark', ...(tone !== 'note' ? [`tone:${tone}`, 'read-first'] : [])];
    void create({
      variables: {
        input: {
          project: projectId,
          common: projectId === null,
          type: 'remark',
          title: TONE_META[tone].title,
          body,
          tags,
          links: [{ toId: targetId, relation: 'annotates' }],
        },
      },
    });
  };

  return (
    <div style={{ marginTop: 4 }}>
      <ToneButtons value={tone} onChange={setTone} />
      <Input.TextArea
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={TONE_META[tone].placeholder}
        style={{ fontSize: 12 }}
      />
      <Button size="small" type="primary" loading={loading} disabled={!body.trim()} onClick={submit} style={{ marginTop: 6 }}>
        Add remark
      </Button>
    </div>
  );
}

interface Props {
  id: string;
  projectId: string | null;
}

export function RemarkPanel({ id, projectId }: Props) {
  const [adding, setAdding] = useState(false);
  const { data, loading, refetch } = useQuery<{ links: Array<{ id: string; fromId: string; toId: string; relation: string }> }>(
    GET_RECORD_LINKS,
    { variables: { id } },
  );

  if (loading) return null;
  const remarkIds = (data?.links ?? [])
    .filter((l) => l.relation === 'annotates' && l.toId === id)
    .map((l) => l.fromId);

  return (
    <div>
      {remarkIds.map((rid) => <RemarkCard key={rid} id={rid} />)}
      {adding ? (
        <AddRemarkForm targetId={id} projectId={projectId} onDone={() => { setAdding(false); void refetch(); }} />
      ) : (
        <Button size="small" icon={<MessageOutlined />} onClick={() => setAdding(true)}>Add remark</Button>
      )}
    </div>
  );
}
