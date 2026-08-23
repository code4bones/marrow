import { useQuery } from '@apollo/client/react';
import { Alert, Divider, Drawer, Skeleton, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { GET_ARTIFACT_TEXT, GET_RECORD, GET_RECORD_LINKS } from '../../shared/api/queries';
import type {
  Artifact, Decision, Event, Link, MemoryRecord, Project, RecordWrapper, Task,
} from '../../shared/model/types';
import { ENTITY_COLOR, type EntityType } from '../../shared/lib/entityId';
import { useActorLabels } from '../../shared/lib/useActorLabels';
import { AddTaskNoteButton } from '../../features/task/AddTaskNoteButton';
import { ClaimTaskButton } from '../../features/task/ClaimTaskButton';
import { CompleteTaskButton } from '../../features/task/CompleteTaskButton';
import { DeleteTaskButton } from '../../features/task/DeleteTaskButton';
import { EditTaskDrawer } from '../../features/task/EditTaskDrawer';
import { TaskAssigneeSelect } from '../../features/task/TaskAssigneeSelect';
import { TaskClaimsPanel } from '../../features/task/TaskClaimsPanel';
import { TaskPrioritySelect } from '../../features/task/TaskPrioritySelect';
import { TaskStatusSelect } from '../../features/task/TaskStatusSelect';
import { RemarkPanel } from '../../features/remark/RemarkPanel';
import { CreateConnectedDecisionButton } from '../../features/decision/CreateConnectedDecisionButton';
import { DecisionAssigneeSelect } from '../../features/decision/DecisionAssigneeSelect';
import { DecisionStatusSelect } from '../../features/decision/DecisionStatusSelect';
import { MemoryStatusSelect } from '../../features/memory/MemoryStatusSelect';
import { ArchiveArtifactButton } from '../../features/artifact/ArchiveArtifactButton';
import { canPerform } from '../../shared/lib/taskPermissions';
import { useMyProjectRole } from '../../shared/lib/useMyProjectRole';
import { Markdown } from '../../shared/ui/Markdown';
import { RecordLink } from '../../shared/ui/RecordLink';
import { RoleBadge } from '../../shared/ui/RoleBadge';
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

function TaskBody({ r, projectId }: { r: Task; projectId: string | null }) {
  const { t } = useTranslation('common');
  const { labelFor } = useActorLabels([r.createdBy]);
  const closeDetailDrawer = useWorkspaceStore((s) => s.closeDetailDrawer);
  const { role } = useMyProjectRole(projectId);
  return (
    <>
      <div style={{ marginBottom: 14 }}><RoleBadge role={role} /></div>
      <Field label={t('status')}><TaskStatusSelect id={r.id} value={r.status} role={role} /></Field>
      <Field label={t('assignee')}><TaskAssigneeSelect id={r.id} projectId={projectId} value={r.assigneeUserId} role={role} /></Field>
      <Field label={t('priority')}><TaskPrioritySelect id={r.id} value={r.priority} role={role} /></Field>
      {r.milestone && <Field label={t('milestone')}><Text>{r.milestone}</Text></Field>}
      {r.scope && <Field label={t('scope')}><Markdown>{r.scope}</Markdown></Field>}
      {r.acceptance && <Field label={t('acceptanceCriteria')}><Markdown>{r.acceptance}</Markdown></Field>}
      {r.notes && <Field label={t('notes')}><Markdown>{r.notes}</Markdown></Field>}
      <StringFiles items={r.allowedFiles} label={t('allowedFiles')} />
      <StringFiles items={r.forbiddenFiles} label={t('forbiddenFiles')} />
      {r.dependsOn.length > 0 && (
        <Field label={t('dependsOn')}>{r.dependsOn.map((d) => <RecordLink key={d} id={d} />)}</Field>
      )}
      <Field label={t('updated')}><Timestamp value={r.updatedAt} author={labelFor(r.createdBy)} /></Field>
      <TaskClaimsPanel taskId={r.id} activeClaimCount={r.activeClaimCount ?? 0} />
      <Divider style={{ margin: '8px 0 12px' }} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <ClaimTaskButton taskId={r.id} />
        <AddTaskNoteButton taskId={r.id} />
        {canPerform(role, 'complete') && <CompleteTaskButton taskId={r.id} activeClaimCount={r.activeClaimCount ?? 0} />}
        {canPerform(role, 'edit_details') && <EditTaskDrawer task={r} role={role} />}
        {canPerform(role, 'delete') && <DeleteTaskButton id={r.id} onDone={closeDetailDrawer} />}
      </div>
    </>
  );
}

function DecisionBody({ r, projectId }: { r: Decision; projectId: string | null }) {
  const { t } = useTranslation('common');
  const { labelFor } = useActorLabels([r.createdBy]);
  return (
    <>
      <Field label={t('status')}>
        {/* A superseded decision's status is structural (paired with the
            replacement decision + the supersedes link) -- the backend
            rejects setting it back directly, so this stays read-only for
            that one status rather than showing an editable control that
            would just error on change. */}
        {r.status === 'superseded'
          ? <StatusBadge status={r.status} />
          : <DecisionStatusSelect id={r.id} value={r.status} />}
      </Field>
      {r.projectId && (
        <Field label={t('assignee')}><DecisionAssigneeSelect id={r.id} projectId={r.projectId} value={r.assigneeUserId} /></Field>
      )}
      {r.tags.length > 0 && <Field label={t('tags')}><TagList items={r.tags} /></Field>}
      {r.context && <Field label={t('context')}><Markdown>{r.context}</Markdown></Field>}
      {r.decision && <Field label={t('decision')}><Markdown>{r.decision}</Markdown></Field>}
      {r.rationale && <Field label={t('rationale')}><Markdown>{r.rationale}</Markdown></Field>}
      {r.consequences && <Field label={t('consequences')}><Markdown>{r.consequences}</Markdown></Field>}
      {r.supersedesId && <Field label={t('supersedes')}><RecordLink id={r.supersedesId} /></Field>}
      <Field label={t('updated')}><Timestamp value={r.updatedAt} author={labelFor(r.createdBy)} /></Field>
      <CreateConnectedDecisionButton currentId={r.id} projectId={projectId} />
    </>
  );
}

function ArtifactBody({ r }: { r: Artifact }) {
  const { t } = useTranslation('common');
  const { labelFor } = useActorLabels([r.createdBy]);
  const isText = r.contentType?.startsWith('text/') || r.contentType?.includes('json') || r.contentType?.includes('xml');
  return (
    <>
      <Field label={t('path')}><Text code style={{ fontSize: 12 }}>{r.path}</Text></Field>
      <Field label={t('scope')}><Tag style={{ fontSize: 11 }}>{r.scope}</Tag></Field>
      <Field label={t('status')}>
        {/* Artifacts only have two real states (current/archived, no
            intermediate draft/rejected like decisions/memory) -- the
            existing one-way Archive action already covers that, no
            dropdown needed. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <StatusBadge status={r.status} />
          {r.status !== 'archived' && <ArchiveArtifactButton id={r.id} />}
        </div>
      </Field>
      {r.contentType && <Field label={t('contentType')}><Text>{r.contentType}</Text></Field>}
      {r.sizeBytes != null && <Field label={t('size')}><Text>{(r.sizeBytes / 1024).toFixed(1)} KB</Text></Field>}
      {r.description && <Field label={t('description')}><Paragraph style={{ margin: 0 }}>{r.description}</Paragraph></Field>}
      {r.tags.length > 0 && <Field label={t('tags')}><TagList items={r.tags} /></Field>}
      <Field label={t('updated')}><Timestamp value={r.updatedAt} author={labelFor(r.createdBy)} /></Field>
      {isText && <ArtifactTextPreview id={r.id} />}
    </>
  );
}

function MemoryBody({ r }: { r: MemoryRecord }) {
  const { t } = useTranslation('common');
  const { labelFor } = useActorLabels([r.createdBy]);
  return (
    <>
      <Field label={t('type')}><Tag style={{ fontSize: 11 }}>{r.type}</Tag></Field>
      <Field label={t('status')}><MemoryStatusSelect id={r.id} value={r.status} /></Field>
      {r.tags.length > 0 && <Field label={t('tags')}><TagList items={r.tags} /></Field>}
      {r.excerpt && <Field label={t('excerpt')}><Text type="secondary" style={{ fontSize: 12 }}>{r.excerpt}</Text></Field>}
      {r.body && (
        <Field label={t('body')}>
          <div style={{ maxHeight: 480, overflowY: 'auto' }}>
            <Markdown>{r.body}</Markdown>
          </div>
        </Field>
      )}
      <Field label={t('updated')}><Timestamp value={r.updatedAt} author={labelFor(r.createdBy)} /></Field>
    </>
  );
}

function EventBody({ r }: { r: Event }) {
  const { t } = useTranslation('common');
  const { labelFor } = useActorLabels([r.credentialId]);
  return (
    <>
      <Field label={t('type')}><Tag style={{ fontSize: 11 }}>{r.type}</Tag></Field>
      {r.relatedId && <Field label={t('related')}><RecordLink id={r.relatedId} /></Field>}
      <Field label={t('at')}><Timestamp value={r.createdAt} author={labelFor(r.credentialId)} /></Field>
    </>
  );
}

function LinkBody({ r }: { r: Link }) {
  const { t } = useTranslation('common');
  const { labelFor } = useActorLabels([r.createdBy]);
  return (
    <>
      <Field label={t('from')}><RecordLink id={r.fromId} /></Field>
      <Field label={t('relation')}><Tag style={{ fontSize: 11 }}>{r.relation}</Tag></Field>
      <Field label={t('to')}><RecordLink id={r.toId} /></Field>
      <Field label={t('at')}><Timestamp value={r.createdAt} author={labelFor(r.createdBy)} /></Field>
    </>
  );
}

function ProjectBody({ r }: { r: Project }) {
  const { t } = useTranslation('common');
  const { labelFor } = useActorLabels([r.createdBy]);
  return (
    <>
      <Field label={t('slug')}><Tag color="orange" style={{ margin: 0, fontFamily: 'monospace' }}>{r.slug}</Tag></Field>
      <Field label={t('status')}><StatusBadge status={r.status} /></Field>
      {r.description && <Field label={t('description')}><Paragraph style={{ margin: 0 }}>{r.description}</Paragraph></Field>}
      {r.rootPath && <Field label={t('rootPath')}><Text code style={{ fontSize: 12 }}>{r.rootPath}</Text></Field>}
      <Field label={t('updated')}><Timestamp value={r.updatedAt} author={labelFor(r.createdBy)} /></Field>
    </>
  );
}

function RecordBody({ wrapper }: { wrapper: RecordWrapper }) {
  const { t } = useTranslation('common');
  const r = wrapper.record;
  if (!r) return <Alert type="warning" message={t('recordPayloadEmpty')} />;
  switch (r.__typename) {
    case 'Task':        return <TaskBody r={r} projectId={wrapper.projectId} />;
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
