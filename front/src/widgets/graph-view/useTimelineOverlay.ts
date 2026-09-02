import { useQuery } from '@apollo/client/react';
import { useMemo } from 'react';
import { toneOf, type Tone } from '../../features/remark/tone';
import { GET_EVENTS_PAGE, GET_LINKS_PAGE, GET_PROJECT_REMARKS_PAGE } from '../../shared/api/queries';
import type { Event, Link, Paginated } from '../../shared/model/types';

// T-MEMORY-045 acceptance: links/remarks for the timeline must be fetched in
// one batch per render, not once per visible decision (N+1 was explicitly
// called out as unacceptable). All three queries below are scoped to the
// whole project and fire once per (projectSlug, showTasks) pair — Apollo's
// default cache means panning/scrolling/re-rendering the timeline afterwards
// never re-fires them.
//
// Tradeoff, noted here rather than solved with real pagination-following
// (which would reintroduce the "wait for N round trips" problem this task
// is trying to avoid): each query takes a single generous page. If a project
// ever exceeds OVERLAY_LIMIT links or remarks, the overlay silently
// undercounts past the limit instead of firing a second request. Current
// P-MEMORY data (dozens of links, single-digit remarks) is nowhere close.
const OVERLAY_LIMIT = 500;

export interface RemarkPreview {
  id: string;
  title: string;
  body: string | null;
  tone: Tone;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TaskMarker {
  /** Event id — unique even if a task somehow produced two markers. */
  id: string;
  taskId: string;
  kind: 'created' | 'done';
  title: string;
  createdAt: string;
}

interface RemarkItem {
  id: string;
  title: string;
  body: string | null;
  tags: string[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TimelineOverlay {
  /** Non-"annotates" links touching a given record id, either direction — same filter LinksSection uses in the drawer. */
  linksByRecord: Map<string, Link[]>;
  /** Remarks ("annotates" links) targeting a given record id, newest first. */
  remarksByTarget: Map<string, RemarkPreview[]>;
  taskMarkers: TaskMarker[];
  loading: boolean;
}

export function useTimelineOverlay(projectSlug: string | null, showTasks: boolean): TimelineOverlay {
  // I-MEMORY-128: memoized -- apollo.ts's global cache-and-network policy
  // fires a real network request on every re-execution of a query, and an
  // inline variables literal counts as a fresh execution on every unrelated
  // re-render of the caller, not only when `projectSlug` changes. Cyclically
  // revisiting a project compounds this into a feedback loop (each
  // incidental re-render re-fires the network leg for all three queries
  // below; those responses arriving trigger more re-renders) that gets
  // worse the more times you cycle. All three share the same shape, one
  // shared object is enough.
  const overlayVariables = useMemo(
    () => ({ project: projectSlug, limit: OVERLAY_LIMIT, offset: 0 }),
    [projectSlug],
  );
  const { data: linksData, loading: linksLoading } = useQuery<{ linksPage: Paginated<Link> }>(GET_LINKS_PAGE, {
    variables: overlayVariables,
    skip: !projectSlug,
  });

  const { data: remarksData, loading: remarksLoading } = useQuery<{ memoryItemsPage: Paginated<RemarkItem> }>(
    GET_PROJECT_REMARKS_PAGE,
    {
      variables: overlayVariables,
      skip: !projectSlug,
    },
  );

  // Task events only fetched when the "Show tasks" toggle is on — off by
  // default per T-MEMORY-045, so most sessions never pay for this query.
  const { data: eventsData, loading: eventsLoading } = useQuery<{ eventsPage: Paginated<Event> }>(GET_EVENTS_PAGE, {
    variables: overlayVariables,
    skip: !projectSlug || !showTasks,
  });

  return useMemo(() => {
    const allLinks = linksData?.linksPage.items ?? [];
    const remarkById = new Map<string, RemarkItem>();
    for (const r of remarksData?.memoryItemsPage.items ?? []) remarkById.set(r.id, r);

    const linksByRecord = new Map<string, Link[]>();
    const remarksByTarget = new Map<string, RemarkPreview[]>();

    const addLink = (id: string, link: Link) => {
      const list = linksByRecord.get(id) ?? [];
      list.push(link);
      linksByRecord.set(id, list);
    };

    for (const link of allLinks) {
      // "annotates" links are remarks, surfaced through the dedicated bottom
      // indicator instead — mirrors LinksSection's own exclusion in the
      // drawer so the top-expand panel shows exactly the same set.
      if (link.relation === 'annotates') {
        const remark = remarkById.get(link.fromId);
        if (remark) {
          const list = remarksByTarget.get(link.toId) ?? [];
          list.push({
            id: remark.id,
            title: remark.title,
            body: remark.body,
            tone: toneOf(remark.tags),
            createdAt: remark.createdAt,
            updatedAt: remark.updatedAt,
          });
          remarksByTarget.set(link.toId, list);
        }
        continue;
      }
      addLink(link.fromId, link);
      addLink(link.toId, link);
    }

    for (const list of remarksByTarget.values()) {
      list.sort((a, b) => (b.updatedAt ?? b.createdAt ?? '').localeCompare(a.updatedAt ?? a.createdAt ?? ''));
    }

    const taskMarkers: TaskMarker[] = showTasks
      ? (eventsData?.eventsPage.items ?? [])
          .filter(
            (e): e is Event & { relatedId: string; createdAt: string } =>
              (e.type === 'task.created' || e.type === 'task.completed') && Boolean(e.relatedId) && Boolean(e.createdAt),
          )
          .map((e) => ({
            id: e.id,
            taskId: e.relatedId,
            kind: e.type === 'task.created' ? ('created' as const) : ('done' as const),
            title: e.title,
            createdAt: e.createdAt,
          }))
      : [];

    return {
      linksByRecord,
      remarksByTarget,
      taskMarkers,
      loading: linksLoading || remarksLoading || (showTasks && eventsLoading),
    };
  }, [linksData, remarksData, eventsData, showTasks, linksLoading, remarksLoading, eventsLoading]);
}
