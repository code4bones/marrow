import { useQuery } from '@apollo/client/react';
import { GET_PROJECT_MEMBERS } from '../api/queries';
import type { ProjectMember } from '../model/types';

/** T-MEMORY-090: feeds the assignee picker on task/decision forms and the DetailDrawer reassign control. */
export function useProjectMembers(project: string | null | undefined) {
  const { data, loading } = useQuery<{ projectMembers: ProjectMember[] }>(GET_PROJECT_MEMBERS, {
    variables: { project },
    skip: !project,
  });
  return { members: data?.projectMembers ?? [], loading };
}
