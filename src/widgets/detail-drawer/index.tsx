import { useQuery } from '@apollo/client/react';
import { Alert, Divider, Drawer, Skeleton, Tag, Typography } from 'antd';
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
import { RecordLink } from '../../shared/ui/RecordLink';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { Timestamp } from '../../shared/ui/Timestamp';
import { useWorkspaceStore } from '../../shared/model/workspace.store';

const { Text, Paragraph } = Typography;

const KIND_LABEL: Record<string, string> = {
  TASK: 'Task', DECISION: 'Decision', ARTIFACT: 'Artifact',
  MEMORY: 'Memory', EVENT: 'Event', LINK: 'Link', PROJECT: 'Project',
};

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
  return <>{items.map((t) => <Tag key={t} style={{ fontSize: 11 }}>{t}</Tag>)}</>;
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
  const { data, loading, error } = useQuery<{
    artifactText: { text: string; textInfo: { truncated: boolean } }
  }>(GET_ARTIFACT_TEXT, { variables: { id } });

  if (loading) return <Skeleton active paragraph={{ rows: 4 }} />;
  if (error) return <Alert type="warning" message="Text preview unavailable" />;
  const at = data!.artifactText;
  return (
    <Field label={`Content${at.textInfo.truncated ? ' (truncated)' : ''}`}>
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
  return (
    <>
      <Field label="Status"><StatusBadge status={r.status} /></Field>
      {r.priority != null && <Field label="Priority"><Text>{r.priority}</Text></Field>}
      {r.milestone && <Field label="Milestone"><Text>{r.milestone}</Text></Field>}
      {r.scope && <Field label="Scope"><Paragraph style={{ margin: 0 }}>{r.scope}</Paragraph></Field>}
      {r.acceptance && <Field label="Acceptance Criteria"><Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.acceptance}</Paragraph></Field>}
      {r.notes && <Field label="Notes"><Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.notes}</Paragraph></Field>}
      <StringFiles items={r.allowedFiles} label="Allowed Files" />
      <StringFiles items={r.forbiddenFiles} label="Forbidden Files" />
      {r.dependsOn.length > 0 && (
        <Field label="Depends On">{r.dependsOn.map((d) => <RecordLink key={d} id={d} />)}</Field>
      )}
      <Field label="Updated"><Timestamp value={r.updatedAt} /></Field>
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

function DecisionBody({ r }: { r: Decision }) {
  return (
    <>
      <Field label="Status"><StatusBadge status={r.status} /></Field>
      {r.tags.length > 0 && <Field label="Tags"><TagList items={r.tags} /></Field>}
      {r.context && <Field label="Context"><Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.context}</Paragraph></Field>}
      {r.decision && <Field label="Decision"><Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.decision}</Paragraph></Field>}
      {r.rationale && <Field label="Rationale"><Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.rationale}</Paragraph></Field>}
      {r.consequences && <Field label="Consequences"><Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.consequences}</Paragraph></Field>}
      {r.supersedesId && <Field label="Supersedes"><RecordLink id={r.supersedesId} /></Field>}
      <Field label="Updated"><Timestamp value={r.updatedAt} /></Field>
    </>
  );
}

function ArtifactBody({ r }: { r: Artifact }) {
  const isText = r.contentType?.startsWith('text/') || r.contentType?.includes('json') || r.contentType?.includes('xml');
  return (
    <>
      <Field label="Path"><Text code style={{ fontSize: 12 }}>{r.path}</Text></Field>
      <Field label="Scope"><Tag style={{ fontSize: 11 }}>{r.scope}</Tag></Field>
      <Field label="Status"><StatusBadge status={r.status} /></Field>
      {r.contentType && <Field label="Content Type"><Text>{r.contentType}</Text></Field>}
      {r.sizeBytes != null && <Field label="Size"><Text>{(r.sizeBytes / 1024).toFixed(1)} KB</Text></Field>}
      {r.description && <Field label="Description"><Paragraph style={{ margin: 0 }}>{r.description}</Paragraph></Field>}
      {r.tags.length > 0 && <Field label="Tags"><TagList items={r.tags} /></Field>}
      <Field label="Updated"><Timestamp value={r.updatedAt} /></Field>
      {isText && <ArtifactTextPreview id={r.id} />}
    </>
  );
}

function MemoryBody({ r }: { r: MemoryRecord }) {
  return (
    <>
      <Field label="Type"><Tag style={{ fontSize: 11 }}>{r.type}</Tag></Field>
      <Field label="Status"><StatusBadge status={r.status} /></Field>
      {r.tags.length > 0 && <Field label="Tags"><TagList items={r.tags} /></Field>}
      {r.excerpt && <Field label="Excerpt"><Text type="secondary" style={{ fontSize: 12 }}>{r.excerpt}</Text></Field>}
      {r.body && (
        <Field label="Body">
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
      <Field label="Updated"><Timestamp value={r.updatedAt} /></Field>
    </>
  );
}

function EventBody({ r }: { r: Event }) {
  return (
    <>
      <Field label="Type"><Tag style={{ fontSize: 11 }}>{r.type}</Tag></Field>
      {r.relatedId && <Field label="Related"><RecordLink id={r.relatedId} /></Field>}
      <Field label="At"><Timestamp value={r.createdAt} /></Field>
    </>
  );
}

function LinkBody({ r }: { r: Link }) {
  return (
    <>
      <Field label="From"><RecordLink id={r.fromId} /></Field>
      <Field label="Relation"><Tag style={{ fontSize: 11 }}>{r.relation}</Tag></Field>
      <Field label="To"><RecordLink id={r.toId} /></Field>
      <Field label="At"><Timestamp value={r.createdAt} /></Field>
    </>
  );
}

function ProjectBody({ r }: { r: Project }) {
  return (
    <>
      <Field label="Slug"><Text code>{r.slug}</Text></Field>
      <Field label="Status"><StatusBadge status={r.status} /></Field>
      {r.description && <Field label="Description"><Paragraph style={{ margin: 0 }}>{r.description}</Paragraph></Field>}
      {r.rootPath && <Field label="Root Path"><Text code style={{ fontSize: 12 }}>{r.rootPath}</Text></Field>}
      <Field label="Updated"><Timestamp value={r.updatedAt} /></Field>
    </>
  );
}

function RecordBody({ wrapper }: { wrapper: RecordWrapper }) {
  const r = wrapper.record;
  if (!r) return <Alert type="warning" message="Record payload is empty" />;
  switch (r.__typename) {
    case 'Task':        return <TaskBody r={r} />;
    case 'Decision':    return <DecisionBody r={r} />;
    case 'Artifact':    return <ArtifactBody r={r} />;
    case 'MemoryRecord': return <MemoryBody r={r} />;
    case 'Event':       return <EventBody r={r} />;
    case 'Link':        return <LinkBody r={r} />;
    case 'Project':     return <ProjectBody r={r} />;
    default:            return <Alert type="info" message={`Unknown type: ${(r as { __typename?: string })?.__typename}`} />;
  }
}

// Reused for every record kind (task/decision/artifact/memory/event) so
// "drilling in" isn't specific to the decision timeline — click a linked
// record here and the same drawer re-fetches to show it, letting you walk
// the graph one hop at a time from any starting point.
function LinksSection({ id }: { id: string }) {
  const { data, loading } = useQuery<{ links: Link[] }>(GET_RECORD_LINKS, { variables: { id } });
  if (loading) return null;
  // "annotates" links are remarks — RemarkPanel renders those with full
  // body/tone, so they're excluded here to avoid showing the same thing twice.
  const links = (data?.links ?? []).filter((l) => l.relation !== 'annotates');
  if (links.length === 0) return null;

  return (
    <>
      <Divider style={{ margin: '8px 0 12px' }} />
      <Field label={`Links (${links.length})`}>
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
  const { data, loading, error } = useQuery<{ record: RecordWrapper }>(GET_RECORD, {
    variables: { id },
  });

  if (loading) return <Skeleton active />;
  if (error) return <Alert type="error" message={error.message} />;
  if (!data?.record) return <Alert type="warning" message="Record not found" />;

  return (
    <>
      <RecordBody wrapper={data.record} />
      <LinksSection id={id} />
      <Divider style={{ margin: '8px 0 12px' }} />
      <Field label="Remarks">
        <RemarkPanel id={id} projectId={data.record.projectId} />
      </Field>
    </>
  );
}

export function DetailDrawer() {
  const { selectedRecordId, selectedRecordType, detailDrawerOpen, closeDetailDrawer } =
    useWorkspaceStore();

  const kind = (selectedRecordType ?? 'unknown').toUpperCase();
  const entityType = KIND_TYPE[kind] ?? 'unknown';
  const accentColor = ENTITY_COLOR[entityType];
  const label = KIND_LABEL[kind] ?? selectedRecordType ?? 'Record';

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
