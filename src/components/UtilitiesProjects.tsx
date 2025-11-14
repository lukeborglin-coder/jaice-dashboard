import React, { useCallback, useEffect, useMemo, useState, useRef, useImperativeHandle } from 'react';
import { API_BASE_URL } from '../config';
import { useAuth } from '../contexts/AuthContext';
import { DocumentTextIcon, ArrowLeftIcon, CloudArrowUpIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline';
import { IconBook2, IconLaurelWreath1, IconLaurelWreath2, IconLaurelWreath3 } from '@tabler/icons-react';
import * as XLSX from 'xlsx';
import AverageUtilitiesView from './AverageUtilitiesView';

const BRAND_ORANGE = '#D14A2D';
const BRAND_ORANGE_LIGHT = '#FDE6DE';
const BRAND_ORANGE_BORDER = '#F3B29D';
const BRAND_GRAY = '#5D5F62';

interface UtilitiesData {
  utilities: Record<string, Record<string, number>>;
  schema?: {
    attributes: Array<{
      name: string;
      label: string;
      levels: Array<{ code?: string; level: string }>;
      reference?: string;
    }>;
  };
  axisSettings?: {
    mode: 'independent' | 'consistent' | 'manual';
    manualMin?: number;
    manualMax?: number;
  };
  excludedLevels?: Record<string, string[]>; // attribute name -> array of excluded level names
}

// Attribute Importance View Component
interface AttributeImportanceViewRef {
  copyTable: () => Promise<void>;
}

interface AttributeImportanceViewProps {
  utilitiesData: UtilitiesData;
}

const AttributeImportanceView = React.forwardRef<AttributeImportanceViewRef, AttributeImportanceViewProps>(
  ({ utilitiesData }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const parentContainerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(800);
    const [selectedAttribute, setSelectedAttribute] = useState<string | null>(null);

    useEffect(() => {
      const updateWidth = () => {
        if (parentContainerRef.current) {
          setContainerWidth(parentContainerRef.current.offsetWidth);
        }
      };
      updateWidth();
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }, []);

    const attributesImportance = useMemo(() => {
      if (!utilitiesData?.utilities || !utilitiesData?.schema?.attributes) {
        return [];
      }

      const attributes = utilitiesData.schema.attributes.map(attr => {
        const levelMap = utilitiesData.utilities[attr.name] || {};
        const allValues = Object.values(levelMap).map(v => Number(v));
        
        if (allValues.length === 0) return null;

        const minUtility = Math.min(...allValues);
        const maxUtility = Math.max(...allValues);
        const spread = maxUtility - minUtility; // This is the importance

        return {
          name: attr.name,
          label: attr.label || attr.name,
          importance: spread
        };
      }).filter(attr => attr !== null) as Array<{ 
        name: string; 
        label: string; 
        importance: number;
      }>;

      // Sort by importance (highest to lowest - most important at top)
      attributes.sort((a, b) => b.importance - a.importance);

      return attributes;
    }, [utilitiesData]);

    // Calculate total spread for percentage calculation
    const totalSpread = attributesImportance.reduce((sum, attr) => sum + attr.importance, 0);
    
    // Add score (percentage) to each attribute
    const attributesWithScores = attributesImportance.map(attr => ({
      ...attr,
      score: totalSpread > 0 ? (attr.importance / totalSpread) * 100 : 0
    }));

    const copyTableToClipboard = async () => {
      try {
        // Create table format: Attribute | Score
        const tableRows = attributesWithScores.map(attr => 
          `${attr.label}\t${attr.score.toFixed(1)}%`
        );
        const tableText = `Attribute\tScore\n${tableRows.join('\n')}`;
        
        await navigator.clipboard.writeText(tableText);
      } catch (error) {
        console.error('Failed to copy table:', error);
      }
    };

    useImperativeHandle(ref, () => ({
      copyTable: copyTableToClipboard
    }), [attributesWithScores]);

    if (attributesImportance.length === 0) {
      return (
        <div className="text-center py-12 text-gray-500">
          <p>No attribute importance data available.</p>
        </div>
      );
    }

    const maxImportance = Math.max(...attributesImportance.map(a => a.importance));
    const chartHeight = attributesImportance.length * 35; // 35px per attribute (reduced from 50px)
    
    // Truncate long labels and calculate left margin based on longest (truncated) label
    const maxLabelLength = 30; // Maximum characters to display
    const attributesWithTruncatedLabels = attributesWithScores.map(attr => ({
      ...attr,
      displayLabel: attr.label.length > maxLabelLength 
        ? attr.label.substring(0, 27) + '...' 
        : attr.label
    }));
    
    // Calculate left margin based on longest display label (approximate 8px per character for 14px font)
    const maxDisplayLabelLength = Math.max(...attributesWithTruncatedLabels.map(a => a.displayLabel.length));
    const leftMargin = Math.max(200, maxDisplayLabelLength * 8 + 30); // Minimum 200px, or based on longest label
    
    const barHeight = 25; // Reduced from 35
    const rightMargin = 80; // Space for value labels
    const topMargin = 15; // Reduced from 20

    // Use a fixed base width for calculations to prevent jumping
    const baseChartWidth = 1200;
    const chartWidth = Math.max(800, containerWidth);
    // Calculate plot width based on whether we're in selected mode (3/4 width) or full width
    // When selected, use the actual 3/4 width minus margins, not scaled down
    const effectiveWidth = selectedAttribute ? containerWidth * 0.75 : containerWidth;
    // Use the effective width directly for plot width calculation
    const plotWidth = effectiveWidth - leftMargin - rightMargin;

    return (
      <div ref={parentContainerRef} className="relative w-full">
      <h2 className="text-lg font-semibold text-gray-900 mb-4 text-center">Relative Attribute Importance</h2>
      <div className="flex gap-4">
        <div 
          ref={containerRef} 
          className={`overflow-x-auto overflow-y-hidden transition-all duration-500 ease-in-out ${selectedAttribute ? 'w-3/4' : 'w-full'}`}
          style={{ height: `${chartHeight + topMargin * 2}px`, minHeight: `${chartHeight + topMargin * 2}px`, maxHeight: `${chartHeight + topMargin * 2}px` }}
        >
          <svg width="100%" height={chartHeight + topMargin * 2} viewBox={`0 0 ${effectiveWidth || baseChartWidth} ${chartHeight + topMargin * 2}`} preserveAspectRatio="xMinYMin meet" style={{ minWidth: '800px', height: `${chartHeight + topMargin * 2}px`, minHeight: `${chartHeight + topMargin * 2}px`, maxHeight: `${chartHeight + topMargin * 2}px` }}>
          {/* Vertical line for the base of the bars */}
          <line
            x1={leftMargin}
            y1={topMargin}
            x2={leftMargin}
            y2={chartHeight + topMargin}
            stroke="#E5E7EB"
            strokeWidth="1"
          />
          {attributesWithTruncatedLabels.map((attr, index) => {
            const y = topMargin + index * 35 + barHeight / 2; // Changed from 50 to 35
            // Calculate bar width directly based on the current plot width
            const barWidth = (attr.importance / maxImportance) * plotWidth;
            const barColor = '#D14A2D'; // Brand orange

            const isSelected = selectedAttribute === attr.name;
            const isDimmed = selectedAttribute && !isSelected;
            
            return (
              <g key={attr.name} opacity={isDimmed ? 0.5 : 1} className="transition-opacity duration-500 ease-in-out">
                {/* Attribute label */}
                <text
                  x={leftMargin - 15}
                  y={y + 5}
                  textAnchor="end"
                  className="text-sm fill-gray-900"
                  style={{ fontSize: '14px' }}
                >
                  {attr.displayLabel}
                </text>
                
                {/* Bar */}
                <rect
                  x={leftMargin}
                  y={y - barHeight / 2}
                  width={barWidth}
                  height={barHeight}
                  fill={barColor}
                  rx={4}
                  className="cursor-pointer hover:opacity-80 transition-all duration-500 ease-in-out"
                  onClick={() => setSelectedAttribute(attr.name)}
                />
                
                {/* Value label - show score only */}
                <text
                  x={leftMargin + barWidth + 10}
                  y={y + 5}
                  className="text-sm fill-gray-700 transition-all duration-500 ease-in-out"
                  style={{ fontSize: '13px' }}
                >
                  {attr.score.toFixed(1)}%
                </text>
              </g>
            );
          })}
        </svg>
        </div>
          {selectedAttribute && (() => {
            const selectedAttr = attributesWithScores.find(a => a.name === selectedAttribute);
            const rank = attributesWithScores.findIndex(a => a.name === selectedAttribute) + 1;
            const totalAttributes = attributesWithScores.length;
            
            // Get utility scores for the selected attribute
            const levelUtilities = selectedAttr ? Object.entries(utilitiesData.utilities[selectedAttribute] || {})
              .map(([level, utility]) => ({ level, utility: Number(utility) }))
              .sort((a, b) => b.utility - a.utility) : [];
            
            // Convert number to ordinal (1st, 2nd, 3rd, etc.)
            const getOrdinal = (n: number): string => {
              const s = ["th", "st", "nd", "rd"];
              const v = n % 100;
              return n + (s[(v - 20) % 10] || s[v] || s[0]);
            };
            
            return (
              <div className="w-1/4 bg-white rounded-lg p-4 transition-all duration-500">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">Attribute Details</h3>
                  <button
                    onClick={() => setSelectedAttribute(null)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-gray-600">
                    {selectedAttr?.label}
                  </p>
                  <div className="border-b border-gray-200 my-3"></div>
                  <div className="bg-[#D14A2D] text-white px-3 py-2 rounded-lg flex items-center justify-between">
                    <p className="text-sm">
                      <span className="font-medium">Relative Importance:</span>
                    </p>
                    <p className="text-sm font-medium">
                      {selectedAttr?.score.toFixed(1)}%
                    </p>
                  </div>
                  <div className="bg-[#D14A2D] text-white px-3 py-2 rounded-lg flex items-center justify-between">
                    <p className="text-sm">
                      <span className="font-medium">Rank </span>
                      <span className="text-xs italic font-normal">(out of {totalAttributes}):</span>
                    </p>
                    <p className="text-sm font-medium">
                      {getOrdinal(rank)}
                    </p>
                  </div>
                </div>
                
                {/* Utility Scores Table */}
                {levelUtilities.length > 0 && (() => {
                  const maxUtility = Math.max(...levelUtilities.map(l => l.utility));
                  const minUtility = Math.min(...levelUtilities.map(l => l.utility));
                  return (
                    <div className="mt-6">
                      <div className="border border-gray-200 rounded-lg overflow-hidden">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-[#D14A2D]">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-medium text-white uppercase tracking-wider">Level</th>
                              <th className="px-3 py-2 text-center text-xs font-medium text-white uppercase tracking-wider whitespace-nowrap w-auto">Utility</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {levelUtilities.map(({ level, utility }) => {
                              let rowClass = 'bg-white';
                              if (utility === maxUtility) {
                                rowClass = 'bg-green-50';
                              } else if (utility === minUtility) {
                                rowClass = 'bg-yellow-50';
                              }
                              return (
                                <tr key={level} className={rowClass}>
                                  <td className="px-3 py-2 text-sm text-gray-900">{level}</td>
                                  <td className="px-3 py-2 text-sm text-gray-900 text-center font-medium whitespace-nowrap">{utility.toFixed(3)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })()}
        </div>
      </div>
      );
    }
  );

AttributeImportanceView.displayName = 'AttributeImportanceView';

const getNormalizedMethodology = (project: any) => {
  const potentialValues = [
    project?.methodologyType,
    project?.methodology,
    project?.methodologyName,
    project?.methodologyLabel,
    project?.methodologyDetails?.name,
    project?.researchMethodology
  ];

  const normalized = potentialValues
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(value => value.trim().toLowerCase());

  for (const value of normalized) {
    if (value.includes('conjoint') || value.includes('maxdiff') || value.includes('choice')) {
      return value;
    }
  }

  return normalized.length > 0 ? normalized[0] : '';
};

const isConjointProject = (project: any) => {
  const methodology = getNormalizedMethodology(project);

  if (!methodology) {
    // Check tags as a fallback
    const tags: string[] = Array.isArray(project?.tags) ? project.tags : [];
    return tags.some(tag =>
      typeof tag === 'string' &&
      ['conjoint', 'cbc', 'choice', 'maxdiff', 'choice-based', 'choice modelling', 'choice modeling'].some(keyword =>
        tag.toLowerCase().includes(keyword)
      )
    );
  }

  return [
    'conjoint',
    'cbc',
    'choice-based',
    'choice based',
    'conjoint analysis',
    'choice modeling',
    'choice modelling',
    'maxdiff',
    'max diff'
  ].some(keyword => methodology.includes(keyword));
};

const isArchivedFlag = (value: any) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === '') return false;
    return ['true', '1', 'yes', 'y', 'archived'].includes(normalized);
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return false;
};

interface UtilitiesProjectsProps {
  projects?: any[];
  onNavigateToProject?: (project: any) => void;
  onCreateProject?: () => void;
}

export default function UtilitiesProjects({
  projects = [],
  onNavigateToProject,
  onCreateProject
}: UtilitiesProjectsProps) {
  const { user } = useAuth();

  const [archivedProjects, setArchivedProjects] = useState<any[]>([]);
  const [loadingArchived, setLoadingArchived] = useState(false);
  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active');
  const [showMyProjectsOnly, setShowMyProjectsOnly] = useState(true);
  const [viewMode, setViewMode] = useState<'home' | 'project'>('home');
  const [selectedProject, setSelectedProject] = useState<any | null>(null);
  const [utilitiesFile, setUtilitiesFile] = useState<File | null>(null);
  const [utilitiesData, setUtilitiesData] = useState<UtilitiesData | null>(null);
  const [isParsingFile, setIsParsingFile] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [projectUtilities, setProjectUtilities] = useState<Record<string, UtilitiesData>>({});
  const [axisMode, setAxisMode] = useState<'independent' | 'consistent' | 'manual'>('independent');
  const [manualMin, setManualMin] = useState<number>(-3);
  const [manualMax, setManualMax] = useState<number>(3);
  const [subTab, setSubTab] = useState<'utilities' | 'importance'>('utilities');
  const [copied, setCopied] = useState(false);
  const attributeImportanceRef = useRef<{ copyTable: () => Promise<void> } | null>(null);

  // Filter to only show conjoint projects
  const conjointActiveProjects = useMemo(() => {
    return projects.filter(project => !isArchivedFlag(project?.archived) && isConjointProject(project));
  }, [projects]);

  const conjointArchivedProjects = useMemo(() => {
    return archivedProjects.filter(project => isConjointProject(project));
  }, [archivedProjects]);

  // Load archived projects
  useEffect(() => {
    const loadArchivedProjects = async () => {
      if (activeTab === 'archived' && archivedProjects.length === 0 && !loadingArchived) {
        setLoadingArchived(true);
        try {
          const response = await fetch(`${API_BASE_URL}/api/projects?archived=true`, {
            credentials: 'include'
          });
          if (response.ok) {
            const data = await response.json();
            const archived = Array.isArray(data) ? data : (data.projects || []);
            setArchivedProjects(archived);
          }
        } catch (error) {
          console.error('Error loading archived projects:', error);
        } finally {
          setLoadingArchived(false);
        }
      }
    };
    loadArchivedProjects();
  }, [activeTab, archivedProjects.length, loadingArchived]);

  // Filter projects by user (same logic as ConjointProjects)
  const filterProjectsByUser = useCallback(
    (list: any[]) => {
      if (!showMyProjectsOnly || !user) return list;

      const uid = String((user as any)?.id || '').toLowerCase();
      const uemail = String((user as any)?.email || '').toLowerCase();
      const uname = String((user as any)?.name || '').toLowerCase();

      return list.filter(project => {
        const createdBy = String(project?.createdBy || '').toLowerCase();
        const createdByMe = createdBy && (createdBy === uid || createdBy === uemail);

        const teamMembers = Array.isArray(project?.teamMembers) ? project.teamMembers : [];
        const inTeam = teamMembers.some((member: any) => {
          const mid = String(member?.id || '').toLowerCase();
          const memail = String(member?.email || '').toLowerCase();
          const mname = String(member?.name || '').toLowerCase();
          return (uid && mid === uid) || (uemail && memail === uemail) || (uname && mname === uname);
        });

        return createdByMe || inTeam;
      });
    },
    [showMyProjectsOnly, user]
  );

  // Get display projects based on active tab
  const displayProjects = useMemo(() => {
    const source = activeTab === 'active' ? conjointActiveProjects : conjointArchivedProjects;
    return filterProjectsByUser(source);
  }, [activeTab, conjointActiveProjects, conjointArchivedProjects, filterProjectsByUser]);

  const getClientName = (project: any) => {
    return project.client || project.clientName || '-';
  };

  const getTeamSummary = (project: any) => {
    const team = project.team || [];
    if (team.length === 0) return 'No team members';
    if (team.length === 1) return '1 team member';
    return `${team.length} team members`;
  };

  const getUtilitiesCount = (project: any) => {
    return projectUtilities[project.id] ? 1 : 0;
  };

  // Parse Excel file with utilities
  const parseUtilitiesFile = useCallback(async (file: File) => {
    setIsParsingFile(true);
    setParseError(null);

    try {
      const reader = new FileReader();
      
      reader.onload = async (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          
          // Get first sheet
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          
          // Convert to JSON
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
          
          if (jsonData.length < 2) {
            throw new Error('File must contain at least a header row and one data row');
          }

          // Expected format:
          // Column 1: Attributes (with header)
          // Column 2: Levels (with header)
          // Column 3: Utility scores (with header)

          const headers = (jsonData[0] as any[]).map(h => String(h).trim().toLowerCase());
          
          // Try to find attribute, level, and utility columns
          // First check if columns 0, 1, 2 match the expected headers (most common format)
          let attributeColIndex = -1;
          let levelColIndex = -1;
          let utilityColIndex = -1;
          
          // Check if the first three columns match the expected headers
          if (headers.length >= 3) {
            const col0 = headers[0];
            const col1 = headers[1];
            const col2 = headers[2];
            
            // Check if columns 0, 1, 2 match Attribute, Level, Utility (in any order)
            if ((col0.includes('attribute') || col0.includes('attr')) && 
                (col1.includes('level') || col1.includes('code')) &&
                (col2.includes('utility') || col2.includes('value') || col2.includes('util'))) {
              attributeColIndex = 0;
              levelColIndex = 1;
              utilityColIndex = 2;
            } else {
              // Search for columns in any position
              attributeColIndex = headers.findIndex(h => 
                h.includes('attribute') || h.includes('attr')
              );
              levelColIndex = headers.findIndex(h => 
                h.includes('level') || h.includes('code')
              );
              utilityColIndex = headers.findIndex(h => 
                h.includes('utility') || h.includes('value') || h.includes('util')
              );
            }
          } else {
            // Search for columns in any position
            attributeColIndex = headers.findIndex(h => 
              h.includes('attribute') || h.includes('attr')
            );
            levelColIndex = headers.findIndex(h => 
              h.includes('level') || h.includes('code')
            );
            utilityColIndex = headers.findIndex(h => 
              h.includes('utility') || h.includes('value') || h.includes('util')
            );
          }

          if (attributeColIndex === -1 || levelColIndex === -1 || utilityColIndex === -1) {
            // Try alternative format: attributes as columns
            // First row: Attribute names
            // First column: Level names
            // Cells: Utility values
            
            const firstRow = jsonData[0] as any[];
            const firstColIndex = 0;
            
            // Check if first column contains level names
            const hasLevelColumn = jsonData.slice(1).some(row => {
              const firstCell = String((row as any[])[firstColIndex] || '').trim();
              return firstCell.length > 0;
            });

            if (hasLevelColumn && firstRow.length > 1) {
              // Format: Attributes as columns, levels as rows
              const attributeNames = firstRow.slice(1).map(a => String(a).trim()).filter(a => a);
              const utilities: Record<string, Record<string, number>> = {};
              const schemaAttributes: Array<{
                name: string;
                label: string;
                levels: Array<{ code?: string; level: string }>;
              }> = [];

              attributeNames.forEach(attrName => {
                utilities[attrName] = {};
                const levels: Array<{ code?: string; level: string }> = [];
                
                // Get levels and utilities for this attribute
                for (let i = 1; i < jsonData.length; i++) {
                  const row = jsonData[i] as any[];
                  const levelName = String(row[firstColIndex] || '').trim();
                  const utilityValue = row[firstRow.indexOf(attrName)];
                  
                  if (levelName && utilityValue !== undefined && utilityValue !== null && utilityValue !== '') {
                    const utility = Number(utilityValue);
                    if (!Number.isNaN(utility)) {
                      utilities[attrName][levelName] = utility;
                      levels.push({ level: levelName, code: levelName });
                    }
                  }
                }

                if (Object.keys(utilities[attrName]).length > 0) {
                  schemaAttributes.push({
                    name: attrName,
                    label: attrName,
                    levels
                  });
                }
              });

              // Preserve existing axis settings and excluded levels if they exist
              const existingData = selectedProject ? projectUtilities[selectedProject.id] : null;
              const result: UtilitiesData = {
                utilities,
                schema: { attributes: schemaAttributes },
                axisSettings: existingData?.axisSettings || undefined,
                excludedLevels: existingData?.excludedLevels || undefined
              };
              
              setUtilitiesData(result);
              if (selectedProject) {
                setProjectUtilities(prev => ({
                  ...prev,
                  [selectedProject.id]: result
                }));
                // Save to backend
                try {
                  await fetch(`${API_BASE_URL}/api/utilities/${selectedProject.id}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(result)
                  });
                } catch (error) {
                  console.error('Error saving utilities data:', error);
                }
              }
              
              // Clear the file reference after parsing
              setUtilitiesFile(null);
              setIsParsingFile(false);
              return;
            }
            
            throw new Error('Could not find Attribute, Level, and Utility columns. Expected format: Column 1 = Attributes, Column 2 = Levels, Column 3 = Utility scores (each with a column header).');
          }

          // Parse Attribute | Level | Utility format
          const utilities: Record<string, Record<string, number>> = {};
          const attributeMap = new Map<string, Set<string>>();

          for (let i = 1; i < jsonData.length; i++) {
            const row = jsonData[i] as any[];
            const attribute = String(row[attributeColIndex] || '').trim();
            const level = String(row[levelColIndex] || '').trim();
            const utilityStr = row[utilityColIndex];
            
            if (attribute && level && utilityStr !== undefined && utilityStr !== null && utilityStr !== '') {
              const utility = Number(utilityStr);
              if (!Number.isNaN(utility)) {
                if (!utilities[attribute]) {
                  utilities[attribute] = {};
                }
                utilities[attribute][level] = utility;
                
                if (!attributeMap.has(attribute)) {
                  attributeMap.set(attribute, new Set());
                }
                attributeMap.get(attribute)!.add(level);
              }
            }
          }

          // Build schema
          const schemaAttributes = Array.from(attributeMap.entries()).map(([attrName, levels]) => ({
            name: attrName,
            label: attrName,
            levels: Array.from(levels).map(level => ({ level, code: level }))
          }));

          // Preserve existing axis settings and excluded levels if they exist
          const existingData = selectedProject ? projectUtilities[selectedProject.id] : null;
          const result: UtilitiesData = {
            utilities,
            schema: { attributes: schemaAttributes },
            axisSettings: existingData?.axisSettings || undefined,
            excludedLevels: existingData?.excludedLevels || undefined
          };

          setUtilitiesData(result);
          if (selectedProject) {
            setProjectUtilities(prev => ({
              ...prev,
              [selectedProject.id]: result
            }));
            // Save to backend
            try {
              await fetch(`${API_BASE_URL}/api/utilities/${selectedProject.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(result)
              });
            } catch (error) {
              console.error('Error saving utilities data:', error);
            }
          }
          
          // Clear the file reference after parsing
          setUtilitiesFile(null);
        } catch (error: any) {
          console.error('Error parsing utilities file:', error);
          setParseError(error.message || 'Failed to parse utilities file');
        } finally {
          setIsParsingFile(false);
        }
      };

      reader.onerror = () => {
        setParseError('Failed to read file');
        setIsParsingFile(false);
      };

      reader.readAsArrayBuffer(file);
    } catch (error: any) {
      console.error('Error reading file:', error);
      setParseError(error.message || 'Failed to read file');
      setIsParsingFile(false);
    }
  }, [selectedProject, projectUtilities]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUtilitiesFile(file);
      parseUtilitiesFile(file);
    }
  }, [parseUtilitiesFile]);

  // Load saved utilities when project is selected
  useEffect(() => {
    const loadProjectUtilities = async () => {
      if (selectedProject) {
        // First check if we have it in memory
        if (projectUtilities[selectedProject.id]) {
          const data = projectUtilities[selectedProject.id];
          setUtilitiesData(data);
          // Load axis settings if they exist
          if (data.axisSettings) {
            setAxisMode(data.axisSettings.mode || 'independent');
            if (data.axisSettings.manualMin !== undefined) {
              setManualMin(data.axisSettings.manualMin);
            } else {
              setManualMin(-3);
            }
            if (data.axisSettings.manualMax !== undefined) {
              setManualMax(data.axisSettings.manualMax);
            } else {
              setManualMax(3);
            }
          } else {
            // Reset to defaults if no axis settings
            setAxisMode('independent');
            setManualMin(-3);
            setManualMax(3);
          }
        } else {
          // Try to load from backend
          try {
            const response = await fetch(`${API_BASE_URL}/api/utilities/${selectedProject.id}`, {
              credentials: 'include'
            });
            if (response.ok) {
              const data = await response.json();
              setUtilitiesData(data);
              setProjectUtilities(prev => ({
                ...prev,
                [selectedProject.id]: data
              }));
              // Load axis settings if they exist
              if (data.axisSettings) {
                setAxisMode(data.axisSettings.mode || 'independent');
                if (data.axisSettings.manualMin !== undefined) {
                  setManualMin(data.axisSettings.manualMin);
                } else {
                  setManualMin(-3);
                }
                if (data.axisSettings.manualMax !== undefined) {
                  setManualMax(data.axisSettings.manualMax);
                } else {
                  setManualMax(3);
                }
              } else {
                // Reset to defaults if no axis settings
                setAxisMode('independent');
                setManualMin(-3);
                setManualMax(3);
              }
            } else if (response.status === 404) {
              // No data saved yet, that's okay
              setUtilitiesData(null);
              // Reset to defaults
              setAxisMode('independent');
              setManualMin(-3);
              setManualMax(3);
            } else {
              setUtilitiesData(null);
              // Reset to defaults
              setAxisMode('independent');
              setManualMin(-3);
              setManualMax(3);
            }
          } catch (error) {
            console.error('Error loading utilities data:', error);
            setUtilitiesData(null);
            // Reset to defaults
            setAxisMode('independent');
            setManualMin(-3);
            setManualMax(3);
          }
        }
      } else {
        setUtilitiesData(null);
        setUtilitiesFile(null);
        setParseError(null);
        // Reset to defaults
        setAxisMode('independent');
        setManualMin(-3);
        setManualMax(3);
      }
    };
    
    loadProjectUtilities();
  }, [selectedProject]);

  const showSpinner = loadingArchived && activeTab === 'archived';

  return (
    <div className="flex-1 p-6 space-y-4 max-w-full overflow-y-auto" style={{ height: 'calc(100vh - 80px)', marginTop: '80px' }}>
      <div className="space-y-3">
        {viewMode === 'home' && (
          <>
            <div>
              <div className="flex items-center justify-between">
                <nav className="-mb-px flex space-x-8 items-center">
                  <button
                    onClick={() => setActiveTab('active')}
                    className={`py-2 px-1 border-b-2 font-medium text-sm ${
                      activeTab === 'active'
                        ? 'text-white'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                    style={activeTab === 'active' ? { borderBottomColor: BRAND_ORANGE, color: BRAND_ORANGE } : {}}
                  >
                    Active Projects ({activeTab === 'active' ? displayProjects.length : filterProjectsByUser(conjointActiveProjects).length})
                  </button>
                  <button
                    onClick={() => setActiveTab('archived')}
                    className={`py-2 px-1 border-b-2 font-medium text-sm ${
                      activeTab === 'archived'
                        ? 'text-white'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                    style={activeTab === 'archived' ? { borderBottomColor: BRAND_ORANGE, color: BRAND_ORANGE } : {}}
                  >
                    Archived Projects ({activeTab === 'archived' ? displayProjects.length : filterProjectsByUser(conjointArchivedProjects).length})
                  </button>
                </nav>
                <div className="flex items-center gap-3">
                  {user?.role !== 'oversight' && (
                    <button
                      onClick={() => setShowMyProjectsOnly(!showMyProjectsOnly)}
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
              <div className="overflow-x-auto">
                {showSpinner ? (
                  <div className="p-12 text-center">
                    <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-[#D14A2D]"></div>
                    <p className="text-sm text-gray-500">Loading archived projects...</p>
                  </div>
                ) : displayProjects.length === 0 ? (
                  <div className="p-12 text-center">
                    <DocumentTextIcon className="mx-auto mb-4 h-16 w-16 text-gray-300" />
                    <h3 className="text-lg font-semibold text-gray-900">
                      {activeTab === 'archived' ? 'No archived projects' : 'No active projects'}
                    </h3>
                    <p className="mt-2 text-gray-500">
                      {activeTab === 'archived'
                        ? 'Archived projects will appear here.'
                        : 'Create a project to get started with utilities analysis.'}
                    </p>
                  </div>
                ) : (
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="pl-6 pr-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-0 whitespace-nowrap">
                          Project
                        </th>
                        <th className="pl-2 pr-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                          Client
                        </th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                          Files
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {displayProjects.map(project => (
                        <tr
                          key={project.id}
                          className="hover:bg-gray-50 cursor-pointer transition-colors"
                          onClick={() => {
                            setSelectedProject(project);
                            setViewMode('project');
                          }}
                        >
                          <td className="pl-6 pr-2 py-4 whitespace-nowrap w-0">
                            <div className="inline-block text-sm font-medium text-gray-900">{project.name}</div>
                          </td>
                          <td className="pl-2 pr-6 py-4 whitespace-nowrap w-32">
                            <div className="text-sm text-gray-900 truncate">{getClientName(project)}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-center w-32">
                            <div className="flex items-center justify-center gap-1 text-sm text-gray-900">
                              <IconBook2 className="h-4 w-4 text-gray-400" />
                              {getUtilitiesCount(project)}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </>
        )}

        {viewMode === 'project' && selectedProject && (
          <>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setViewMode('home');
                    setSelectedProject(null);
                    setUtilitiesData(null);
                    setUtilitiesFile(null);
                    setParseError(null);
                  }}
                  className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 px-3 py-1 rounded-lg transition-colors"
                >
                  <ArrowLeftIcon className="h-4 w-4" />
                  Back to Projects
                </button>
                <span className="text-gray-400">|</span>
                <h2 className="text-xl font-semibold text-gray-900">{selectedProject.name}</h2>
              </div>
              {utilitiesData && (
                <div>
                  <label className="block">
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={handleFileUpload}
                      className="hidden"
                      disabled={isParsingFile}
                      id="upload-another-file-input"
                    />
                    <button
                      type="button"
                      onClick={() => document.getElementById('upload-another-file-input')?.click()}
                      disabled={isParsingFile}
                      className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                      <CloudArrowUpIcon className="h-4 w-4 text-gray-600" />
                      {isParsingFile ? 'Parsing...' : 'Upload another file'}
                    </button>
                  </label>
                </div>
              )}
            </div>
            <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-6 py-6 space-y-6">
              <div className={`flex items-center justify-between pb-4 ${subTab === 'importance' ? 'border-b border-gray-200' : ''}`}>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSubTab('utilities')}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                      subTab === 'utilities'
                        ? 'bg-[#D14A2D] text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Average Utilities
                  </button>
                  <button
                    onClick={() => setSubTab('importance')}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                      subTab === 'importance'
                        ? 'bg-[#D14A2D] text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Attribute Importance
                  </button>
                </div>
                {subTab === 'importance' && (
                  <button
                    onClick={async () => {
                      if (attributeImportanceRef.current) {
                        await attributeImportanceRef.current.copyTable();
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                    title="Copy table to clipboard"
                  >
                    <ClipboardDocumentIcon className="h-4 w-4" />
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                )}
              </div>

              {/* File Upload Section */}
              {!utilitiesData && (
              <div className="border border-gray-200 rounded-lg p-6 bg-gray-50">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Upload Utilities File</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Upload an Excel file with utilities already calculated. The file should have the following format:
                </p>
                <ul className="text-sm text-gray-600 mb-4 list-disc list-inside space-y-1">
                  <li><strong>Column 1:</strong> Attributes (with column header)</li>
                  <li><strong>Column 2:</strong> Levels (with column header)</li>
                  <li><strong>Column 3:</strong> Utility scores (with column header)</li>
                </ul>
                
                <div className="mt-4">
                  <label className="block">
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={handleFileUpload}
                      className="hidden"
                      disabled={isParsingFile}
                    />
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => document.querySelector('input[type="file"]')?.click()}
                        disabled={isParsingFile}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <CloudArrowUpIcon className="h-5 w-5 text-gray-600" />
                        {isParsingFile ? 'Parsing...' : utilitiesFile ? 'Change File' : 'Select Excel File'}
                      </button>
                      {utilitiesFile && (
                        <span className="text-sm text-gray-600">{utilitiesFile.name}</span>
                      )}
                    </div>
                  </label>
                </div>

                {parseError && (
                  <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-sm text-red-600">{parseError}</p>
                  </div>
                )}

                {isParsingFile && (
                  <div className="mt-4 flex items-center gap-2 text-sm text-gray-600">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-[#D14A2D]"></div>
                    <span>Parsing utilities file...</span>
                  </div>
                )}
              </div>
              )}

              {/* Utilities Display */}
              {utilitiesData && (
                <div>
                  {subTab === 'utilities' ? (
                  <AverageUtilitiesView 
                    workflow={{
                      estimationResult: utilitiesData
                    }}
                    axisMode={axisMode}
                    manualMin={manualMin}
                    manualMax={manualMax}
                    onAxisModeChange={(mode) => {
                      setAxisMode(mode);
                      // Save axis settings
                      if (selectedProject && utilitiesData) {
                        const updatedData = {
                          ...utilitiesData,
                          axisSettings: {
                            mode,
                            manualMin: mode === 'manual' ? manualMin : undefined,
                            manualMax: mode === 'manual' ? manualMax : undefined
                          }
                        };
                        setUtilitiesData(updatedData);
                        setProjectUtilities(prev => ({
                          ...prev,
                          [selectedProject.id]: updatedData
                        }));
                        // Save to backend
                        fetch(`${API_BASE_URL}/api/utilities/${selectedProject.id}`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          credentials: 'include',
                          body: JSON.stringify(updatedData)
                        }).catch(error => console.error('Error saving axis settings:', error));
                      }
                    }}
                    onManualValuesChange={(min, max) => {
                      setManualMin(min);
                      setManualMax(max);
                      // Save axis settings
                      if (selectedProject && utilitiesData) {
                        const updatedData = {
                          ...utilitiesData,
                          axisSettings: {
                            mode: axisMode,
                            manualMin: min,
                            manualMax: max
                          }
                        };
                        setUtilitiesData(updatedData);
                        setProjectUtilities(prev => ({
                          ...prev,
                          [selectedProject.id]: updatedData
                        }));
                        // Save to backend
                        fetch(`${API_BASE_URL}/api/utilities/${selectedProject.id}`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          credentials: 'include',
                          body: JSON.stringify(updatedData)
                        }).catch(error => console.error('Error saving axis settings:', error));
                      }
                    }}
                  />
                  ) : (
                    <AttributeImportanceView ref={attributeImportanceRef} utilitiesData={utilitiesData} />
                  )}
                </div>
              )}

              {!utilitiesData && !isParsingFile && !parseError && (
                <div className="text-center py-12 text-gray-500">
                  <p>Upload an Excel file with utilities to view the charts.</p>
                </div>
              )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

