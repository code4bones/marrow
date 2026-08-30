import { useQuery } from '@apollo/client/react';
import { SearchOutlined } from '@ant-design/icons';
import { Input, Popover, Spin, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GET_PROJECT_SEARCH } from '../../shared/api/queries';
import { ENTITY_COLOR, getEntityType, SATELLITE_KIND_COLOR } from '../../shared/lib/entityId';
import { useWorkspaceStore } from '../../shared/model/workspace.store';
import type { GlobalSearchKind, GlobalSearchResult } from '../../shared/model/types';

// T-context (2026-08-25, owner's ask: "(task/decisions/mem/faults/
// artifacts) это omni search"): quick-search box for the Overview header --
// does NOT filter the current view (owner's explicit spec), it opens a
// floating panel of matched titles+excerpts across all five content kinds,
// clicking one opens that record's existing DetailDrawer via the same
// setSelectedRecord mechanism RecordLink already uses (getEntityType(id)
// resolves task/decision/memory/artifact from the id's own prefix -- "fault"
// is a display-only grouping here, faults are still `I-` memory items).
const KIND_COLOR: Record<GlobalSearchKind, string> = {
  task: SATELLITE_KIND_COLOR.TASK,
  decision: SATELLITE_KIND_COLOR.DECISION,
  memory: SATELLITE_KIND_COLOR.MEMORY,
  fault: '#ff4d4f',
  artifact: SATELLITE_KIND_COLOR.ARTIFACT,
  skill: ENTITY_COLOR.skill,
};

function ResultRow({ result, kindLabel, onSelect }: { result: GlobalSearchResult; kindLabel: string; onSelect: (id: string) => void }) {
  return (
    <div
      className="global-search-row"
      // onMouseDown (not onClick) + preventDefault: the Input's onBlur
      // (which closes this panel) fires before a click would, so a plain
      // onClick here would never register -- this is the standard
      // search-box-with-dropdown-results trick.
      onMouseDown={(e) => { e.preventDefault(); onSelect(result.id); }}
      style={{ padding: '6px 10px', borderRadius: 4, cursor: 'pointer' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Tag style={{ margin: 0, fontSize: 10, borderColor: KIND_COLOR[result.kind], color: KIND_COLOR[result.kind], background: 'transparent' }}>
          {kindLabel}
        </Tag>
        <Typography.Text
          style={{ fontSize: 10.5, fontFamily: 'monospace', color: '#8c8c8c', flexShrink: 0 }}
        >
          {result.id}
        </Typography.Text>
        <Typography.Text style={{ fontSize: 13, flex: 1 }} ellipsis>
          {result.title}
        </Typography.Text>
      </div>
      {result.excerpt && (
        <Typography.Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginTop: 2 }} ellipsis>
          {result.excerpt}
        </Typography.Text>
      )}
    </div>
  );
}

export function GlobalSearchBox({ slug, fullWidth }: { slug: string; fullWidth?: boolean }) {
  const { t } = useTranslation('projects');
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const setSelectedRecord = useWorkspaceStore((s) => s.setSelectedRecord);
  const trimmed = query.trim();

  const { data, loading } = useQuery<{ projectSearch: GlobalSearchResult[] }>(GET_PROJECT_SEARCH, {
    variables: { project: slug, query: trimmed, limit: 5 },
    skip: !trimmed,
  });

  const results = data?.projectSearch ?? [];
  const kindLabel: Record<GlobalSearchKind, string> = {
    task: t('allTasks'),
    decision: t('decisions'),
    memory: t('memory'),
    fault: t('faults'),
    artifact: t('artifacts'),
    skill: t('skills'),
  };

  const open = focused && trimmed.length > 0;

  return (
    <Popover
      open={open}
      placement="bottom"
      trigger={[]}
      styles={{ content: { padding: 6, width: fullWidth ? 'min(420px, 92vw)' : 420 } }}
      content={
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          <style>{'.global-search-row:hover { background: rgba(255, 255, 255, 0.06); }'}</style>
          {loading && (
            <div style={{ padding: 16, textAlign: 'center' }}>
              <Spin size="small" />
            </div>
          )}
          {!loading && results.length === 0 && (
            <Typography.Text type="secondary" style={{ display: 'block', padding: 10, fontSize: 12.5 }}>
              {t('noSearchResults')}
            </Typography.Text>
          )}
          {!loading &&
            results.map((r) => (
              <ResultRow
                key={r.id}
                result={r}
                kindLabel={kindLabel[r.kind]}
                // T-context (owner's ask): opening a result must NOT clear
                // the search -- closing the DetailDrawer should land the
                // user back on the same results, not an empty box, so they
                // can pick another match without retyping.
                onSelect={(id) => setSelectedRecord(id, getEntityType(id))}
              />
            ))}
        </div>
      }
    >
      <Input
        prefix={<SearchOutlined style={{ color: '#8c8c8c' }} />}
        placeholder={t('quickSearchPlaceholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        allowClear
        size="middle"
        style={{ width: fullWidth ? '100%' : 320 }}
      />
    </Popover>
  );
}
