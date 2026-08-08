import { useQuery } from '@apollo/client/react';
import { Alert, Divider, Drawer, Skeleton, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { GET_ARTIFACT_TEXT, GET_RECORD, GET_RECORD_LINKS } from '../../shared/api/queries';
import type {
  Artifact, Decision, Event, Link, MemoryRecord, Project, RecordWrapper, Task,
} from '../../shared/model/types';
import { ENTITY_COLOR, type EntityType } from '../../shared/lib/entityId';
import { AddTaskNoteButton } from '../../features/task/AddTaskNoteButton';
import { ClaimTaskButton } from '../../features/task/ClaimTaskButton';
import { CompleteTaskButton } from '../../features/task/CompleteTaskButton';
import { TaskClaimsPanel } from '../../features/task/TaskClaimsPanel';
import { RemarkPanel } from '../../features/remark/RemarkPanel';
import { CreateConnectedDecisionButton } from '../../features/decision/CreateConnectedDecisionButton';
import { RecordLink } from '../../shared/ui/RecordLink';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { Timestamp } from '../../shared/ui/Timestamp';
import { useWorkspaceStore } from '../../shared/model/workspace.store';

const { Text, Paragraph } = Typography;

function kindLabel(t: (key: string) => string): Record<string, string> {
  return {
    TASK: t('kindTask'), DECISION: t('kindDecision'), ARTIFACT: t('kindArtifact'),
    MEMORY: t('kindMemory'), EVENT: t('kindEvent'), LINK: t('kindLink'), PROJECT: t('kindProject'),
  };
}

const KIND_TYPE: Record<string, EntityType> = {
  TASK: 'task', DECISION: 'decision', ARTIFACT: 'artifact',
  MEMORY: 'memory', EVENT: 'event', LINK: 'link', PROJECT: 'project',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8, display: 'block', marginBottom: 4 }}>
        {label}
      </Text>
      <div>{children}</div>
    </div>
  );
}

function TagList({ items }: { items: string[] }) {
  if (!items.length) return null;
  return <>{items.map((item) => <Tag key={item} style={{ fontSize: 11 }}>{item}</Tag>)}</>;
}

function StringFiles({ items, label }: { items: string[]; label: string }) {
  if (!items.length) return null;
  return (
    <Field label={label}>
      {items.map((f) => <Tag key={f} style={{ fontSize: 11, fontFamily: 'monospace', marginBottom: 3 }}>{f}</Tag>)}
    </Field>
  );
}

function ArtifactTextPreview({ id }: { id: string }) {
  const { t } = useTranslation('common');
  const { data, loading, error } = useQuery<{
    artifactText: { text: string; textInfo: { truncated: boolean } }
  }>(GET_ARTIFACT_TEXT, { variables: { id } });

  if (loading) return <Skeleton active paragraph={{ rows: 4 }} />;
  if (error) return <Alert type="warning" message={t('textPreviewUnavailable')} />;
  const at = data!.artifactText;
  return (
    <Field label={at.textInfo.truncated ? t('contentTruncated') : t('content')}>
      <pre style={{
        background: 'rgba(255,255,255,0.04)', border: '1px solid #303030',
        borderRadius: 4, padding: 12, fontSize: 12,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        maxHeight: 420, overflowY: 'auto', margin: 0,
      }}>
        {at.text}
      </pre>
    </Field>
  );
}

function TaskBody({ r }: { r: Task }) {
  const { t } = useTranslation('common');
  return (
    <>
      <Field label={t('status')}><StatusBadge status={r.status} /></Field>
      {r.priority != null && <Field label={t('priority')}><Text>{r.priority}</Text></Field>}
      {r.milestone && <Field label={t('milestone')}><Text>{r.milestone}</Text></Field>}
      {r.scope && <Field label={t('scope')}><Paragraph style={{ margin: 0 }}>{r.scope}</Paragraph></Field>}
      {r.acceptance && <Field label={t('acceptanceCriteria')}><Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.acceptance}</Paragraph></Field>}
      {r.notes && <Field label={t('notes')}><Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.notes}</Paragraph></Field>}
      <StringFiles items={r.allowedFiles} label={t('allowedFiles')} />
      <StringFiles items={r.forbiddenFiles} label={t('forbiddenFiles')} />
      {r.dependsOn.length > 0 && (
        <Field label={t('dependsOn')}>{r.dependsOn.map((d) => <RecordLink key={d} id={d} />)}</Field>
      )}
      <Field label={t('updated')}><Timestamp value={r.updatedAt} /></Field>
      <TaskClaimsPanel taskId={r.id} activeClaimCount={r.activeClaimCount ?? 0} />
      <Divider style={{ margin: '8px 0 12px' }} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <ClaimTaskButton taskId={r.id} />
        <AddTaskNoteButton taskId={r.id} />
        <CompleteTaskButton taskId={r.id} activeClaimCount={r.activeClaimCount ?? 0} />
      </div>
    </>
  );
}

function DecisionBody({ r, projectId }: { r: Decision; projectId: string | null }) {
  const { t } = useTranslation('common');
  return (
    <>
      <Field label={t('status')}><StatusBadge status={r.status} /></Field>
      {r.tags.length > 0 && <Field label={t('tags')}><TagList items={r.tags} /></Field>}
      {r.context && <Field label={t('context')}><Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.context}</Paragraph></Field>}
      {r.decision && <Field label={t('decision')}><Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.decision}</Paragraph></Field>}
      {r.rationale && <Field label={t('rationale')}><Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.rationale}</Paragraph></Field>}
      {r.consequences && <Field label={t('consequences')}><Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.consequences}</Paragraph></Field>}
      {r.supersedesId && <Field label={t('supersedes')}><RecordLink id={r.supersedesId} /></Field>}
      <Field label={t('updated')}><Timestamp value={r.updatedAt} /></Field>
      <CreateConnectedDecisionButton currentId={r.id} projectId={projectId} />
    </>
  );
}

function ArtifactBody({ r }: { r: Artifact }) {
  const { t } = useTranslation('common');
  const isText = r.contentType?.startsWith('text/') || r.contentType?.includes('json') || r.contentType?.includes('xml');
  return (
    <>
      <Field label={t('path')}><Text code style={{ fontSize: 12 }}>{r.path}</Text></Field>
      <Field label={t('scope')}><Tag style={{ fontSize: 11 }}>{r.scope}</Tag></Field>
      <Field label={t('status')}><StatusBadge status={r.status} /></Field>
      {r.contentType && <Field label={t('contentType')}><Text>{r.contentType}</Text></Field>}
      {r.sizeBytes != null && <Field label={t('size')}><Text>{(r.sizeBytes / 1024).toFixed(1)} KB</Text></Field>}
      {r.description && <Field label={t('description')}><Paragraph style={{ margin: 0 }}>{r.description}</Paragraph></Field>}
      {r.tags.length > 0 && <Field label={t('tags')}><TagList items={r.tags} /></Field>}
      <Field label={t('updated')}><Timestamp value={r.updatedAt} /></Field>
      {isText && <ArtifactTextPreview id={r.id} />}
    </>
  );
}

function MemoryBody({ r }: { r: MemoryRecord }) {
  const { t } = useTranslation('common');
  return (
    <>
      <Field label={t('type')}><Tag style={{ fontSize: 11 }}>{r.type}</Tag></Field>
      <Field label={t('status')}><StatusBadge status={r.status} /></Field>
      {r.tags.length > 0 && <Field label={t('tags')}><TagList items={r.tags} /></Field>}
      {r.excerpt && <Field label={t('excerpt')}><Text type="secondary" style={{ fontSize: 12 }}>{r.excerpt}</Text></Field>}
      {r.body && (
        <Field label={t('body')}>
          <pre style={{
            background: 'rgba(255,255,255,0.04)', border: '1px solid #303030',
            borderRadius: 4, padding: 12, fontSize: 12,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            maxHeight: 480, overflowY: 'auto', margin: 0,
          }}>
            {r.body}
          </pre>
        </Field>
      )}
      <Field label={t('updated')}><Timestamp value={r.updatedAt} /></Field>
    </>
  );
}

function EventBody({ r }: { r: Event }) {
  const { t } = useTranslation('common');
  return (
    <>
      <Field label={t('type')}><Tag style={{ fontSize: 11 }}>{r.type}</Tag></Field>
      {r.relatedId && <Field label={t('related')}><RecordLink id={r.relatedId} /></Field>}
      <Field label={t('at')}><Timestamp value={r.createdAt} /></Field>
    </>
  );
}

function LinkBody({ r }: { r: Link }) {
  const { t } = useTranslation('common');
  return (
    <>
      <Field label={t('from')}><RecordLink id={r.fromId} /></Field>
      <Field label={t('relation')}><Tag style={{ fontSize: 11 }}>{r.relation}</Tag></Field>
      <Field label={t('to')}><RecordLink id={r.toId} /></Field>
      <Field label={t('at')}><Timestamp value={r.createdAt} /></Field>
    </>
  );
}

function ProjectBody({ r }: { r: Project }) {
  const { t } = useTranslation('common');
  return (
    <>
      <Field label={t('slug')}><Text code>{r.slug}</Text></Field>
      <Field label={t('status')}><StatusBadge status={r.status} /></Field>
      {r.description && <Field label={t('description')}><Paragraph style={{ margin: 0 }}>{r.description}</Paragraph></Field>}
      {r.rootPath && <Field label={t('rootPath')}><Text code style={{ fontSize: 12 }}>{r.rootPath}</Text></Field>}
      <Field label={t('updated')}><Timestamp value={r.updatedAt} /></Field>
    </>
  );
}

function RecordBody({ wrapper }: { wrapper: RecordWrapper }) {
  const { t } = useTranslation('common');
  const r = wrapper.record;
  if (!r) return <Alert type="warning" message={t('recordPayloadEmpty')} />;
  switch (r.__typename) {
    case 'Task':        return <TaskBody r={r} />;
    case 'Decision':    return <DecisionBody r={r} projectId={wrapper.projectId} />;
    case 'Artifact':    return <ArtifactBody r={r} />;
    case 'MemoryRecord': return <MemoryBody r={r} />;
    case 'Event':       return <EventBody r={r} />;
    case 'Link':        return <LinkBody r={r} />;
    case 'Project':     return <ProjectBody r={r} />;
    default:            return <Alert type="info" message={t('unknownType', { type: (r as { __typename?: string })?.__typename })} />;
  }
}

// Reused for every record kind (task/decision/artifact/memory/event) so
// "drilling in" isn't specific to the decision timeline — click a linked
// record here and the same drawer re-fetches to show it, letting you walk
// the graph one hop at a time from any starting point.
function LinksSection({ id }: { id: string }) {
  const { t } = useTranslation('common');
  const { data, loading } = useQuery<{ links: Link[] }>(GET_RECORD_LINKS, { variables: { id } });
  if (loading) return null;
  // "annotates" links are remarks — RemarkPanel renders those with full
  // body/tone, so they're excluded here to avoid showing the same thing twice.
  const links = (data?.links ?? []).filter((l) => l.relation !== 'annotates');
  if (links.length === 0) return null;

  return (
    <>
      <Divider style={{ margin: '8px 0 12px' }} />
      <Field label={t('linksWithCount', { count: links.length })}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {links.map((l) => {
            const outgoing = l.fromId === id;
            const otherId = outgoing ? l.toId : l.fromId;
            return (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Text type="secondary" style={{ fontSize: 12, width: 14, flexShrink: 0 }}>
                  {outgoing ? '→' : '←'}
                </Text>
                <Tag style={{ fontSize: 10 }}>{l.relation}</Tag>
                <RecordLink id={otherId} />
              </div>
            );
          })}
        </div>
      </Field>
    </>
  );
}

function DrawerContent({ id }: { id: string }) {
  const { t } = useTranslation('common');
  const { data, loading, error } = useQuery<{ record: RecordWrapper }>(GET_RECORD, {
    variables: { id },
  });

  if (loading) return <Skeleton active />;
  if (error) return <Alert type="error" message={error.message} />;
  if (!data?.record) return <Alert type="warning" message={t('recordNotFound')} />;

  return (
    <>
      <RecordBody wrapper={data.record} />
      <LinksSection id={id} />
      <Divider style={{ margin: '8px 0 12px' }} />
      <Field label={t('remarks')}>
        <RemarkPanel id={id} projectId={data.record.projectId} />
      </Field>
    </>
  );
}

export function DetailDrawer() {
  const { t } = useTranslation('common');
  const { selectedRecordId, selectedRecordType, detailDrawerOpen, closeDetailDrawer } =
    useWorkspaceStore();

  const kind = (selectedRecordType ?? 'unknown').toUpperCase();
  const entityType = KIND_TYPE[kind] ?? 'unknown';
  const accentColor = ENTITY_COLOR[entityType];
  const label = kindLabel(t)[kind] ?? selectedRecordType ?? t('kindRecord');

  return (
    <Drawer
      open={detailDrawerOpen}
      onClose={closeDetailDrawer}
      width={520}
      styles={{ header: { borderBottom: `2px solid ${accentColor}` }, body: { paddingTop: 20 } }}
      title={
        selectedRecordId ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Tag style={{
              fontSize: 11, fontFamily: 'monospace',
              background: 'transparent', border: `1px solid ${accentColor}`, color: accentColor,
            }}>
              {label}
            </Tag>
            <Text code style={{ fontSize: 13 }}>{selectedRecordId}</Text>
          </div>
        ) : null
      }
    >
      {selectedRecordId && <DrawerContent id={selectedRecordId} />}
    </Drawer>
  );
}
