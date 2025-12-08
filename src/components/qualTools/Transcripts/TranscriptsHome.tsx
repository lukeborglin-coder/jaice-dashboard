import React from 'react';
import { IconScript } from '@tabler/icons-react';
import ProjectSelector from '../ProjectSelector';
import { BRAND_ORANGE } from '../../../utils/constants';

interface Project {
  id: string;
  name: string;
  client?: string;
  archived?: boolean;
  [key: string]: any;
}

interface TranscriptsHomeProps {
  transcripts: Record<string, any[]>;
  onProjectSelect: (project: Project) => void;
  onRefreshAnalyses?: () => void;
  user?: any;
}

export default function TranscriptsHome({
  transcripts,
  onProjectSelect,
  onRefreshAnalyses,
  user
}: TranscriptsHomeProps) {
  return (
    <ProjectSelector
      sessionStorageKey="cognitive_dash_transcripts"
      onProjectSelect={(project) => {
        onProjectSelect(project);
        if (onRefreshAnalyses) {
          onRefreshAnalyses();
        }
      }}
      columns={[
        {
          header: 'Project',
          accessor: (project: Project) => (
            <div className="text-sm font-medium text-gray-900">{project.name}</div>
          ),
          className: 'pl-6 pr-2 py-4 whitespace-nowrap w-0'
        },
        {
          header: 'Client',
          accessor: (project: Project) => (
            <div className="text-sm text-gray-900 truncate">{project.client || '-'}</div>
          ),
          className: 'pl-2 pr-6 py-4 whitespace-nowrap w-32'
        },
        {
          header: 'Transcripts',
          accessor: (project: Project) => {
            const projectTranscripts = transcripts[project.id] || [];
            const totalUploads = projectTranscripts.length;
            return (
              <div className="flex items-center justify-center gap-1 text-sm text-gray-900">
                <IconScript className="h-4 w-4 text-gray-400" />
                {totalUploads}
              </div>
            );
          },
          className: 'px-6 py-4 whitespace-nowrap text-center w-20'
        }
      ]}
      emptyStateMessage={{
        active: 'No active qualitative projects',
        archived: 'No archived qualitative projects'
      }}
      emptyStateDescription={{
        active: 'Create a qualitative project to start managing transcripts.',
        archived: 'Archived qualitative projects will appear here.'
      }}
      hideMyProjectsToggle={user?.role === 'oversight'}
    />
  );
}

