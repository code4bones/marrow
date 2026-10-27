import { useQuery } from '@apollo/client/react';
import { useMemo } from 'react';
import { GET_PROJECT_MEMBERS } from '../api/queries';
import type { ProjectMember } from '../model/types';

/** T-MEMORY-090: feeds the assignee picker on task/decision forms and the DetailDrawer reassign control. */
export function useProjectMembers(project: string | null | undefined) {
  const variables = useMemo(() => ({ project }), [project]);
  const { data, loading, error } = useQuery<{ projectMembers: ProjectMember[] }>(GET_PROJECT_MEMBERS, {
    variables,
    skip: !project,
  });
  return { members: data?.projectMembers ?? [], loading, error };
}
