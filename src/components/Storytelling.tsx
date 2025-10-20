import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  SparklesIcon,
  DocumentTextIcon,
  ChatBubbleLeftRightIcon,
  ArrowLeftIcon,
  ArrowDownTrayIcon,
  PlusIcon,
  TrashIcon,
  PresentationChartBarIcon,
  ViewColumnsIcon,
  ChartBarIcon,
  LightBulbIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XCircleIcon,
  InformationCircleIcon,
  UserGroupIcon,
  CurrencyDollarIcon,
  ClockIcon,
  ShieldCheckIcon,
  HeartIcon,
  AcademicCapIcon,
  BuildingOfficeIcon,
  HomeIcon,
  TruckIcon,
  WrenchScrewdriverIcon,
  BeakerIcon,
  CpuChipIcon,
  PhoneIcon,
  EnvelopeIcon,
  GlobeAltIcon,
  MapPinIcon,
  CalendarIcon,
  StarIcon,
  FireIcon,
  BoltIcon,
  SunIcon,
  MoonIcon,
  CloudIcon,
  EyeIcon,
  HandRaisedIcon,
  FaceSmileIcon,
  FaceFrownIcon,
  CloudArrowUpIcon
} from '@heroicons/react/24/outline';
import { API_BASE_URL } from '../config';
import { useAuth } from '../contexts/AuthContext';
import { IconTable, IconBook2, IconUsers } from '@tabler/icons-react';

const BRAND_ORANGE = '#D14A2D';
const BRAND_BG = '#F7F7F8';
const BRAND_GRAY = '#5D5F62';

interface Project {
  id: string;
  name: string;
  methodologyType?: string;
  methodology?: string;
  archived?: boolean;
  client?: string;
  respondentCount?: number;
  analysisId?: string;
  createdAt?: string;
  teamMembers?: Array<{ id?: string; email?: string; name?: string }>;
}

interface Finding {
  question: string;
  answer: string;
  insight: string;
}

interface Storyboard {
  id: string;
  title: string;
  generatedAt: string;
  detailLevel: string;
  respondentCount?: number;
  strategicQuestions?: string[];
  sections: Array<{
    title: string;
    content: string;
  }>;
}

interface ChatMessage {
  id: string;
  question: string;
  answer: string;
  confidence?: string;
  note?: string;
  timestamp: string;
}

function getClientName(project: any): string | undefined {
  if (!project) return undefined;
  return (
    project.project?.client ||
    project.client ||
    project.clientName ||
    project.client_name ||
    project.customer ||
    project.account ||
    (typeof project.client === 'object' && project.client?.name) ||
    project?.meta?.client ||
    undefined
  );
}

function formatDateTimeNoSeconds(value: string | number | Date): string {
  const date = new Date(value);
  const datePart = date.toLocaleDateString();
  const timePart = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${datePart}, ${timePart}`;
}

function getProjectName(project: any): string | undefined {
  if (!project) return undefined;
  return (
    project.project?.name ||
    project.projectName ||
    project.project_name ||
    project.name ||
    undefined
  );
}

interface VerbatimQuote {
  text: string;
  context: string;
}

// Helper function to format quote text with bold speaker tags
function formatQuoteText(text: string) {
  // First, split by lines
  const lines = text.split('\n');
  const allElements: JSX.Element[] = [];
  let key = 0;
  

  lines.forEach((line, lineIndex) => {
    // Check if line contains multiple speakers (e.g., "Moderator: ... Respondent: ...")
    const speakerPattern = /([A-Za-z0-9]+):\s*/gi;
    const matches = [...line.matchAll(speakerPattern)];
    
    if (matches.length > 1) {
      // Multiple speakers on same line - split them
      let lastIndex = 0;
      matches.forEach((match, matchIndex) => {
      const speaker = match[1];
        const startPos = match.index!;
        const endPos = matchIndex < matches.length - 1 ? matches[matchIndex + 1].index! : line.length;
        const content = line.substring(startPos + match[0].length, endPos).trim();
        
        // Add a single line break before each speaker except the first
        if (matchIndex > 0) {
          allElements.push(<br key={key++} />);
        }
        
        // Normalize speaker names - ONLY Moderator/Interviewer stay as Moderator, everything else becomes Respondent
        let normalizedSpeaker = speaker;
        if (speaker.toLowerCase() === 'interviewer' || speaker.toLowerCase() === 'moderator') {
          normalizedSpeaker = 'Moderator';
        } else {
          // ALL other speakers (R01, R02, actual names like "Elsie", etc.) become "Respondent"
          normalizedSpeaker = 'Respondent';
        }
        
        allElements.push(
          <React.Fragment key={key++}>
            <strong>{normalizedSpeaker}:</strong> <em>{content}</em>
        </React.Fragment>
      );
      });
    } else if (matches.length === 1) {
      // Single speaker on line
      const match = matches[0];
      const speaker = match[1];
      const content = line.substring(match[0].length).trim();
      
      // Normalize speaker names - ONLY Moderator/Interviewer stay as Moderator, everything else becomes Respondent
      let normalizedSpeaker = speaker;
      if (speaker.toLowerCase() === 'interviewer' || speaker.toLowerCase() === 'moderator') {
        normalizedSpeaker = 'Moderator';
      } else {
        // ALL other speakers (R01, R02, actual names like "Elsie", etc.) become "Respondent"
        normalizedSpeaker = 'Respondent';
      }
      
      allElements.push(
        <React.Fragment key={key++}>
          <strong>{normalizedSpeaker}:</strong> <em>{content}</em>
        </React.Fragment>
      );
    } else {
      // No speaker pattern - regular text
      allElements.push(
        <React.Fragment key={key++}>
        {line}
      </React.Fragment>
    );
    }
    
    // Add line break between different lines
    if (lineIndex < lines.length - 1) {
      allElements.push(<br key={key++} />);
    }
  });

  return <>{allElements}</>;
}

// Helper function to parse and render Markdown content
function parseMarkdownContent(content: string) {
  const lines = content.split('\n');
  const elements: JSX.Element[] = [];
  let key = 0;

  // Helper function to parse inline markdown (bold, italic)
  const parseInlineMarkdown = (text: string) => {
    const parts: (string | JSX.Element)[] = [];
    let currentText = text;
    let partKey = 0;

    // Handle bold text (**text**)
    const boldRegex = /\*\*(.*?)\*\*/g;
    let lastIndex = 0;
    let match;

    while ((match = boldRegex.exec(text)) !== null) {
      // Add text before the bold
      if (match.index > lastIndex) {
        parts.push(currentText.substring(lastIndex, match.index));
      }
      
      // Add bold text
      parts.push(<strong key={`bold-${partKey++}`}>{match[1]}</strong>);
      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(currentText.substring(lastIndex));
    }

    // Handle italic text (*text*)
    const italicParts: (string | JSX.Element)[] = [];
    partKey = 0;

    parts.forEach((part, index) => {
      if (typeof part === 'string') {
        const italicRegex = /\*(.*?)\*/g;
        let lastItalicIndex = 0;
        let italicMatch;

        while ((italicMatch = italicRegex.exec(part)) !== null) {
          // Add text before the italic
          if (italicMatch.index > lastItalicIndex) {
            italicParts.push(part.substring(lastItalicIndex, italicMatch.index));
          }
          
          // Add italic text
          italicParts.push(<em key={`italic-${partKey++}`}>{italicMatch[1]}</em>);
          lastItalicIndex = italicMatch.index + italicMatch[0].length;
        }

        // Add remaining text
        if (lastItalicIndex < part.length) {
          italicParts.push(part.substring(lastItalicIndex));
        }
      } else {
        italicParts.push(part);
      }
    });

    return italicParts.length > 0 ? italicParts : [text];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (!line) {
      elements.push(<br key={key++} />);
      continue;
    }

    // Heading 4 (#### )
    if (line.startsWith('#### ')) {
      const text = line.substring(5);
      elements.push(
        <h5 key={key++} className="text-sm font-semibold text-gray-900 mt-3 mb-2">
          {text}
        </h5>
      );
    }
    // Heading 3 (### )
    else if (line.startsWith('### ')) {
      const text = line.substring(4);
      elements.push(
        <h4 key={key++} className="text-sm font-semibold text-gray-900 mt-4 mb-2">
          {text}
        </h4>
      );
    }
    // Bold text (**text**)
    else if (line.startsWith('**') && line.endsWith('**') && line.length > 4) {
      const text = line.substring(2, line.length - 2);
      elements.push(
        <p key={key++} className="text-sm text-gray-700 mb-2">
          <strong>{text}</strong>
        </p>
      );
    }
    // Bullet point (- )
    else if (line.startsWith('- ')) {
      const text = line.substring(2);
      const parsedText = parseInlineMarkdown(text);
      elements.push(
        <div key={key++} className="flex mb-1">
          <span className="text-gray-500 mr-2 leading-6">•</span>
          <span className="text-sm text-gray-700 flex-1 leading-6">{parsedText}</span>
        </div>
      );
    }
    // Regular paragraph
    else {
      const parsedText = parseInlineMarkdown(line);
      elements.push(
        <p key={key++} className="text-sm text-gray-700 mb-2">
          {parsedText}
        </p>
      );
    }
  }

  return <div className="space-y-1">{elements}</div>;
}

interface ReportSlideProps {
  slide: any;
  slideNumber: number;
  totalSlides: number;
  getIcon: (iconName: string) => any;
  selectedProject: any;
  projectMap: Record<string, any>;
}

const ReportSlide: React.FC<ReportSlideProps> = ({ slide, slideNumber, totalSlides, getIcon, selectedProject, projectMap }) => {
  const IconComponent = getIcon(slide.icon);

  return (
    <div className="bg-white rounded-lg shadow-lg border border-gray-200 mb-3 flex flex-col relative" style={{ aspectRatio: '16/9', height: '500px', width: '100%', maxWidth: '888px', overflow: 'hidden' }}>
      {/* Slide Header - Only show for non-title slides */}
      {slide.type !== 'title' && (
        <div className="flex items-center p-3 border-b border-gray-200 flex-shrink-0" style={{ backgroundColor: BRAND_ORANGE }}>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(255, 255, 255, 0.3)' }}>
              <IconComponent className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">{slide.title}</h2>
              {slide.subtitle && (
                <p className="text-xs text-white opacity-90">{slide.subtitle}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Slide Content */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {slide.type === 'title' && (
          <div className="w-full h-full flex flex-col justify-center items-center text-center p-8">
            <h1 className="text-3xl font-bold mb-4" style={{ color: BRAND_ORANGE }}>
              {getProjectName(selectedProject) || 'Project Name'} - Report Outline
            </h1>
            <p className="text-lg text-gray-600 mb-4">Client: {projectMap[selectedProject?.id]?.client || getClientName(projectMap[selectedProject?.id]) || getClientName(selectedProject) || 'Client Name'}</p>
            <p className="text-sm italic text-gray-500 mt-2">Generated: {new Date().toLocaleDateString()}</p>
          </div>
        )}

        {slide.type === 'executive_summary' && (
          <div className="h-full flex flex-col">
            <div className="flex-1 flex flex-col p-4 pb-0 overflow-hidden">
              {slide.findings && (
                <div className="flex-1 flex flex-col space-y-2 min-h-0">
                  {/* Header Row */}
                  <div className="grid grid-cols-12 gap-2 font-semibold text-xs flex-shrink-0" style={{ color: BRAND_ORANGE }}>
                    <div className="col-span-2">Strategic Questions</div>
                    <div className="col-span-5">Key Answers</div>
                    <div className="col-span-5">Strategic Insights</div>
                  </div>

                  {/* Content Rows - Each finding in its own row with equal height distribution */}
                  <div className="flex-1 grid gap-3 overflow-hidden" style={{ gridTemplateRows: `repeat(${slide.findings.length}, 1fr)` }}>
                  {slide.findings.map((finding: any, idx: number) => (
                      <div key={idx} className="grid grid-cols-12 gap-3 min-h-0">
                      {/* Question Column */}
                      <div className="col-span-2">
                          <div className="bg-gray-50 p-2 rounded border-l-4 h-full flex items-start" style={{ borderLeftColor: BRAND_ORANGE }}>
                          <p className="text-[10px] text-gray-700 font-medium leading-tight">{finding.question}</p>
                        </div>
                      </div>

                      {/* Answer Column */}
                      <div className="col-span-5">
                          <div className="bg-blue-50 p-2 rounded border-l-4 h-full flex items-start" style={{ borderLeftColor: '#3B82F6' }}>
                          <p className="text-[10px] text-gray-700 leading-tight">
                            {finding.answer}
                          </p>
                        </div>
                      </div>

                      {/* Insight Column */}
                      <div className="col-span-5">
                          <div className="bg-orange-50 p-2 rounded border-l-4 h-full flex items-start" style={{ borderLeftColor: BRAND_ORANGE }}>
                          <p className="text-[10px] text-gray-700 leading-tight">
                            {finding.insight || 'Key insight to be developed'}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                  </div>
                </div>
              )}
            </div>
            {/* Footer with separator line and page number */}
            <div className="flex-shrink-0 border-t border-gray-300 bg-white flex items-center justify-end px-6" style={{ height: '20px' }}>
              <span className="text-xs italic" style={{ color: BRAND_GRAY }}>
                {slideNumber}
              </span>
            </div>
          </div>
        )}


        {slide.type === 'detailed_finding' && (
          <div className="h-full flex flex-col">
            <div className="flex-1 p-4 pb-0 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                  <div className="space-y-3">
                {slide.content.map((bullet: string, idx: number) => (
                  <div key={idx} className="flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full mt-2 flex-shrink-0" style={{ backgroundColor: BRAND_ORANGE }}></div>
                    <p className="text-xs text-gray-700 leading-relaxed">{bullet}</p>
                  </div>
                ))}
              </div>
              {/* Real quotes section */}
              {slide.quotes && slide.quotes.length > 0 && (
                <div className="mt-6 space-y-3">
                  {slide.quotes.map((quote: string, quoteIdx: number) => (
                    <div key={quoteIdx} className="p-4 bg-gray-50 rounded-lg border-l-4" style={{ borderLeftColor: BRAND_ORANGE }}>
                      <p className="text-xs text-gray-600 mb-2 font-medium">Key Quote:</p>
                      <p className="text-xs text-gray-700 italic">"{quote}"</p>
                      <p className="text-[10px] text-gray-500 mt-2">— Research Participant</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Footer with separator line and page number */}
            <div className="flex-shrink-0 border-t border-gray-300 bg-white flex items-center justify-end px-6" style={{ height: '20px' }}>
              <span className="text-xs italic" style={{ color: BRAND_GRAY }}>
                {slideNumber}
              </span>
            </div>
          </div>
        )}

        {slide.type === 'content_slide' && (
          <div className="h-full flex flex-col">
            <div className="flex-1 flex flex-col min-h-0 p-3 pb-0 overflow-hidden">
              {/* Slide Headline - Use Key Insights content as headline */}
              {(() => {
                const keyInsightsSection = slide.content?.find((section: any) => section.subheading === 'Key Insights');
                const headlineText = keyInsightsSection?.paragraph || slide.headline;

                return headlineText && (
                  <div className="flex-shrink-0 mb-4">
                    <h3 className="text-sm font-semibold leading-tight" style={{ color: BRAND_GRAY }}>
                      {headlineText}
                    </h3>
                  </div>
                );
              })()}

              {/* Main content area that fills the slide */}
              <div className="flex-1 flex flex-col w-full min-h-0">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 flex-1 w-full h-full min-h-0">
                {/* Left side - Content */}
                  <div className="space-y-1.5 w-full h-full overflow-y-auto pr-2" style={{ scrollbarWidth: 'thin' }}>
                  {slide.content && slide.content.map((section: any, idx: number) => {
                    // Skip Key Insights section - it's now used as the headline
                    if (section.subheading === 'Key Insights') {
                      return null;
                    }

                    return (
                        <div key={idx} className="space-y-1.5">
                          <h4 className="text-sm font-bold" style={{ color: BRAND_ORANGE }}>
                          {section.subheading}
                        </h4>

                        {/* Handle bullets if they exist */}
                        {section.bullets && section.bullets.length > 0 && (
                          <ul className="space-y-1">
                            {section.bullets.map((bullet: string, bulletIdx: number) => (
                              <li key={bulletIdx} className="flex items-start gap-2">
                                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5" style={{ backgroundColor: BRAND_ORANGE }}></div>
                                  <p className="text-xs text-gray-700 leading-relaxed flex-1">{bullet}</p>
                              </li>
                            ))}
                          </ul>
                        )}

                        {/* Handle paragraph content if it exists */}
                        {section.paragraph && (
                            <div className="bg-gray-50 p-3 rounded border-l-2" style={{ borderLeftColor: BRAND_ORANGE }}>
                            <p className="text-xs text-gray-700 leading-relaxed">{section.paragraph}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Right side - Supporting Quotes */}
                  <div className="space-y-2 w-full h-full overflow-y-auto pr-2" style={{ scrollbarWidth: 'thin' }}>
                  {slide.quotes && slide.quotes.length > 0 ? (
                    <div className="space-y-2">
                      {slide.quotes.map((quote: any, quoteIdx: number) => (
                          <div key={quoteIdx} className="p-3 bg-gray-50 rounded border-l-2" style={{ borderLeftColor: BRAND_ORANGE }}>
                            <p className="text-[10px] text-gray-700 italic leading-snug">"{quote.text}"</p>
                            {quote.respno && (
                              <p className="text-[9px] text-gray-500 mt-1">- {quote.respno}</p>
                            )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[10px] text-gray-500 italic">No supporting quotes available for this slide.</p>
                  )}
                </div>
              </div>
              </div>
            </div>
            {/* Footer with separator line and page number */}
            <div className="flex-shrink-0 border-t border-gray-300 bg-white flex items-center justify-end px-6" style={{ height: '20px' }}>
              <span className="text-xs italic" style={{ color: BRAND_GRAY }}>
                {slideNumber}
              </span>
            </div>
          </div>
        )}
      </div>
      
      {/* Slide Number - Bottom Right (only for slides without their own footer) */}
      {slide.type !== 'title' && slide.type !== 'executive_summary' && slide.type !== 'detailed_finding' && slide.type !== 'content_slide' && (
        <div className="absolute bottom-6 right-6">
          <span className="text-xs italic" style={{ color: BRAND_GRAY }}>
            {slideNumber}
          </span>
        </div>
      )}
    </div>
  );
};

interface StorytellingProps {
  analysisId?: string;
  projectId?: string;
}

export default function Storytelling({ analysisId, projectId }: StorytellingProps) {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [archivedProjects, setArchivedProjects] = useState<Project[]>([]);
  const [allProjects, setAllProjects] = useState<any[]>([]);
  const [projectMap, setProjectMap] = useState<Record<string, any>>({});
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [forceListView, setForceListView] = useState<boolean>(false);
  const [contentAnalyses, setContentAnalyses] = useState<any[]>([]);
  const [selectedContentAnalysis, setSelectedContentAnalysis] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<'key-findings' | 'storyboard' | 'report' | 'ask'>('key-findings');
  const [projectTab, setProjectTab] = useState<'active' | 'archived'>('active');
  const [showMyProjectsOnly, setShowMyProjectsOnly] = useState(true);
  const [loading, setLoading] = useState(false);

  // Storytelling data
  const [strategicQuestions, setStrategicQuestions] = useState<string[]>([]);
  const [keyFindings, setKeyFindings] = useState<{ findings: Finding[]; generatedAt?: string; respondentCount?: number; strategicQuestions?: string[] } | null>(null);
  const [conciseExecutiveSummary, setConciseExecutiveSummary] = useState<{ findings: Finding[]; generatedAt?: string } | null>(null);
  const [dynamicReport, setDynamicReport] = useState<{ slides: any[]; generatedAt?: string } | null>(null);
  const [storyboards, setStoryboards] = useState<Storyboard[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);

  // Icon mapping function
  const getIcon = (iconName: string) => {
    switch (iconName) {
      case 'DocumentTextIcon': return DocumentTextIcon;
      case 'LightBulbIcon': return LightBulbIcon;
      case 'SparklesIcon': return SparklesIcon;
      case 'ChatBubbleLeftRightIcon': return ChatBubbleLeftRightIcon;
      case 'ChartBarIcon': return ChartBarIcon;
      case 'PresentationChartBarIcon': return PresentationChartBarIcon;
      case 'ExclamationTriangleIcon': return ExclamationTriangleIcon;
      case 'CheckCircleIcon': return CheckCircleIcon;
      case 'XCircleIcon': return XCircleIcon;
      case 'InformationCircleIcon': return InformationCircleIcon;
      case 'UserGroupIcon': return UserGroupIcon;
      case 'CurrencyDollarIcon': return CurrencyDollarIcon;
      case 'ClockIcon': return ClockIcon;
      case 'ShieldCheckIcon': return ShieldCheckIcon;
      case 'HeartIcon': return HeartIcon;
      case 'AcademicCapIcon': return AcademicCapIcon;
      case 'BuildingOfficeIcon': return BuildingOfficeIcon;
      case 'HomeIcon': return HomeIcon;
      case 'TruckIcon': return TruckIcon;
      case 'WrenchScrewdriverIcon': return WrenchScrewdriverIcon;
      case 'BeakerIcon': return BeakerIcon;
      case 'CpuChipIcon': return CpuChipIcon;
      case 'PhoneIcon': return PhoneIcon;
      case 'EnvelopeIcon': return EnvelopeIcon;
      case 'GlobeAltIcon': return GlobeAltIcon;
      case 'MapPinIcon': return MapPinIcon;
      case 'CalendarIcon': return CalendarIcon;
      case 'StarIcon': return StarIcon;
      case 'FireIcon': return FireIcon;
      case 'BoltIcon': return BoltIcon;
      case 'SunIcon': return SunIcon;
      case 'MoonIcon': return MoonIcon;
      case 'CloudIcon': return CloudIcon;
      case 'EyeIcon': return EyeIcon;
      case 'HandRaisedIcon': return HandRaisedIcon;
      case 'FaceSmileIcon': return FaceSmileIcon;
      case 'FaceFrownIcon': return FaceFrownIcon;
      default: return DocumentTextIcon;
    }
  };

  // UI state
  const [generatingFindings, setGeneratingFindings] = useState(false);
  const [generatingStoryboard, setGeneratingStoryboard] = useState(false);
  const [askingQuestion, setAskingQuestion] = useState(false);
  const [costEstimate, setCostEstimate] = useState<any>(null);
  const [pendingAction, setPendingAction] = useState<'findings' | 'storyboard' | 'question' | null>(null);
  const [showNoChangesMessage, setShowNoChangesMessage] = useState(false);
  const [showNoChangesMessageStoryboard, setShowNoChangesMessageStoryboard] = useState(false);

  // Form state
  const [newQuestion, setNewQuestion] = useState('');
  const [editingQuestions, setEditingQuestions] = useState(false);
  const [tempQuestions, setTempQuestions] = useState<string[]>([]);
  const [detailLevel, setDetailLevel] = useState<'straightforward' | 'moderate' | 'max'>('moderate');
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [showOldStoryboards, setShowOldStoryboards] = useState(false);
  
  // Quotes modal state
  const [showQuotesModal, setShowQuotesModal] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState<ChatMessage | null>(null);

  // Generate options modal state
  const [showGenerateOptionsModal, setShowGenerateOptionsModal] = useState(false);
  const [generateStoryboardChecked, setGenerateStoryboardChecked] = useState(false);
  const [generateReportChecked, setGenerateReportChecked] = useState(false);
  const [storyboardCostEstimate, setStoryboardCostEstimate] = useState<any>(null);
  const [reportCostEstimate, setReportCostEstimate] = useState<any>(null);
  const [estimatingCost, setEstimatingCost] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showNoChangesWarning, setShowNoChangesWarning] = useState(false);
  const [generateButtonDisabledTime, setGenerateButtonDisabledTime] = useState(0);

  // Reset generating state and warning when modal closes
  useEffect(() => {
    if (!showGenerateOptionsModal) {
      setIsGenerating(false);
      setShowNoChangesWarning(false);
      setGenerateButtonDisabledTime(0);
    }
  }, [showGenerateOptionsModal]);

  // Fetch cost estimates when modal opens
  useEffect(() => {
    if (showGenerateOptionsModal && selectedProject) {
      const fetchCosts = async () => {
        setEstimatingCost(true);
        try {
          // Estimate storyboard generation cost
          const storyboardResponse = await fetch(`${API_BASE_URL}/api/storytelling/${selectedProject.id}/estimate`, {
            method: 'POST',
            headers: {
              ...getAuthHeaders(),
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              detailLevel: 'moderate',
              analysisId: selectedProject?.analysisId || analysisId,
              type: 'storyboard'
            })
          });

          if (storyboardResponse.ok) {
            const estimate = await storyboardResponse.json();
            console.log('Storyboard estimate:', estimate);
            setStoryboardCostEstimate(estimate);
          } else {
            console.error('Storyboard estimate failed:', storyboardResponse.status);
          }

          // Estimate report generation cost
          const reportResponse = await fetch(`${API_BASE_URL}/api/storytelling/${selectedProject.id}/estimate`, {
            method: 'POST',
            headers: {
              ...getAuthHeaders(),
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              detailLevel: 'moderate',
              analysisId: selectedProject?.analysisId || analysisId,
              type: 'report'
            })
          });

          if (reportResponse.ok) {
            const estimate = await reportResponse.json();
            console.log('Report estimate:', estimate);
            setReportCostEstimate(estimate);
          } else {
            console.error('Report estimate failed:', reportResponse.status);
          }
        } catch (error) {
          console.error('Failed to estimate costs:', error);
        } finally {
          setEstimatingCost(false);
        }
      };

      fetchCosts();
    }
  }, [showGenerateOptionsModal, selectedProject, analysisId]);

  // Clear no changes message when navigating away
  useEffect(() => {
    const handleBeforeUnload = () => {
      setShowNoChangesMessage(false);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        setShowNoChangesMessage(false);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Listen for project selection from project details
    const handleProjectSelection = (event: CustomEvent) => {
      const { projectId, projectName } = event.detail;
      console.log('🔍 Project selected from project details:', { projectId, projectName });
      
      // Find the project in the projects list
      const project = projects.find(p => p.id === projectId);
      if (project) {
        setSelectedProject(project);
        setForceListView(false); // Switch to project view
        console.log('🔍 Switched to project:', project.name);
      }
    };

    window.addEventListener('selectProjectInStorytelling', handleProjectSelection as EventListener);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('selectProjectInStorytelling', handleProjectSelection as EventListener);
    };
  }, [projects]);
  const [quotes, setQuotes] = useState<VerbatimQuote[]>([]);
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const [quotesError, setQuotesError] = useState<string | null>(null);
  const [quotesCached, setQuotesCached] = useState(false);

  // Details modal state for storyboard sections
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsItems, setDetailsItems] = useState<Array<{ bullet: string; details?: string; quotes?: VerbatimQuote[]; expanded?: boolean; loading?: boolean }>>([]);
  const [detailsTitle, setDetailsTitle] = useState<string>('');

  // View mode state
  const [viewMode, setViewMode] = useState<'home' | 'project'>('home');

  // Report outline state (separate from storyboard)
  const [reportOutline, setReportOutline] = useState<any>(null);
  const [reportData, setReportData] = useState<any>(null);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);

  const extractBulletsFromMarkdown = (markdown: string): string[] => {
    if (!markdown) return [];
    const lines = markdown.split('\n').map(l => l.trim());
    const bullets: string[] = [];
    for (const line of lines) {
      // Support '-', '*', '•', and numbered lists like '1.'
      if (line.startsWith('- ') || line.startsWith('* ') || line.startsWith('• ')) {
        bullets.push(line.substring(2).trim());
      } else {
        const numMatch = line.match(/^\d+\.[\s]+(.*)$/);
        if (numMatch && numMatch[1]) bullets.push(numMatch[1].trim());
      }
    }
    // De-duplicate and limit to first 5 to keep requests light
    return Array.from(new Set(bullets)).filter(Boolean).slice(0, 5);
  };

  const extractQuotesFromContent = (content: string): string[] => {
    if (!content) return [];
    const quotes: string[] = [];
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      // Look for quoted text or speaker patterns
      if (trimmed.includes('"') || trimmed.includes('"') || 
          trimmed.toLowerCase().includes('respondent:') ||
          trimmed.toLowerCase().includes('participant:') ||
          trimmed.toLowerCase().includes('moderator:')) {
        if (trimmed.length > 20 && trimmed.length < 200) {
          quotes.push(trimmed);
        }
      }
    }
    
    return quotes.slice(0, 2); // Return max 2 quotes per slide
  };

  const generateDetailsForBullet = async (bullet: string): Promise<string | undefined> => {
    if (!selectedProject) return undefined;
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 10000);
      const response = await fetch(`${API_BASE_URL}/api/storytelling/${selectedProject.id}/expand-bullet`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bullet,
          detailLevel,
          analysisId: selectedProject?.analysisId || analysisId
        }),
        signal: ctrl.signal
      });
      clearTimeout(to);
      if (response.ok) {
        const result = await response.json();
        return result?.answer || result?.text || undefined;
      }
    } catch (e) {}
    return undefined;
  };

  const fetchQuotesForBullet = async (bullet: string): Promise<VerbatimQuote[] | undefined> => {
    if (!selectedProject) return undefined;
    try {
      const quotesAnalysisId = selectedProject?.analysisId || analysisId;
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 10000);
      const response = await fetch(`${API_BASE_URL}/api/storytelling/${selectedProject.id}/quotes`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: bullet, answer: bullet, analysisId: quotesAnalysisId }),
        signal: ctrl.signal
      });
      clearTimeout(to);
      if (response.ok) {
        const data = await response.json();
        return data.quotes || [];
      }
    } catch (e) {}
    return undefined;
  };

  // Simple in-memory cache keyed by bullet text for individual bullets
  const detailsCacheRef = React.useRef<Map<string, { details: string; quotes: VerbatimQuote[] }>>(new Map());

  const openDetailsForSection = async (title: string, content: string) => {
    setDetailsTitle(title);
    setShowDetailsModal(true);
    setDetailsLoading(false);
    const bullets = extractBulletsFromMarkdown(content);
    const initialItems = bullets.map(b => ({ bullet: b, expanded: false }));
    setDetailsItems(initialItems);
  };

  const expandBullet = async (index: number) => {
    const item = detailsItems[index];
    if (item.details && item.quotes) return; // Already expanded
    
    // Check if any other bullet is currently loading
    const isAnyLoading = detailsItems.some((item, idx) => idx !== index && item.loading);
    if (isAnyLoading) return; // Don't allow clicking if another is loading
    
    // Check cache first
    const cacheKey = item.bullet;
    if (detailsCacheRef.current.has(cacheKey)) {
      const cached = detailsCacheRef.current.get(cacheKey)!;
      const updatedItems = [...detailsItems];
      updatedItems[index] = { ...item, details: cached.details, quotes: cached.quotes, expanded: true, loading: false };
      setDetailsItems([...updatedItems]);
      return;
    }
    
    // Set this specific item as expanded and loading
    const updatedItems = [...detailsItems];
    updatedItems[index] = { ...item, expanded: true, loading: true };
    setDetailsItems([...updatedItems]);
    
    try {
      const [details, quotes] = await Promise.all([
        generateDetailsForBullet(item.bullet),
        fetchQuotesForBullet(item.bullet)
      ]);
      
      // Cache the results
      detailsCacheRef.current.set(cacheKey, { details: details || '', quotes: quotes || [] });
      
      // Update with the loaded data
      updatedItems[index] = { ...item, details, quotes, expanded: true, loading: false };
      setDetailsItems([...updatedItems]);
    } catch (error) {
      console.error('Error expanding bullet:', error);
      // Set loading to false even on error
      updatedItems[index] = { ...item, expanded: true, loading: false };
      setDetailsItems([...updatedItems]);
    }
  };

  // This will be defined after the filtering logic

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('cognitive_dash_token');
    return token ? { Authorization: `Bearer ${token}` } : { Authorization: '' };
  }, []);

  const loadProjectData = async (projectId: string) => {
    try {
      // Load storytelling data for the project
      const analysisIdParam = selectedProject?.analysisId || selectedContentAnalysis?.id || analysisId;
      const url = analysisIdParam
        ? `${API_BASE_URL}/api/storytelling/${projectId}?analysisId=${analysisIdParam}`
        : `${API_BASE_URL}/api/storytelling/${projectId}`;
      console.log('🔍 Loading project data with analysisId:', analysisIdParam, 'for project:', projectId);
      const response = await fetch(url, {
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        setStrategicQuestions(data.strategicQuestions || []);
        
        // Use selected content analysis data if available, otherwise fall back to project data
        const respondentCount = selectedContentAnalysis ? 
          (() => {
            const allData = Object.values(selectedContentAnalysis.data || {}).flat();
            const uniqueRespondents = new Set(allData.map((item: any) => item.respno).filter(Boolean));
            return uniqueRespondents.size;
          })() : 
          (projectMap[projectId]?.respondentCount ?? selectedProject?.respondentCount ?? 0);
        
        // Preserve respondentCount and strategicQuestions when loading existing keyFindings
        if (data.keyFindings) {
          setKeyFindings({
            ...data.keyFindings,
            respondentCount: data.keyFindings.respondentCount || respondentCount,
            strategicQuestions: data.keyFindings.strategicQuestions || data.strategicQuestions || []
          });
        } else {
          setKeyFindings(data.keyFindings);
        }
        
        // Preserve respondentCount and strategicQuestions when loading existing storyboards
        if (data.storyboards && data.storyboards.length > 0) {
          const storyboardsWithCount = data.storyboards.map((sb: any) => ({
            ...sb,
            respondentCount: sb.respondentCount || respondentCount,
            strategicQuestions: sb.strategicQuestions || data.strategicQuestions || []
          }));
          setStoryboards(storyboardsWithCount);
        } else {
          setStoryboards(data.storyboards || []);
        }
        
        // Load concise executive summary if available
        if (data.conciseExecutiveSummary) {
          setConciseExecutiveSummary(data.conciseExecutiveSummary);
        }
        
        // Load dynamic report if available
        if (data.dynamicReport) {
          setDynamicReport(data.dynamicReport);
        }

        // Load report data if available
        if (data.reportData) {
          console.log('🔍 Loading report data:', data.reportData);
          setReportData(data.reportData);
          setReportOutline(data.reportData);  // Also set reportOutline for display
        } else {
          console.log('🔍 No report data found in loaded data:', Object.keys(data));
        }
        
        // Load chat history if available
        if (data.chatHistory) {
          setChatHistory(data.chatHistory);
        }
        
        // If no storyboards were loaded from the main API, try to load them separately
        if (!data.storyboards || data.storyboards.length === 0) {
          try {
            const storyboardResponse = await fetch(`${API_BASE_URL}/api/storytelling/${projectId}/storyboards?analysisId=${selectedContentAnalysis?.id || analysisId}`, {
              headers: getAuthHeaders()
            });
            if (storyboardResponse.ok) {
              const storyboardData = await storyboardResponse.json();
              const storyboards = storyboardData.storyboards || storyboardData || [];
              if (storyboards.length > 0) {
                const storyboardsWithCount = storyboards.map((sb: any) => ({
                  ...sb,
                  respondentCount: sb.respondentCount || respondentCount,
                  strategicQuestions: sb.strategicQuestions || strategicQuestions
                }));
                setStoryboards(storyboardsWithCount);
              }
            }
          } catch (error) {
            console.error('Failed to load storyboards separately:', error);
          }
        }
      } else {
        console.error('Failed to load project data:', response.status, response.statusText);
        // If the API doesn't exist, initialize empty state
        setStrategicQuestions([]);
        setKeyFindings(null);
        setStoryboards([]);
        setConciseExecutiveSummary(null);
        setDynamicReport(null);
        setChatHistory([]);
      }
    } catch (error) {
      console.error('Failed to load project data:', error);
      // If there's an error, initialize empty state
      setStrategicQuestions([]);
      setKeyFindings(null);
      setStoryboards([]);
      setConciseExecutiveSummary(null);
      setDynamicReport(null);
      setChatHistory([]);
    }
  };

  const loadContentAnalysesForProject = async (projectId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/caX/saved`, {
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        // The API returns an array directly, not an object with analyses property
        const allAnalyses = Array.isArray(data) ? data : (data.analyses || []);
        const projectAnalyses = allAnalyses.filter((analysis: any) => analysis.projectId === projectId);
        
        // Load storyboards for each analysis
        const analysesWithStoryboards = await Promise.all(
          projectAnalyses.map(async (analysis: any) => {
            try {
              const storyboardResponse = await fetch(`${API_BASE_URL}/api/storytelling/${projectId}/storyboards?analysisId=${analysis.id}`, {
                headers: getAuthHeaders()
              });
              if (storyboardResponse.ok) {
                const storyboardData = await storyboardResponse.json();
                return {
                  ...analysis,
                  storyboardCount: storyboardData.storyboards?.length || 0
                };
              }
            } catch (error) {
              console.error(`Failed to load storyboards for analysis ${analysis.id}:`, error);
            }
            return {
              ...analysis,
              storyboardCount: 0
            };
          })
        );
        
        setContentAnalyses(analysesWithStoryboards);
      } else {
        console.error('Failed to load content analyses for project');
        setContentAnalyses([]);
      }
    } catch (error) {
      console.error('Failed to load content analyses for project:', error);
      setContentAnalyses([]);
    }
  };

  const loadFullContentAnalysis = async (analysisId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/caX/saved/${analysisId}`, {
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const analysisData = await response.json();
        setSelectedContentAnalysis(analysisData);
        return analysisData;
      } else {
        console.error('Failed to load full content analysis');
        return null;
      }
    } catch (error) {
      console.error('Failed to load full content analysis:', error);
      return null;
    }
  };

  const loadProjects = useCallback(async () => {
    try {
      setLoading(true);
      // Use the storytelling-specific API to get projects with analysisId
      const response = await fetch(`${API_BASE_URL}/api/storytelling/projects`, {
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        const projectsArray: Project[] = Array.isArray(data.projects) ? data.projects : [];
        
        // Projects from storytelling API already have analysisId and respondentCount
        // Just log them for debugging
        projectsArray.forEach((project: any) => {
          console.log(`Processing project: ${project.name} (ID: ${project.id}, analysisId: ${project.analysisId})`);
        });

        // Use projects as-is since they already have all needed data from storytelling API
        const projectsWithAnalysisCounts = projectsArray;
        
        setProjects(projectsWithAnalysisCounts);
        setAllProjects(projectsWithAnalysisCounts);
            const map: Record<string, any> = {};
        projectsWithAnalysisCounts.forEach((p: any) => { if (p?.id) map[p.id] = p; });
            setProjectMap(map);
      } else {
        console.error('Failed to load projects');
      }
    } catch (error) {
      console.error('Failed to load projects:', error);
    } finally {
      setLoading(false);
    }
  }, [user?.id, getAuthHeaders]);

  // Project filtering logic (same as Transcripts tab)
  const isQualitative = (project: any) => {
    const methodology = project?.methodologyType?.toLowerCase();
    // If no methodology type, assume it's qualitative (for backward compatibility)
    if (!methodology) {
      return true;
    }
    
    const isQual = methodology?.includes('qualitative') || 
           methodology?.includes('qual') ||
           methodology?.includes('interview') ||
           methodology?.includes('focus group') ||
           methodology?.includes('ethnography') ||
           methodology?.includes('observation');
    return isQual;
  };

  const qualActiveProjects = useMemo(
    () => {
      console.log('🔍 Filtering projects for qualitative methodology:', {
        totalProjects: projects.length,
        projectDetails: projects.map(p => ({
          name: p.name,
          methodologyType: p.methodologyType,
          methodology: p.methodology,
          isQualitative: isQualitative(p),
          id: p.id,
          client: p.client,
          teamMembers: p.teamMembers?.length || 0
        }))
      });
      const filtered = projects.filter(isQualitative);
      console.log('🔍 Qualitative projects found:', filtered.length);
      return filtered;
    },
    [projects]
  );
  const qualArchivedProjects = useMemo(
    () => {
      const filtered = archivedProjects.filter(isQualitative);
      return filtered;
    },
    [archivedProjects]
  );

  const filterProjectsByUser = useCallback(
    (list: any[]) => {
      console.log('🔍 filterProjectsByUser called:', {
        showMyProjectsOnly,
        hasUser: !!user,
        projectCount: list.length,
        projectNames: list.map(p => p.name)
      });

      if (!showMyProjectsOnly || !user) {
        console.log('🔍 Returning all projects (showMyProjectsOnly=false or no user)');
        return list;
      }

      // TEMPORARY: Always return all projects for debugging
      console.log('🔍 TEMPORARY: Returning all projects for debugging');
      return list;

      const uid = String((user as any)?.id || '').toLowerCase();
      const uemail = String((user as any)?.email || '').toLowerCase();
      const uname = String((user as any)?.name || '').toLowerCase();

      console.log('🔍 User info for filtering:', { 
        uid, 
        uemail, 
        uname,
        userId: (user as any)?.id,
        userEmail: (user as any)?.email,
        userName: (user as any)?.name
      });
      

      const filtered = list.filter(project => {
        // Check if user is assigned to the project via team members
        const teamMembers = Array.isArray((project as any)?.teamMembers)
          ? (project as any).teamMembers
          : [];

        const inTeam = teamMembers.some((member: any) => {
          const mid = String(member?.id || '').toLowerCase();
          const memail = String(member?.email || '').toLowerCase();
          const mname = String(member?.name || '').toLowerCase();
          return (uid && mid === uid) || (uemail && memail === uemail) || (uname && mname === uname);
        });

        // Also check if user is the creator (for backward compatibility)
        const createdBy = String((project as any)?.createdBy || '').toLowerCase();
        const createdByMe = !!createdBy && (createdBy === uid || createdBy === uemail);

        const isIncluded = inTeam || createdByMe;

        console.log(`🔍 Project "${project.name}" filter result:`, {
          projectId: project.id,
          teamMembersCount: teamMembers.length,
          teamMembers: teamMembers.map((m: any) => ({ 
            id: (m as any).id, 
            email: (m as any).email, 
            name: (m as any).name 
          })),
          inTeam,
          createdBy,
          createdByMe,
          isIncluded
        });

        return isIncluded;
      });

      console.log('🔍 Filtered projects:', {
        originalCount: list.length,
        filteredCount: filtered.length,
        filteredNames: filtered.map(p => p.name),
        showMyProjectsOnly,
        hasUser: !!user
      });

      return filtered;
    },
    [showMyProjectsOnly, user]
  );

  const filteredActiveProjects = useMemo(
    () => filterProjectsByUser(qualActiveProjects),
    [filterProjectsByUser, qualActiveProjects]
  );

  const filteredArchivedProjects = useMemo(
    () => filterProjectsByUser(qualArchivedProjects),
    [filterProjectsByUser, qualArchivedProjects]
  );

  const displayProjects = projectTab === 'active' ? filteredActiveProjects : filteredArchivedProjects;

  // Use the filtered projects instead of the old qualProjects
  const qualProjects = displayProjects;

  const loadStorytellingData = async (projectId: string) => {
    try {
      // Use analysisId from selectedProject if available, otherwise use the prop
      const currentAnalysisId = selectedProject?.analysisId || analysisId;
      const url = currentAnalysisId 
        ? `${API_BASE_URL}/api/storytelling/${projectId}?analysisId=${currentAnalysisId}`
        : `${API_BASE_URL}/api/storytelling/${projectId}`;
      
      const response = await fetch(url, {
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        setStrategicQuestions(data.strategicQuestions || []);
        
        // Preserve respondentCount and strategicQuestions when loading existing keyFindings
        if (data.keyFindings) {
          const currentRespondentCount = projectMap[projectId]?.respondentCount ?? selectedProject?.respondentCount ?? 0;
          setKeyFindings({
            ...data.keyFindings,
            respondentCount: data.keyFindings.respondentCount || currentRespondentCount,
            strategicQuestions: data.keyFindings.strategicQuestions || data.strategicQuestions || []
          });
        } else {
          setKeyFindings(data.keyFindings);
        }
        
        // Preserve respondentCount and strategicQuestions when loading existing storyboards
        if (data.storyboards && data.storyboards.length > 0) {
          const currentRespondentCount = projectMap[projectId]?.respondentCount ?? selectedProject?.respondentCount ?? 0;
          const storyboardsWithCount = data.storyboards.map((sb: any) => ({
            ...sb,
            respondentCount: sb.respondentCount || currentRespondentCount,
            strategicQuestions: sb.strategicQuestions || data.strategicQuestions || []
          }));
          setStoryboards(storyboardsWithCount);
        } else {
          setStoryboards(data.storyboards || []);
        }
        
        // Load concise executive summary if available
        if (data.conciseExecutiveSummary) {
          setConciseExecutiveSummary(data.conciseExecutiveSummary);
        }
        
        // Load dynamic report if available
        if (data.dynamicReport) {
          setDynamicReport(data.dynamicReport);
        }
        
        // Ensure we only show the last 10 Q&A entries
        const chatHistory = data.chatHistory || [];
        setChatHistory(chatHistory.slice(-10));
      }
    } catch (error) {
    }
  };

  const generateReportData = () => {
    if (!dynamicReport || !selectedProject) return null;

    // Split executive_summary slides if they have too many findings
    const processedSlides: any[] = [];
    const MAX_FINDINGS_PER_SLIDE = 4; // Maximum findings that fit comfortably on one slide

    dynamicReport.slides.forEach((slide: any) => {
      if (slide.type === 'executive_summary' && slide.findings && slide.findings.length > MAX_FINDINGS_PER_SLIDE) {
        // Split into multiple slides
        const findingsChunks = [];
        for (let i = 0; i < slide.findings.length; i += MAX_FINDINGS_PER_SLIDE) {
          findingsChunks.push(slide.findings.slice(i, i + MAX_FINDINGS_PER_SLIDE));
        }

        // Create a slide for each chunk
        findingsChunks.forEach((chunk, index) => {
          processedSlides.push({
            ...slide,
            title: index === 0 ? slide.title : `${slide.title} (cont.)`,
            findings: chunk
          });
        });
      } else {
        // Keep slide as is
        processedSlides.push(slide);
      }
    });

    return {
      slides: processedSlides,
      generatedAt: dynamicReport.generatedAt,
      projectName: getProjectName(selectedProject),
      client: getClientName(selectedProject)
    };
  };

  // Navigation functions
  const goToNextSlide = () => {
    if (reportData && currentSlideIndex < reportData.slides.length - 1) {
      setCurrentSlideIndex(currentSlideIndex + 1);
    }
  };

  const goToPreviousSlide = () => {
    if (currentSlideIndex > 0) {
      setCurrentSlideIndex(currentSlideIndex - 1);
    }
  };

  const goToSlide = (index: number) => {
    if (reportData && index >= 0 && index < reportData.slides.length) {
      setCurrentSlideIndex(index);
    }
  };

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Load archived projects
  useEffect(() => {
    const loadArchivedProjects = async () => {
      if (!user?.id) return;
      try {
        const response = await fetch(`${API_BASE_URL}/api/projects/archived?userId=${user.id}`, {
          headers: getAuthHeaders()
        });
        if (response.ok) {
          const data = await response.json();
          const archivedProjectsArray = data.projects || [];
          
          // Load content analysis data for each archived project to get analysis counts
          const archivedProjectsWithAnalysisCounts = await Promise.all(
            archivedProjectsArray.map(async (project: any) => {
              try {
                const analysisResponse = await fetch(`${API_BASE_URL}/api/caX/saved`, {
                  headers: getAuthHeaders()
                });
              if (analysisResponse.ok) {
                const analysisData = await analysisResponse.json();
                // The API returns an array directly, not an object with analyses property
                const allAnalyses = Array.isArray(analysisData) ? analysisData : (analysisData.analyses || []);
                const projectAnalyses = allAnalyses.filter((analysis: any) => analysis.projectId === project.id);
                
                return {
                  ...project,
                  analysisCount: projectAnalyses.length
                };
              }
              } catch (error) {
                console.error(`Failed to load analysis data for archived project ${project.id}:`, error);
              }
              return {
                ...project,
                analysisCount: 0
              };
            })
          );
          
          setArchivedProjects(archivedProjectsWithAnalysisCounts);
        }
      } catch (error) {
        console.error('Failed to load archived projects:', error);
      }
    };
    loadArchivedProjects();
  }, [user?.id]);

  // Keyboard navigation for report view
  useEffect(() => {
    if (viewMode === 'report' && reportData) {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'ArrowLeft') {
          goToPreviousSlide();
        } else if (event.key === 'ArrowRight') {
          goToNextSlide();
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [viewMode, reportData, currentSlideIndex]);

  // Generate report data when switching to report view
  useEffect(() => {
    if (viewMode === 'report' && storyboards.length > 0 && !reportData) {
      // If we have dynamicReport data, use it directly
      if (dynamicReport && selectedProject) {
        const newReportData = {
          slides: dynamicReport.slides,
          generatedAt: dynamicReport.generatedAt,
          projectName: getProjectName(selectedProject),
          client: getClientName(selectedProject)
        };
        setReportData(newReportData);
        setCurrentSlideIndex(0);
      } else {
        // Fallback to generating from storyboard data
      setGeneratingReport(true);
      setCurrentSlideIndex(0); // Reset to first slide
      // Simulate a brief loading state for better UX
      setTimeout(() => {
        const data = generateReportData();
        setReportData(data);
        setGeneratingReport(false);
      }, 1000);
    }
    }
  }, [viewMode, storyboards.length]);

  // Handle new dynamicReport data when it becomes available
  useEffect(() => {
    if (dynamicReport && selectedProject && viewMode === 'report') {
      const newReportData = {
        slides: dynamicReport.slides,
        generatedAt: dynamicReport.generatedAt,
        projectName: getProjectName(selectedProject),
        client: getClientName(selectedProject)
      };
      setReportData(newReportData);
      setCurrentSlideIndex(0);
    }
  }, [dynamicReport, selectedProject, viewMode]);

  useEffect(() => {
    if (selectedProject) {
      loadStorytellingData(selectedProject.id);
    } else if (projectId && !forceListView) {
      // If we have a specific projectId, load that project directly
      const project = projects.find(p => p.id === projectId);
      if (project) {
        setSelectedProject(project);
    }
    }
  }, [selectedProject, projectId, projects]);

  // Clear no changes messages when switching projects or tabs
  useEffect(() => {
    setShowNoChangesMessage(false);
    setShowNoChangesMessageStoryboard(false);
  }, [selectedProject, activeTab]);

  const handleSaveQuestions = async () => {
    if (!selectedProject) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/storytelling/${selectedProject.id}/strategic-questions`, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ questions: tempQuestions, analysisId: selectedProject?.analysisId || analysisId })
      });

      if (response.ok) {
        setStrategicQuestions(tempQuestions);
        setEditingQuestions(false);
      } else {
        alert('Failed to save questions');
      }
    } catch (error) {
      alert('Failed to save questions');
    }
  };

  const estimateCost = async () => {
    if (!selectedProject) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/storytelling/${selectedProject.id}/estimate`, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ detailLevel, analysisId: selectedProject?.analysisId || analysisId })
      });

      if (response.ok) {
        const estimate = await response.json();
        setCostEstimate(estimate);
        // Proceed directly with the action instead of showing modal
        if (pendingAction === 'findings') confirmGenerateFindings();
        else if (pendingAction === 'storyboard') confirmGenerateStoryboard();
        else if (pendingAction === 'question') confirmAskQuestion();
      } else {
        const errorText = await response.text();
      }
    } catch (error) {
    }
  };

  const handleGenerateFindings = async () => {
    // Check if there are changes in respondent count
    const currentRespondentCount = selectedContentAnalysis ? 
      (() => {
        const allData = Object.values(selectedContentAnalysis.data || {}).flat();
        const uniqueRespondents = new Set(allData.map((item: any) => item.respno).filter(Boolean));
        return uniqueRespondents.size;
      })() : 
      (projectMap[selectedProject?.id || '']?.respondentCount ?? selectedProject?.respondentCount ?? 0);
    const lastRespondentCount = keyFindings?.respondentCount;
    
    // Check if strategic questions have changed
    const currentQuestions = strategicQuestions;
    const lastQuestions = keyFindings?.strategicQuestions || [];
    const questionsChanged = JSON.stringify(currentQuestions) !== JSON.stringify(lastQuestions);
    
    if (lastRespondentCount !== undefined && currentRespondentCount === lastRespondentCount && !questionsChanged) {
      setShowNoChangesMessage(true);
      return;
    }
    
    setPendingAction('findings');
    setDetailLevel('moderate'); // Use moderate detail for more concise content
    await estimateCost();
  };

  const confirmGenerateFindings = async () => {
    if (!selectedProject) return;

    setGeneratingFindings(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/storytelling/${selectedProject.id}/key-findings/generate`, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          detailLevel, 
          analysisId: selectedContentAnalysis?.id || selectedProject?.analysisId || analysisId,
          strategicQuestions: strategicQuestions
        })
      });

      if (response.ok) {
        const findings = await response.json();
        const currentRespondentCount = selectedContentAnalysis ? 
          (() => {
            const allData = Object.values(selectedContentAnalysis.data || {}).flat();
            const uniqueRespondents = new Set(allData.map((item: any) => item.respno).filter(Boolean));
            return uniqueRespondents.size;
          })() : 
          (projectMap[selectedProject.id]?.respondentCount ?? selectedProject.respondentCount ?? 0);
        setKeyFindings({
          ...findings,
          generatedAt: new Date().toISOString(),
          respondentCount: currentRespondentCount,
          strategicQuestions: strategicQuestions
        });
      } else {
        const error = await response.json();
        alert(`Failed to generate findings: ${error.error}`);
      }
    } catch (error) {
      alert('Failed to generate findings');
    } finally {
      setGeneratingFindings(false);
    }
  };

  const handleGenerateStoryboard = async () => {
    // Check if there are changes in respondent count
    const currentRespondentCount = selectedContentAnalysis ? 
      (() => {
        const allData = Object.values(selectedContentAnalysis.data || {}).flat();
        const uniqueRespondents = new Set(allData.map((item: any) => item.respno).filter(Boolean));
        return uniqueRespondents.size;
      })() : 
      (projectMap[selectedProject?.id || '']?.respondentCount ?? selectedProject?.respondentCount ?? 0);
    const lastRespondentCount = storyboards[0]?.respondentCount;
    
    // Check if strategic questions have changed
    const currentQuestions = strategicQuestions;
    const lastQuestions = storyboards[0]?.strategicQuestions || [];
    const questionsChanged = JSON.stringify(currentQuestions) !== JSON.stringify(lastQuestions);
    
    if (lastRespondentCount !== undefined && currentRespondentCount === lastRespondentCount && !questionsChanged) {
      setShowNoChangesMessageStoryboard(true);
      return;
    }
    
    setPendingAction('storyboard');
    await estimateCost();
  };

  const confirmGenerateStoryboard = async () => {
    if (!selectedProject) return;

    setGeneratingStoryboard(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/storytelling/${selectedProject.id}/storyboard/generate`, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          analysisId: selectedContentAnalysis?.id || selectedProject?.analysisId || analysisId,
          detailLevel: 'comprehensive'
        })
      });

      if (response.ok) {
        const newStoryboard = await response.json();

        // Add respondent count and strategic questions to storyboard
        newStoryboard.respondentCount = selectedContentAnalysis ?
          (() => {
            const allData = Object.values(selectedContentAnalysis.data || {}).flat();
            const uniqueRespondents = new Set(allData.map((item: any) => item.respno).filter(Boolean));
            return uniqueRespondents.size;
          })() :
          (projectMap[selectedProject.id]?.respondentCount ?? selectedProject?.respondentCount ?? 0);
        newStoryboard.strategicQuestions = strategicQuestions;

        // Add new storyboard to the beginning of the array
        setStoryboards(prev => [newStoryboard, ...prev]);

        // Switch to storyboard tab
        setActiveTab('storyboard');
      } else {
        const error = await response.json();
        alert(`Failed to generate storyboard: ${error.error || error.message}`);
      }
    } catch (error) {
      console.error('Error generating storyboard:', error);
      alert('Failed to generate storyboard');
    } finally {
      setGeneratingStoryboard(false);
    }
  };

  const handleGenerateReport = async () => {
    if (!selectedProject) return;

    setGeneratingReport(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/storytelling/${selectedProject.id}/dynamic-report/generate`, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          analysisId: selectedProject?.analysisId || analysisId
        })
      });

      if (response.ok) {
        const dynamicReport = await response.json();

        // Create the title slide with actual project data
        const titleSlide = {
          type: 'title',
          title: `${getProjectName(selectedProject) || 'Project Name'} - Report Outline`,
          subtitle: `Client: ${getClientName(selectedProject) || 'Client Name'}`,
          generated: `Generated: ${new Date().toLocaleDateString()}`
        };

        // Process all slides, replacing the AI-generated title slide with our actual project data
        const processedSlides = dynamicReport.slides?.map((slide: any, index: number) => {
          if (index === 0 && slide.type === 'title') {
            return titleSlide;
          }
          return slide;
        }) || [];

        const reportDataToSave = {
          slides: processedSlides,
          generatedAt: new Date().toISOString(),
          projectName: getProjectName(selectedProject),
          client: getClientName(selectedProject)
        };

        // Save to state
        setReportOutline(reportDataToSave);
        setCurrentSlideIndex(0);

        // Save report data to backend for persistence
        try {
          console.log('🔍 Saving report data to backend:', {
            projectId: selectedProject.id,
            analysisId: selectedContentAnalysis?.id || selectedProject?.analysisId || analysisId,
            slidesCount: processedSlides.length
          });

          const reportSaveResponse = await fetch(`${API_BASE_URL}/api/storytelling/${selectedProject.id}/report-data`, {
            method: 'POST',
            headers: {
              ...getAuthHeaders(),
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              reportData: reportDataToSave,
              analysisId: selectedContentAnalysis?.id || selectedProject?.analysisId || analysisId
            })
          });

          if (reportSaveResponse.ok) {
            console.log('✅ Report data saved successfully');
          } else {
            console.error('❌ Failed to save report data to API:', reportSaveResponse.status);
          }
        } catch (error) {
          console.error('❌ Error saving report data:', error);
        }

        // Switch to report tab
        setActiveTab('report');
      } else {
        const error = await response.json();
        alert(`Failed to generate report outline: ${error.error}`);
      }
    } catch (error) {
      alert('Failed to generate report outline');
    } finally {
      setGeneratingReport(false);
    }
  };

  const handleGenerateConciseExecutiveSummary = async () => {
    if (!selectedProject) return;

    setGeneratingFindings(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/storytelling/${selectedProject.id}/executive-summary/generate`, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          analysisId: selectedProject.analysisId
        })
      });

      if (response.ok) {
        const conciseSummary = await response.json();
        setConciseExecutiveSummary(conciseSummary);
        setActiveTab('storyboard');
      } else {
        const error = await response.json();
        alert(`Failed to generate concise executive summary: ${error.error}`);
      }
    } catch (error) {
      alert('Failed to generate concise executive summary');
    } finally {
      setGeneratingFindings(false);
    }
  };

  const handleAskQuestion = async () => {
    setPendingAction('question');
    await estimateCost();
  };

  const confirmAskQuestion = async () => {
    if (!selectedProject || !currentQuestion.trim()) return;

    setAskingQuestion(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/storytelling/${selectedProject.id}/ask`, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ question: currentQuestion, detailLevel, analysisId: selectedProject?.analysisId || analysisId })
      });

      if (response.ok) {
        await loadStorytellingData(selectedProject.id);
        setCurrentQuestion('');
      } else {
        const error = await response.json();
        alert(`Failed to answer question: ${error.error}`);
      }
    } catch (error) {
      alert('Failed to ask question');
    } finally {
      setAskingQuestion(false);
    }
  };

  const handleDownloadStoryboard = async (storyboard: Storyboard) => {
    if (!selectedProject) return;

    try {
      const analysisQuery = selectedProject?.analysisId || analysisId ? `?analysisId=${encodeURIComponent(selectedProject?.analysisId || (analysisId as string))}` : '';
      const urlWithAnalysis = `${API_BASE_URL}/api/storytelling/${selectedProject.id}/storyboard/${storyboard.id}/download${analysisQuery}`;
      const urlNoAnalysis = `${API_BASE_URL}/api/storytelling/${selectedProject.id}/storyboard/${storyboard.id}/download`;

      let response = await fetch(urlWithAnalysis, { headers: getAuthHeaders() });
      if (!response.ok) {
        response = await fetch(urlNoAnalysis, { headers: getAuthHeaders() });
      }

      if (response.ok) {
        const blob = await response.blob();
        // If server returned HTML error page as blob, treat as failure
        if ((response.headers.get('Content-Type') || '').includes('text/html')) {
          const text = await blob.text();
          alert(`Failed to download storyboard: ${text}`);
          return;
        }
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Storyboard_${new Date(storyboard.generatedAt).toLocaleDateString()}.docx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        // Attempt fallback: fetch server's storyboard list and find matching latest id
        try {
          const listRes = await fetch(`${API_BASE_URL}/api/storytelling/${selectedProject.id}/storyboards${analysisQuery}`, { headers: getAuthHeaders() });
          if (listRes.ok) {
            const listJson = await listRes.json();
            const serverBoards: any[] = Array.isArray(listJson?.storyboards) ? listJson.storyboards : Array.isArray(listJson) ? listJson : [];
            // Match by generatedAt timestamp (nearest) or take first
            let match = serverBoards.find(sb => sb.id === (storyboard as any).id);
            if (!match) {
              match = serverBoards.find(sb => new Date(sb.generatedAt).getTime() === new Date(storyboard.generatedAt).getTime());
            }
            if (!match && serverBoards.length > 0) {
              match = serverBoards[0];
            }
            if (match?.id) {
              const dl = await fetch(`${API_BASE_URL}/api/storytelling/${selectedProject.id}/storyboard/${match.id}/download${analysisQuery}`, { headers: getAuthHeaders() });
              if (dl.ok) {
                const blob = await dl.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `Storyboard_${new Date(match.generatedAt || storyboard.generatedAt).toLocaleDateString()}.docx`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
                return;
              }
            }
          }
        } catch {}

        const msg = await response.text().catch(() => '');
        alert(`Failed to download storyboard${msg ? `: ${msg}` : ''}`);
      }
    } catch (error) {
      alert('Failed to download storyboard');
    }
  };

  const handleAnswerClick = async (message: ChatMessage) => {
    setSelectedAnswer(message);
    setShowQuotesModal(true);
    setLoadingQuotes(true);
    setQuotesError(null);
    setQuotesCached(false);

    try {
      const quotesAnalysisId = selectedProject?.analysisId || analysisId;
      const response = await fetch(`${API_BASE_URL}/api/storytelling/${selectedProject?.id}/quotes`, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          question: message.question,
          answer: message.answer,
          analysisId: quotesAnalysisId
        })
      });

      if (response.ok) {
        const data = await response.json();
        setQuotes(data.quotes || []);
        setQuotesCached(data.cached || false);
      } else {
        const errorData = await response.json();
        setQuotesError(errorData.error || 'Failed to fetch quotes');
      }
    } catch (error) {
      setQuotesError('Network error while fetching quotes');
    } finally {
      setLoadingQuotes(false);
    }
  };

  const handleKeyFindingClick = async (finding: Finding) => {
    // Create a mock ChatMessage object for key findings
    const mockMessage: ChatMessage = {
      id: `KF-${Date.now()}`,
      question: finding.question,
      answer: finding.answer,
      timestamp: new Date().toISOString()
    };
    
    await handleAnswerClick(mockMessage);
  };

  // Project view - show list of content analyses (when no analysis is selected yet)
  if (selectedProject && viewMode === 'project' && !selectedContentAnalysis) {
    return (
      <main className="flex-1 overflow-y-auto" style={{ backgroundColor: BRAND_BG }}>
        <div className="flex-1 p-6 space-y-6 max-w-full overflow-hidden">
          <section className="flex items-center justify-between">
            <div>
              <button
                onClick={() => {
                  setSelectedProject(null);
                  setViewMode('home');
                }}
                className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition mb-2"
              >
                <ArrowLeftIcon className="h-4 w-4" />
                Back to Projects
              </button>
              <h2 className="text-2xl font-bold" style={{ color: BRAND_GRAY }}>
                {selectedProject.name} - Storytelling
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                {selectedProject.client && <span>{selectedProject.client} • </span>}
                Select a content analysis to view storyboards
              </p>
            </div>
          </section>

          {/* Content Analyses Table */}
          <div className="overflow-x-auto">
            {contentAnalyses.length === 0 ? (
              <div className="p-8 text-center">
                <IconBook2 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Content Analyses</h3>
                <p className="text-gray-600 mb-4">This project doesn't have any content analyses yet.</p>
                <button
                  onClick={() => {
                    const url = `${window.location.pathname}?route=Content%20Analysis`;
                    window.history.pushState({}, '', url);
                    window.location.reload();
                  }}
                  className="flex items-center gap-1 rounded-lg px-4 py-2 text-sm shadow-sm transition-colors text-white hover:opacity-90 mx-auto"
                  style={{ backgroundColor: BRAND_ORANGE }}
                >
                  <CloudArrowUpIcon className="h-4 w-4" />
                  Create First Analysis
                </button>
              </div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Analysis Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Created
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Respondents
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {contentAnalyses.map((analysis) => (
                    <tr 
                      key={analysis.id} 
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={async () => {
                        setSelectedContentAnalysis(analysis);
                        setViewMode('project');
                        // Load the full analysis data first
                        const fullAnalysis = await loadFullContentAnalysis(analysis.id);
                        if (fullAnalysis) {
                          // Then load project data with the analysis context
                          await loadProjectData(selectedProject.id);
                        }
                      }}
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{analysis.name || 'Untitled Analysis'}</div>
                        {analysis.description && (
                          <div className="text-sm text-gray-500 truncate max-w-xs">{analysis.description}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {analysis.createdAt ? new Date(analysis.createdAt).toLocaleDateString() : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <div className="flex items-center justify-center gap-1 text-sm text-gray-900">
                          <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                          </svg>
                          {analysis.data ? (() => {
                            const allData = Object.values(analysis.data).flat();
                            const uniqueRespondents = new Set(allData.map((item: any) => item.respno).filter(Boolean));
                            return uniqueRespondents.size;
                          })() : 0}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>
    );
  }

  // Project view with tabs (when a content analysis is selected)
  if (selectedProject && viewMode === 'project' && selectedContentAnalysis) {
    return (
      <main className="flex-1 overflow-y-auto" style={{ backgroundColor: BRAND_BG }}>
        <div className="flex-1 p-6 space-y-6 max-w-full overflow-hidden">
          <section className="flex items-center justify-between">
            <div>
              <button
                onClick={() => {
                  setSelectedContentAnalysis(null);
                }}
                className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition mb-2"
              >
                <ArrowLeftIcon className="h-4 w-4" />
                Back to Content Analyses
              </button>
              <h2 className="text-2xl font-bold" style={{ color: BRAND_GRAY }}>
                {selectedProject.name} - Storytelling
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                {selectedProject.client && <span>{selectedProject.client} • </span>}
                AI-powered research insights
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  // Deep link the specific analysis via custom event used by ContentAnalysisX
                  const analysis = selectedProject.analysisId;
                  if (!analysis) return;
                  // Set route
                  const url = `${window.location.pathname}?route=Content%20Analysis`;
                  window.history.pushState({}, '', url);
                  // Dispatch event to load analysis when CA mounts
                  setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('loadContentAnalysis', { detail: { analysisId: analysis } }));
                  }, 50);
                  // Force route change by reloading
                  window.location.reload();
                }}
                className="flex items-center justify-center h-8 w-8 rounded-full transition-colors"
                style={{ backgroundColor: 'rgba(37, 99, 235, 0.65)' }}
                title="Open Content Analysis"
              >
                <IconTable className="h-4 w-4 text-white" />
              </button>
            </div>
          </section>

          {/* Tabs */}
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8 justify-between items-center">
              <div className="flex space-x-8">
                {[
                  { id: 'key-findings', label: 'Key Findings', icon: SparklesIcon },
                  { id: 'storyboard', label: 'Storyboard', icon: DocumentTextIcon },
                  { id: 'report', label: 'Report Outline', icon: PresentationChartBarIcon },
                  { id: 'ask', label: 'Q&A', icon: ChatBubbleLeftRightIcon }
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${
                      activeTab === tab.id
                        ? 'text-white'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                    style={activeTab === tab.id ? { borderBottomColor: BRAND_ORANGE, color: BRAND_ORANGE } : {}}
                  >
                    <tab.icon className="h-4 w-4" />
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="text-sm text-gray-500">
                n={selectedContentAnalysis ? 
                  (() => {
                    const allData = Object.values(selectedContentAnalysis.data || {}).flat();
                    const uniqueRespondents = new Set(allData.map((item: any) => item.respno).filter(Boolean));
                    return uniqueRespondents.size;
                  })() : 
                  (projectMap[selectedProject.id]?.respondentCount ?? selectedProject.respondentCount ?? 0)
                }
              </div>
            </nav>
          </div>

          {/* Key Findings Tab */}
          {activeTab === 'key-findings' && (
            <div className="space-y-4">
              <div className="bg-white shadow-sm border border-gray-200 rounded-lg p-6">
                <div className="mb-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-gray-900">Strategic Questions</h3>
                    <button
                      onClick={() => {
                        setEditingQuestions(!editingQuestions);
                        setTempQuestions([...strategicQuestions]);
                      }}
                      className="text-gray-400 hover:text-gray-600 transition-colors"
                      title={editingQuestions ? "Cancel editing" : "Edit questions"}
                    >
                      {editingQuestions ? (
                        <span className="text-sm">Cancel</span>
                      ) : (
                        <PencilIcon className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {editingQuestions ? (
                  <div className="space-y-3">
                    {tempQuestions.map((q, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={q}
                          onChange={e => {
                            const updated = [...tempQuestions];
                            updated[idx] = e.target.value;
                            setTempQuestions(updated);
                          }}
                          className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm"
                        />
                        <button
                          onClick={() => setTempQuestions(tempQuestions.filter((_, i) => i !== idx))}
                          className="text-red-600 hover:text-red-800"
                        >
                          <TrashIcon className="h-5 w-5" />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => setTempQuestions([...tempQuestions, ''])}
                      className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
                    >
                      <PlusIcon className="h-4 w-4" />
                      Add Question
                    </button>
                    <button
                      onClick={handleSaveQuestions}
                      className="mt-4 px-4 py-2 rounded-lg text-white text-sm font-medium"
                      style={{ backgroundColor: BRAND_ORANGE }}
                    >
                      Save Questions
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {strategicQuestions.length === 0 ? (
                      <p className="text-sm text-gray-500">No strategic questions defined yet. Click "Edit Questions" to add some.</p>
                    ) : (
                      strategicQuestions.map((q, idx) => (
                        <p key={idx} className="text-sm text-gray-700">
                          {idx + 1}. {q}
                        </p>
                      ))
                    )}
                  </div>
                )}

                {strategicQuestions.length > 0 && (
                  <div className="mt-6 pt-4 border-t border-gray-200">
                    <button
                      onClick={handleGenerateFindings}
                      disabled={generatingFindings}
                      className="px-4 py-2 rounded-lg text-white text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                      style={{ backgroundColor: BRAND_ORANGE }}
                    >
                      {generatingFindings ? 'Generating...' : 'Generate Key Findings'}
                      <SparklesIcon className="h-4 w-4" />
                    </button>
                    {showNoChangesMessage && (
                      <p className="text-sm mt-2" style={{ color: BRAND_ORANGE }}>
                        No new respondents added or removed since last generation. Key findings are up to date.
                      </p>
                    )}
                  </div>
                )}
              </div>


              {keyFindings && keyFindings.findings && (
                <div className="space-y-4">
                  {keyFindings.generatedAt && (
                    <p className="text-xs text-gray-500">
                      Last updated: {formatDateTimeNoSeconds(keyFindings.generatedAt)} (n={keyFindings.respondentCount || 0})
                    </p>
                  )}
                  {keyFindings.findings.map((finding, idx) => (
                    <div key={idx} className="bg-white shadow-sm border border-gray-200 rounded-lg p-6">
                      <h4 className="font-semibold text-gray-900 mb-2">{idx + 1}. {finding.question}</h4>
                      <div 
                        className="text-sm text-gray-700 mb-3 cursor-pointer hover:bg-gray-50 p-2 rounded border-l-4 border-transparent hover:border-orange-300 transition-colors"
                        onClick={() => handleKeyFindingClick(finding)}
                        title="Click to view supporting quotes"
                      >
                        {finding.answer}
                      </div>
                      {finding.insight && (
                        <div className="mt-3 p-3 bg-orange-50 rounded">
                          <p className="text-sm font-medium" style={{ color: BRAND_ORANGE }}>
                            💡 Insight: {finding.insight}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Storyboard Tab */}
          {activeTab === 'storyboard' && (
            <div className="space-y-4">
              {storyboards.length > 0 ? (
                <div className="space-y-4">
                  {/* Current Storyboard Display */}
                  <div className="bg-white shadow-sm border border-gray-200 rounded-lg p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-xl font-semibold text-gray-900">{selectedProject?.name} - Storyboard</h4>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => handleDownloadStoryboard(storyboards[0])}
                          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
                        >
                          <ArrowDownTrayIcon className="h-4 w-4" />
                          Download Word
                        </button>
                      </div>
                    </div>
                    
                    {/* Generate Report Button and View Toggle */}
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <button
                          onClick={() => setShowGenerateOptionsModal(true)}
                          disabled={generatingStoryboard}
                          className="px-4 py-2 rounded-lg text-white text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                          style={{ backgroundColor: BRAND_ORANGE }}
                        >
                          {generatingStoryboard ? 'Generating...' : 'Generate Storyboard'}
                          <DocumentTextIcon className="h-4 w-4" />
                        </button>
                        {showNoChangesMessageStoryboard && (
                          <p className="text-sm mt-2" style={{ color: BRAND_ORANGE }}>
                            No new respondents have been added or removed since the last storyboard generation.
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Horizontal line separator */}
                    <div className="h-px bg-gray-200 -mx-6 mb-4" />

                    <p className="text-xs text-gray-500 mb-4">
                      Generated: {formatDateTimeNoSeconds(storyboards[0].generatedAt)} (n={storyboards[0].respondentCount || 0})
                    </p>

                    {/* Storyboard Content */}
                    {generatingStoryboard ? (
                        /* Loading state for storyboard generation */
                        <div className="flex flex-col items-center justify-center py-12">
                          <div className="flex items-center gap-3 mb-4">
                            <div className="animate-spin rounded-full h-8 w-8 border-4 border-gray-300" style={{ borderTopColor: BRAND_ORANGE }}></div>
                            <span className="text-lg font-medium text-gray-700">Generating storyboard...</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: BRAND_ORANGE, animationDelay: '0ms' }}></div>
                            <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: BRAND_ORANGE, animationDelay: '150ms' }}></div>
                            <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: BRAND_ORANGE, animationDelay: '300ms' }}></div>
                          </div>
                        </div>
                      ) : (
                        /* Storyboard sections in individual boxes */
                        <div className="space-y-4">
                          {storyboards[0].sections?.map((section, idx) => {
                          const bulletsForSection = extractBulletsFromMarkdown(section.content);
                          return (
                            <div key={idx} className="bg-gray-50 border border-gray-200 rounded-lg p-4 shadow-sm">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <h3 className="text-lg font-semibold text-gray-900 mb-2 truncate">{section.title}</h3>
                                  </div>
                                {bulletsForSection.length > 0 && (
                                  <button
                                    onClick={() => openDetailsForSection(section.title, section.content)}
                                    className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 whitespace-nowrap"
                                  >
                                    Learn more
                                  </button>
                                )}
                                </div>
                              {/* Under-title thin underline */}
                              <div className="h-px bg-gray-200 -mx-4 mb-3" />
                              <div className="prose prose-sm max-w-none">
                                {parseMarkdownContent(section.content)}
                              </div>
                          </div>
                          );
                        })}
                        </div>
                      )}

                  </div>

                  {/* Past Storyboards list removed (dropdown at top handles history) */}
                </div>
              ) : (
                <div className="bg-white shadow-sm border border-gray-200 rounded-lg p-6">
                  <div className="text-center py-12">
                    <DocumentTextIcon className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No Storyboard Generated</h3>
                    <p className="text-gray-600 mb-6">Generate a storyboard to get started with your project insights.</p>
                    <button
                      onClick={handleGenerateStoryboard}
                      disabled={generatingStoryboard}
                      className="px-6 py-3 rounded-lg text-white font-medium flex items-center gap-2 disabled:opacity-50 mx-auto"
                      style={{ backgroundColor: BRAND_ORANGE }}
                    >
                      {generatingStoryboard ? 'Generating...' : 'Generate Report'}
                      <DocumentTextIcon className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Report Outline Tab */}
          {activeTab === 'report' && (
            <div className="space-y-4">
              {reportOutline && reportOutline.slides && reportOutline.slides.length > 0 ? (
                <div className="space-y-4">
                  {/* Report Outline Display */}
                  <div className="bg-white shadow-sm border border-gray-200 rounded-lg p-6">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h4 className="text-xl font-semibold text-gray-900">{selectedProject?.name} - Report Outline</h4>
                        {reportOutline.generatedAt && (
                          <p className="text-sm text-gray-500 mt-1">
                            Generated: {new Date(reportOutline.generatedAt).toLocaleString()}
                          </p>
                        )}
                      </div>
                      <span className="text-sm text-gray-500">
                        {reportOutline.slides.length} slide{reportOutline.slides.length !== 1 ? 's' : ''}
                      </span>
                    </div>

                    {/* Generate Report Button */}
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <button
                          onClick={() => setShowGenerateOptionsModal(true)}
                          disabled={generatingReport}
                          className="px-4 py-2 rounded-lg text-white text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                          style={{ backgroundColor: BRAND_ORANGE }}
                        >
                          {generatingReport ? 'Generating...' : 'Generate Report'}
                          <PresentationChartBarIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {/* Horizontal line separator */}
                    <div className="h-px bg-gray-200 -mx-6 mb-4" />

                    {/* Slides Display - Slide Preview Navigation */}
                    <div className="flex gap-4 items-start">
                      {/* Slide Thumbnails/Preview List */}
                      <div className="flex-1 min-w-[200px] max-w-[400px] space-y-2 overflow-y-auto pr-2 h-[500px]">
                        {reportOutline.slides.map((slide: any, index: number) => (
                          <button
                            key={index}
                            onClick={() => setCurrentSlideIndex(index)}
                            className={`w-full text-left p-3 rounded-lg border-2 transition-all h-16 ${
                              currentSlideIndex === index
                                ? 'border-orange-500 bg-orange-50'
                                : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            <div className="flex flex-col justify-center h-full">
                              <p className={`text-xs font-medium line-clamp-1 leading-tight ${
                                currentSlideIndex === index ? 'text-gray-900' : 'text-gray-700'
                              }`}>
                                {slide.title || `Slide ${index + 1}`}
                              </p>
                              <p className={`text-xs font-normal mt-1 ${
                                currentSlideIndex === index ? 'text-orange-600' : 'text-gray-500'
                              }`}>
                                Slide {index + 1}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>

                      {/* Current Slide Display */}
                      <div className="flex-shrink-0 w-[800px] max-h-[800px] overflow-y-auto">
                        <ReportSlide
                          slide={reportOutline.slides[currentSlideIndex]}
                          slideNumber={currentSlideIndex + 1}
                          totalSlides={reportOutline.slides.length}
                          getIcon={(iconName: string) => {
                            const icons: Record<string, any> = {
                              SparklesIcon,
                              LightBulbIcon,
                              ChartBarIcon,
                              DocumentTextIcon,
                              UserGroupIcon,
                              ChatBubbleLeftRightIcon,
                              PresentationChartBarIcon,
                              CheckCircleIcon
                            };
                            return icons[iconName] || DocumentTextIcon;
                          }}
                          selectedProject={selectedProject}
                          projectMap={projectMap}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-white shadow-sm border border-gray-200 rounded-lg p-12 text-center">
                  <PresentationChartBarIcon className="h-16 w-16 mx-auto mb-4 text-gray-400" />
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">No Report Outline Yet</h3>
                  <p className="text-gray-600 mb-6">Generate a report outline to see the structure here.</p>
                  <button
                    onClick={() => setShowGenerateOptionsModal(true)}
                    disabled={generatingReport}
                    className="px-6 py-3 rounded-lg text-white font-medium flex items-center gap-2 disabled:opacity-50 mx-auto"
                    style={{ backgroundColor: BRAND_ORANGE }}
                  >
                    {generatingReport ? 'Generating...' : 'Generate Report Outline'}
                    <PresentationChartBarIcon className="h-5 w-5" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Ask Question Tab */}
          {activeTab === 'ask' && (
            <div className="space-y-4">
              <div className="bg-white shadow-sm border border-gray-200 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Ask a Question</h3>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={currentQuestion}
                    onChange={e => setCurrentQuestion(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !askingQuestion && handleAskQuestion()}
                    placeholder="Ask a question about your research..."
                    className="flex-1 border border-gray-300 rounded px-4 py-3 text-sm"
                    disabled={askingQuestion}
                  />
                  <button
                    onClick={handleAskQuestion}
                    disabled={askingQuestion || !currentQuestion.trim()}
                    className="px-6 py-3 rounded-lg text-white font-medium disabled:opacity-50"
                    style={{ backgroundColor: BRAND_ORANGE }}
                  >
                    {askingQuestion ? 'Asking...' : 'Ask'}
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {chatHistory.slice().reverse().map(msg => (
                  <div key={msg.id} className="bg-white shadow-sm border border-gray-200 rounded-lg p-6">
                    <p className="font-semibold text-gray-900 mb-2">Q: {msg.question}</p>
                    <div 
                      className="text-sm text-gray-700 mb-3 cursor-pointer hover:bg-gray-50 p-2 rounded border-l-4 border-transparent hover:border-orange-300 transition-colors"
                      onClick={() => handleAnswerClick(msg)}
                      title="Click to view supporting quotes"
                    >
                      A: {msg.answer}
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>{new Date(msg.timestamp).toLocaleString()}</span>
                      {msg.confidence && <span>Confidence: {msg.confidence}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>


        {/* Quotes Modal */}
        {showQuotesModal && selectedAnswer && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[99999] p-4" onClick={() => setShowQuotesModal(false)}>
            <div className="bg-white rounded-lg p-6 w-full max-w-4xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Supporting Quotes</h3>
                  <p className="text-sm text-gray-600 mt-1">Question: {selectedAnswer.question}</p>
                </div>
                <button
                  onClick={() => setShowQuotesModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-6 overflow-y-auto flex-1">
                {/* Answer Section */}
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-orange-900 mb-2">Answer</h4>
                  <p className="text-sm text-gray-800 leading-relaxed">{selectedAnswer.answer}</p>
                </div>

                {/* Quotes Section */}
                {loadingQuotes ? (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h4 className="text-sm font-semibold text-blue-900 mb-2">Loading Supporting Quotes...</h4>
                    <div className="flex items-center space-x-2">
                      <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                      <span className="text-sm text-gray-600">Searching transcripts for relevant quotes...</span>
                    </div>
                  </div>
                ) : quotesError ? (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <h4 className="text-sm font-semibold text-red-900 mb-2">Error Loading Quotes</h4>
                    <p className="text-sm text-red-700">{quotesError}</p>
                    <button 
                      onClick={() => selectedAnswer && handleAnswerClick(selectedAnswer)}
                      className="mt-2 text-xs text-red-600 hover:text-red-800 underline"
                    >
                      Try Again
                    </button>
                  </div>
                ) : quotes.length === 0 ? (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <h4 className="text-sm font-semibold text-yellow-900 mb-2">No Supporting Quotes Found</h4>
                    <p className="text-sm text-gray-600">
                      No relevant quotes were found in the transcripts for this answer.
                    </p>
                  </div>
                ) : (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold text-blue-900">Supporting Quotes</h4>
                      {quotesCached && (
                        <span className="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded">
                          Cached
                        </span>
                      )}
                    </div>
                    <div className="space-y-3">
                      {quotes.map((quote, index) => (
                        <div key={index} className="space-y-2">
                          <div className="bg-white border-l-4 border-blue-500 rounded p-3 text-sm text-gray-800">
                            {/* Quote text */}
                            {formatQuoteText(quote.text)}
                          </div>
                          {quote.context && (
                            <div className="text-xs text-gray-600 italic">
                              {quote.context}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Details Modal */}
        {showDetailsModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={() => setShowDetailsModal(false)}>
            <div className="w-full max-w-3xl rounded-xl bg-white shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-black">{detailsTitle} — Expanded Details</h3>
                  <p className="text-sm text-black mt-1">Additional context and supporting quotes for each point</p>
                </div>
                <button
                  onClick={() => setShowDetailsModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {detailsItems.length === 0 ? (
                <div className="py-6 text-sm text-gray-600">No bullet points detected to expand.</div>
              ) : (
                <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                  {detailsItems.map((item, i) => (
                    <div key={i} className="border border-gray-200 rounded-lg">
                      <button
                        onClick={() => expandBullet(i)}
                        disabled={item.expanded || detailsItems.some((otherItem, idx) => idx !== i && otherItem.loading)}
                        className="w-full p-4 text-left hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed [&:disabled]:opacity-100"
                      >
                        <p className="text-sm font-medium text-gray-900 [&:disabled]:text-gray-900">{item.bullet}</p>
                      </button>
                      
                      {item.expanded && (
                        <div className="px-4 pb-4 border-t border-gray-200 bg-white">
                          <div className="mt-3">
                            {item.loading ? (
                              <div className="py-8 text-center">
                                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-gray-200" style={{ borderTopColor: BRAND_ORANGE }}></div>
                                <div className="mt-2 text-sm text-gray-600">Loading details...</div>
                              </div>
                            ) : (
                              <>
                                {item.details && (
                                  <p className="text-sm text-gray-700 mb-3">{item.details}</p>
                                )}
                              
                              {Array.isArray(item.quotes) && item.quotes.length > 0 && (
                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                  <h4 className="text-sm font-semibold text-blue-900 mb-3">Supporting Quotes</h4>
                                  <div className="space-y-3">
                                    {item.quotes.map((q, qi) => (
                                      <div key={qi} className="space-y-2">
                                        <div className="bg-white border-l-4 border-blue-500 rounded p-3 text-sm text-gray-800">
                                          {formatQuoteText(q.text)}
                                        </div>
                                        {q.context && (
                                          <div className="text-xs text-gray-600 italic">
                                            {q.context}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Generate Options Modal */}
        {showGenerateOptionsModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={() => !isGenerating && setShowGenerateOptionsModal(false)}>
            <div className="w-full max-w-md rounded-xl bg-white shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
              {isGenerating ? (
                <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
                  <div
                    className="h-12 w-12 animate-spin rounded-full border-4 border-gray-200"
                    style={{ borderTopColor: BRAND_ORANGE }}
                  ></div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">
                      {activeTab === 'report' ? 'Generating Report' : 'Generating Storyboard'}
                    </h3>
                    <div className="flex items-center justify-center space-x-2 mt-4">
                      <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: BRAND_ORANGE }}></div>
                      <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: BRAND_ORANGE, animationDelay: '0.1s' }}></div>
                      <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: BRAND_ORANGE, animationDelay: '0.2s' }}></div>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-black">
                        {activeTab === 'report' ? 'Generate Report' : 'Generate Storyboard'}
                      </h3>
                      <p className="text-sm text-gray-600 mt-1">Confirm generation and review estimated cost</p>
                    </div>
                    <button
                      onClick={() => setShowGenerateOptionsModal(false)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {/* Storyboard/Report Info */}
                  <div className="mb-4 p-4 border-2 rounded-lg bg-orange-50 border-orange-200">
                    <div className="flex items-start gap-3">
                      <ViewColumnsIcon className="h-6 w-6 flex-shrink-0 mt-0.5 text-orange-600" />
                      <div className="flex-1">
                        <h4 className="text-sm font-semibold text-gray-900 mb-1">
                          {activeTab === 'report' ? 'Report Generation' : 'Storyboard Generation'}
                        </h4>
                        <p className="text-xs text-gray-600 mb-3">
                          {activeTab === 'report'
                            ? 'Create a comprehensive market research report presentation with slides, key findings, and supporting quotes from your research data.'
                            : 'Create a new text-based storyboard with sections and content based on your research data.'}
                        </p>
                        {estimatingCost ? (
                          <p className="text-xs text-gray-500 italic">Estimating cost...</p>
                        ) : storyboardCostEstimate ? (
                          <div className="space-y-1">
                            <p className="text-sm font-bold" style={{ color: BRAND_ORANGE }}>
                              Estimated Cost: ${storyboardCostEstimate.cost?.toFixed(2) || '0.00'}
                            </p>
                            {storyboardCostEstimate.inputTokens && (
                              <p className="text-xs text-gray-600">
                                Total Tokens: {(storyboardCostEstimate.inputTokens + storyboardCostEstimate.outputTokens).toLocaleString()}
                              </p>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

              {/* No Changes Warning */}
              {showNoChangesWarning && (
                <div className="mt-4 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                  <div className="flex items-start gap-2">
                    <svg className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-yellow-800">No changes detected</p>
                      <p className="text-xs text-yellow-700 mt-1">
                        The respondent count and strategic questions haven't changed since the last generation. Click Generate again to proceed anyway.
                      </p>
                    </div>
                  </div>
                </div>
              )}

                  <div className="mt-4 pt-4 border-t border-gray-200 flex gap-2">
                    <button
                      onClick={() => setShowGenerateOptionsModal(false)}
                      className="flex-1 px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors border border-gray-300 rounded-lg"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        // Check if there are changes in respondent count or strategic questions
                        const currentRespondentCount = selectedContentAnalysis ?
                          (() => {
                            const allData = Object.values(selectedContentAnalysis.data || {}).flat();
                            const uniqueRespondents = new Set(allData.map((item: any) => item.respno).filter(Boolean));
                            return uniqueRespondents.size;
                          })() :
                          (projectMap[selectedProject?.id || '']?.respondentCount ?? selectedProject?.respondentCount ?? 0);
                        const lastRespondentCount = storyboards[0]?.respondentCount;

                        const currentQuestions = strategicQuestions;
                        const lastQuestions = storyboards[0]?.strategicQuestions || [];
                        const questionsChanged = JSON.stringify(currentQuestions) !== JSON.stringify(lastQuestions);

                        // If no changes and warning not shown yet, show warning
                        if (lastRespondentCount !== undefined && currentRespondentCount === lastRespondentCount && !questionsChanged && !showNoChangesWarning) {
                          setShowNoChangesWarning(true);
                          setGenerateButtonDisabledTime(Date.now() + 3000);
                          setTimeout(() => {
                            setGenerateButtonDisabledTime(0);
                          }, 3000);
                          return;
                        }

                        // Proceed with generation
                        setIsGenerating(true);
                        // Small delay to show the loading state
                        setTimeout(async () => {
                          if (activeTab === 'report') {
                            await handleGenerateReport();
                          } else {
                            await confirmGenerateStoryboard();
                          }
                          setIsGenerating(false);
                          setShowGenerateOptionsModal(false);
                        }, 100);
                      }}
                      disabled={generateButtonDisabledTime > 0 && Date.now() < generateButtonDisabledTime}
                      className="flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ backgroundColor: BRAND_ORANGE }}
                    >
                      {activeTab === 'report' ? 'Generate Report' : 'Generate Storyboard'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto" style={{ backgroundColor: BRAND_BG }}>
      <div className="flex-1 p-6 space-y-6 max-w-full overflow-hidden">
        <section className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold" style={{ color: BRAND_GRAY }}>
              Storytelling
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              AI-powered insights from qualitative research
            </p>
          </div>
          {viewMode === 'home' && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Current View:</span>
              <button
                onClick={() => setShowMyProjectsOnly(!showMyProjectsOnly)}
                className={`px-3 py-1 text-xs rounded-lg shadow-sm transition-colors ${
                  showMyProjectsOnly
                    ? 'text-white hover:opacity-90'
                    : 'bg-white border border-gray-300 hover:bg-gray-50'
                }`}
                style={showMyProjectsOnly ? { backgroundColor: BRAND_ORANGE } : {}}
              >
                {showMyProjectsOnly ? 'Only My Projects' : 'All Cognitive Projects'}
              </button>
            </div>
          )}
        </section>

        {/* Tabs - only show on home view */}
        {viewMode === 'home' && (
          <div>
            <div className="flex items-center justify-between">
              <nav className="-mb-px flex space-x-8 items-center">
                <button
                  onClick={() => setProjectTab('active')}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    projectTab === 'active'
                      ? 'text-white'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                  style={projectTab === 'active' ? { borderBottomColor: BRAND_ORANGE, color: BRAND_ORANGE } : {}}
                >
                  Active Projects ({filteredActiveProjects.length})
                </button>
                <button
                  onClick={() => setProjectTab('archived')}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    projectTab === 'archived'
                      ? 'text-white'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                  style={projectTab === 'archived' ? { borderBottomColor: BRAND_ORANGE, color: BRAND_ORANGE } : {}}
                >
                  Archived Projects ({filteredArchivedProjects.length})
                </button>
              </nav>
            </div>
            <div className="border-b border-gray-200"></div>
          </div>
        )}

        {/* Home View - Project List */}
        {viewMode === 'home' && (
        <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
          {loading ? (
            <div className="p-12 text-center">
                  <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-gray-200" style={{ borderTopColor: BRAND_ORANGE }}></div>
              <p className="text-sm text-gray-500">Loading projects...</p>
            </div>
          ) : qualProjects.length === 0 ? (
            <div className="p-12 text-center">
              <DocumentTextIcon className="mx-auto mb-4 h-16 w-16 text-gray-300" />
                  <h3 className="text-lg font-semibold text-gray-900">
                    {projectTab === 'archived'
                      ? 'No archived qualitative projects'
                      : 'No active qualitative projects'}
                  </h3>
              <p className="mt-2 text-gray-500">
                    {projectTab === 'archived'
                      ? 'Archived qualitative projects will appear here.'
                      : 'Create a qualitative project to start using storytelling features.'}
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
                      <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                        Methodology
                      </th>
                      <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                        Content Analyses
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {qualProjects.map(project => (
                    <tr
                      key={project.id}
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                        onClick={async () => {
                        setSelectedProject(project);
                          setViewMode('project');
                          // Load content analyses for this project
                          await loadContentAnalysesForProject(project.id);
                      }}
                    >
                        <td className="pl-6 pr-2 py-4 whitespace-nowrap w-0">
                          <div className="inline-block text-sm font-medium text-gray-900">{project.name}</div>
                      </td>
                        <td className="pl-2 pr-6 py-4 whitespace-nowrap w-32">
                          <div className="text-sm text-gray-900 truncate">{project.client || '-'}</div>
                      </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center w-24">
                          <div className="text-sm text-gray-900">{project.methodologyType || '-'}</div>
                      </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center w-32">
                          <div className="flex items-center justify-center gap-1 text-sm text-gray-900">
                            <IconBook2 className="h-4 w-4 text-gray-400" />
                            {project.analysisCount || 0}
                            {/* Debug: {JSON.stringify(project.analysisCount)} */}
                          </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
          )}
        </div>
          </div>
        )}

      </div>
    </main>
  );
}
