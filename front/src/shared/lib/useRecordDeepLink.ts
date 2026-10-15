import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getEntityType } from './entityId';
import { useWorkspaceStore } from '../model/workspace.store';

// Opens the global DetailDrawer when a section route is loaded with a
// trailing record id (e.g. /projects/:slug/tasks/:recordId), so a link like
// https://marrow.undoo.ru/projects/marrow-telly-mcp/tasks/T-MARROW-002 --
// shared from Telegram, a commit message, etc. -- lands on the drawer
// instead of just the plain list. Entity type comes from the id's own
// prefix (RecordLink already relies on the same getEntityType), so one
// route param works for every section.
export function useRecordDeepLink(): void {
  const { recordId } = useParams<{ recordId?: string }>();
  const setSelectedRecord = useWorkspaceStore((s) => s.setSelectedRecord);

  useEffect(() => {
    if (recordId) {
      setSelectedRecord(recordId, getEntityType(recordId));
    }
  }, [recordId, setSelectedRecord]);
}
