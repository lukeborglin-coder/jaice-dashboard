import React from 'react';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { IconTable } from '@tabler/icons-react';

const BRAND_ORANGE = '#D14A2D';

interface ProjectViewProps {
  selectedProject: any;
  questionnaires: any[];
  showMyProjectsOnly: boolean;
  onShowMyProjectsOnlyChange: (value: boolean) => void;
  user: any;
  onBackToHome: () => void;
  onQuestionnaireClick: (qnr: any) => void;
}

export const ProjectView: React.FC<ProjectViewProps> = ({
  selectedProject,
  questionnaires,
  showMyProjectsOnly,
  onShowMyProjectsOnlyChange,
  user,
  onBackToHome,
  onQuestionnaireClick,
}) => {
  return (
    <>
      <div>
        <div className="flex items-center justify-between">
          <button
            onClick={onBackToHome}
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 px-3 py-1 rounded-lg transition-colors"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Back to Projects
          </button>
          <div className="flex items-center gap-3">
            {user?.role !== 'oversight' && (
              <button
                onClick={() => onShowMyProjectsOnlyChange(!showMyProjectsOnly)}
                className={`px-3 py-1 text-xs rounded-lg shadow-sm transition-colors ${
                  showMyProjectsOnly
                    ? 'bg-white border border-gray-300 hover:bg-gray-50'
                    : 'text-white hover:opacity-90'
                }`}
                style={showMyProjectsOnly ? {} : { backgroundColor: BRAND_ORANGE }}
              >
                {showMyProjectsOnly ? 'Only My Projects' : 'All Projects'}
              </button>
            )}
          </div>
        </div>
        <div className="border-b border-gray-200"></div>
      </div>

      <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
        {questionnaires.length === 0 ? (
          <div className="p-12 text-center">
            <IconTable className="mx-auto mb-4 h-16 w-16 text-gray-300" />
            <h3 className="text-lg font-semibold text-gray-900">No QNRs found</h3>
            <p className="mt-2 text-gray-500">Upload data to a QNR to view tabs.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">QNR Name</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Questions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {questionnaires.map((qnr) => (
                  <tr
                    key={qnr.id}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => onQuestionnaireClick(qnr)}
                  >
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-gray-900">{qnr.name}</div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="text-sm text-gray-900">{qnr.questions?.length || 0}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
};

