import { useQuery } from '@apollo/client/react';
import { GET_MY_PROJECT_ROLE } from '../api/queries';
import type { ProjectMemberRole } from '../model/types';

/** T-context: feeds every role-aware gate in the task UI (Kanban, detail panel, List). Accepts a project id or slug, same as every other project-scoped tool. */
export function useMyProjectRole(project: string | null | undefined) {
  const { data, loading } = useQuery<{ myProjectRole: ProjectMemberRole }>(GET_MY_PROJECT_ROLE, {
    variables: { project },
    skip: !project,
  });
  return { role: data?.myProjectRole ?? null, loading };
}
