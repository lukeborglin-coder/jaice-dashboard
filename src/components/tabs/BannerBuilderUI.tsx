import React, { useState } from 'react';
import { BannerGroup } from '../../types/dataTabulation';
import { Variable } from '../../utils/tabs/types';
import { TrashIcon, ArrowDownTrayIcon, ArrowUpTrayIcon, InformationCircleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { IconTable } from '@tabler/icons-react';
import ExcelJS from 'exceljs';

const BRAND_ORANGE = '#D14A2D';

interface BannerBuilderUIProps {
  bannerGroups: BannerGroup[];
  onEdit: (group: BannerGroup) => void;
  onDelete: (groupId: string) => void;
  onExport?: (groupId: string) => Promise<void>;
  exportingBannerId?: string | null;
  variables?: Variable[];
  bannerSpecsFileInputRef?: React.RefObject<HTMLInputElement>;
  onBannerSpecsFileChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onHandleClickImportBannerSpecs?: () => void;
}

export const BannerBuilderUI: React.FC<BannerBuilderUIProps> = ({
  bannerGroups,
  onEdit,
  onDelete,
  onExport,
  exportingBannerId,
  variables = [],
  bannerSpecsFileInputRef,
  onBannerSpecsFileChange,
  onHandleClickImportBannerSpecs,
}) => {
  const [showFormatInfo, setShowFormatInfo] = useState(false);

  const handleDownloadTemplate = async () => {
    // Create workbook and worksheet
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Banner Specs Template');

    // Set column widths
    worksheet.columns = [
      { width: 35 }, // Banner Heading
      { width: 30 }, // Banner Point
      { width: 35 }, // Banner Definition
    ];

    // Define border style
    const borderStyle = {
      top: { style: 'thin' as const },
      left: { style: 'thin' as const },
      bottom: { style: 'thin' as const },
      right: { style: 'thin' as const }
    };

    // Add header row with styling
    const headerRow = worksheet.addRow([
      'BANNER HEADING (E.G. GENDER)',
      'BANNER POINT (E.G. MALE)',
      'BANNER DEFINITION'
    ]);

    // Style header row
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD14A2D' } // Brand orange
      };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      cell.border = borderStyle;
    });

    // Add example data rows
    const exampleData = [
      ['Total', '', ''],
      ['Gender', 'Male', 'S4=1'],
      ['', 'Female', 'S4=2'],
      ['Age Group', '18-34', 'S3=18-34'],
      ['', '35-54', 'S3=35-54'],
      ['', '55+', 'S3=55-99'],
    ];

    exampleData.forEach((rowData) => {
      const row = worksheet.addRow(rowData);
      // Apply borders to all 3 columns explicitly (eachCell skips empty cells)
      for (let col = 1; col <= 3; col++) {
        row.getCell(col).border = borderStyle;
      }
    });

    // Add empty rows with borders to reach stat letter Z (26 rows total including header)
    // We have header + 6 example rows = 7 rows, need 19 more to reach 26
    for (let i = 0; i < 19; i++) {
      const row = worksheet.addRow(['', '', '']);
      // Apply borders to all 3 columns explicitly
      for (let col = 1; col <= 3; col++) {
        row.getCell(col).border = borderStyle;
      }
    }

    // Generate buffer and trigger download
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'banner-specs-template.xlsx';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col flex-1 py-6 pr-6">
      {/* Hidden file input for Excel import */}
      {bannerSpecsFileInputRef && onBannerSpecsFileChange && (
        <input
          type="file"
          ref={bannerSpecsFileInputRef}
          onChange={onBannerSpecsFileChange}
          accept=".xlsx,.xls"
          className="hidden"
        />
      )}

      {/* Header with Title and Import Button */}
      <div className="mb-6 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Banner Groups</h3>
        {onHandleClickImportBannerSpecs && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onHandleClickImportBannerSpecs}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 text-xs font-medium transition-colors"
              title="Import banner specifications from Excel file"
            >
              <ArrowUpTrayIcon className="h-3.5 w-3.5" />
              Import Banner Specs
            </button>
            <button
              type="button"
              onClick={() => setShowFormatInfo(true)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title="View format example"
            >
              <InformationCircleIcon className="h-5 w-5" />
            </button>
          </div>
        )}
      </div>

      {/* Format Info Popup */}
      {showFormatInfo && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowFormatInfo(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Banner Specs Excel Format</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void handleDownloadTemplate()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-white hover:opacity-90 text-xs font-medium transition-opacity"
                  style={{ backgroundColor: BRAND_ORANGE }}
                  title="Download Excel template"
                >
                  <ArrowDownTrayIcon className="h-3.5 w-3.5" />
                  Download Template
                </button>
                <button
                  onClick={() => setShowFormatInfo(false)}
                  className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Your Excel file should have three columns with the following headers:
              </p>
              <div className="overflow-x-auto">
                <table className="min-w-full border border-gray-300">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="px-4 py-2 border-r border-gray-300 text-left text-xs font-semibold text-gray-700">
                        Banner Heading (e.g. Gender)
                      </th>
                      <th className="px-4 py-2 border-r border-gray-300 text-left text-xs font-semibold text-gray-700">
                        Banner Point (e.g. Male)
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">
                        Banner Definition
                      </th>
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    <tr className="border-t border-gray-300 bg-blue-50">
                      <td className="px-4 py-2 border-r border-gray-300 text-gray-900 font-semibold">Total</td>
                      <td className="px-4 py-2 border-r border-gray-300 text-gray-400 italic">(leave blank)</td>
                      <td className="px-4 py-2 text-gray-400 italic">(leave blank)</td>
                    </tr>
                    <tr className="border-t border-gray-300">
                      <td className="px-4 py-2 border-r border-gray-300 text-gray-900">Gender</td>
                      <td className="px-4 py-2 border-r border-gray-300 text-gray-900">Male</td>
                      <td className="px-4 py-2 text-gray-700 font-mono text-xs">S4=1</td>
                    </tr>
                    <tr className="border-t border-gray-300 bg-gray-50">
                      <td className="px-4 py-2 border-r border-gray-300 text-gray-400 italic">(leave blank)</td>
                      <td className="px-4 py-2 border-r border-gray-300 text-gray-900">Female</td>
                      <td className="px-4 py-2 text-gray-700 font-mono text-xs">S4=2</td>
                    </tr>
                    <tr className="border-t border-gray-300">
                      <td className="px-4 py-2 border-r border-gray-300 text-gray-900">Age Group</td>
                      <td className="px-4 py-2 border-r border-gray-300 text-gray-900">18-34</td>
                      <td className="px-4 py-2 text-gray-700 font-mono text-xs">S3=18-34</td>
                    </tr>
                    <tr className="border-t border-gray-300 bg-gray-50">
                      <td className="px-4 py-2 border-r border-gray-300 text-gray-400 italic">(leave blank)</td>
                      <td className="px-4 py-2 border-r border-gray-300 text-gray-900">35-54</td>
                      <td className="px-4 py-2 text-gray-700 font-mono text-xs">S3=35-54</td>
                    </tr>
                    <tr className="border-t border-gray-300">
                      <td className="px-4 py-2 border-r border-gray-300 text-gray-400 italic">(leave blank)</td>
                      <td className="px-4 py-2 border-r border-gray-300 text-gray-900">55+</td>
                      <td className="px-4 py-2 text-gray-700 font-mono text-xs">S3=55-99</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="text-sm text-gray-600 space-y-2">
                <p><strong>Tips:</strong></p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>Leave the "Banner Heading" cell blank to continue the previous heading</li>
                  <li>Add a row with "Total" in the heading column to include a Total column in your banner</li>
                  <li>Banner Definition syntax: <code className="bg-gray-100 px-1 py-0.5 rounded text-xs font-mono">VariableName=Code</code> or <code className="bg-gray-100 px-1 py-0.5 rounded text-xs font-mono">VariableName=Code1-Code3</code> for ranges</li>
                  <li>The system will auto-configure definitions if left blank (recommended for AI assistance)</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
      {bannerGroups.length === 0 ? (
        <div className="text-center py-12">
          <IconTable className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Banner Groups</h3>
          <p className="text-gray-600 mb-4">Create banner groups to organize your cross-tabulations</p>
          <p className="text-sm text-gray-500">Click "Create Banner Group" button above to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 pl-0">
          {bannerGroups.map((group) => {
            // Build "Subgroup (Cut1, Cut2), Other Group (CutA, CutB)" style subtitle
            const subgroupSummaries: string[] = Array.isArray(group.groups)
              ? group.groups.map((sub: any) => {
                  const titles = Array.isArray(sub.cuts)
                    ? sub.cuts
                        .map((c: any) => String(c.title || '').trim())
                        .filter(Boolean)
                    : [];
                  const uniqueTitles = Array.from(new Set(titles));
                  const cutsText = uniqueTitles.join(', ');
                  const groupTitle = String(sub.title || '').trim();
                  if (groupTitle && cutsText) {
                    return `${groupTitle} (${cutsText})`;
                  }
                  if (groupTitle) return groupTitle;
                  return cutsText;
                }).filter((s: string) => !!s && s !== '()')
              : [];
            const cutsSubtitle = subgroupSummaries.join(', ');
            return (
              <div
                key={group.id}
                className="flex items-center justify-between border border-gray-200 rounded-lg px-4 py-3 hover:border-gray-300 hover:bg-gray-50 transition-colors"
                onClick={() => onEdit(group)}
                role="button"
              >
                <div className="min-w-0 pr-3">
                  <div className="text-sm font-medium text-gray-900 truncate">{group.title}</div>
                  {cutsSubtitle && (
                    <div className="text-xs italic text-gray-600 mt-0.5 truncate">{cutsSubtitle}</div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {onExport && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void onExport(group.id);
                      }}
                      className={`p-2 rounded-lg transition-colors ${exportingBannerId === group.id ? 'text-gray-400 cursor-wait' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}
                      title={exportingBannerId === group.id ? 'Exporting...' : 'Download tables for this banner'}
                      disabled={exportingBannerId === group.id}
                    >
                      {exportingBannerId === group.id ? (
                        <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-200" style={{ borderTopColor: BRAND_ORANGE }} />
                      ) : (
                        <ArrowDownTrayIcon className="h-5 w-5" />
                      )}
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm('Are you sure you want to delete this banner group?')) {
                        onDelete(group.id);
                      }
                    }}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete banner group"
                  >
                    <TrashIcon className="h-5 w-5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
