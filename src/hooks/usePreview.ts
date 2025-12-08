import { useState, useCallback, useEffect, useRef } from 'react';
import { Variable, PreviewTableSection, TableDebugEntry } from '../utils/tabs/types';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';

interface UsePreviewProps {
  buildTabSpecsWorkbook?: (variablesSubset: Variable[], bannerGroupOverride?: any) => Promise<{ workbook: ExcelJS.Workbook; sampleSize: number; debugInfo: Record<string, TableDebugEntry> }>;
  getTablesForVariable?: (variable: Variable) => string[];
  netSummaryTableSelectedCodes?: Record<string, Array<{ name: string; codes: string[] }>>;
}

export const usePreview = (props?: UsePreviewProps) => {
  const { buildTabSpecsWorkbook, getTablesForVariable, netSummaryTableSelectedCodes = {} } = props || {};
  
  const [previewVariable, setPreviewVariable] = useState<Variable | null>(null);
  const [previewSectionsHtml, setPreviewSectionsHtml] = useState<PreviewTableSection[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewDebugInfo, setPreviewDebugInfo] = useState<Record<string, TableDebugEntry>>({});
  const [variableRenderedTableCounts, setVariableRenderedTableCounts] = useState<Record<string, number>>({});

  const generatePreview = useCallback(async () => {
    if (!previewVariable || !buildTabSpecsWorkbook || !getTablesForVariable) {
      setPreviewSectionsHtml([]);
      setPreviewError(null);
      setPreviewLoading(false);
      setPreviewDebugInfo({});
      return;
    }

    let isCancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);

    try {
      const expectedTables = getTablesForVariable(previewVariable);
      const { workbook, debugInfo } = await buildTabSpecsWorkbook([previewVariable]);
      
      const buffer = await workbook.xlsx.writeBuffer();
      const parsedWorkbook = XLSX.read(buffer, { type: 'array' });
      const dataCutsSheet = parsedWorkbook.Sheets['Data Cuts'];
      if (!dataCutsSheet) {
        if (!isCancelled) {
          setPreviewError('Unable to locate the Data Cuts sheet in the workbook.');
          setPreviewSectionsHtml([]);
          if (previewVariable) {
            setVariableRenderedTableCounts(prev => ({
              ...prev,
              [previewVariable.name]: 0
            }));
          }
        }
        return;
      }
      
      // Check for table title patterns
      const tableTitleCells = Object.keys(dataCutsSheet).filter(key => {
        if (key.startsWith('!')) return false;
        const match = key.match(/^B(\d+)$/);
        if (!match) return false;
        const cell = dataCutsSheet[key];
        return cell && cell.v && String(cell.v).startsWith('Table ');
      });
      
      const rawHtml = XLSX.utils.sheet_to_html(dataCutsSheet, { header: '', footer: '' });
      const parser = new DOMParser();
      const doc = parser.parseFromString(rawHtml, 'text/html');
      const tableElement = doc.querySelector('table');
      if (!tableElement) {
        if (!isCancelled) {
          setPreviewError('Unable to parse the preview table.');
          setPreviewSectionsHtml([]);
          if (previewVariable) {
            setVariableRenderedTableCounts(prev => ({
              ...prev,
              [previewVariable.name]: 0
            }));
          }
        }
        return;
      }
      
      const tableRows = tableElement.querySelectorAll('tr');
      const colgroupEl = tableElement.querySelector('colgroup');
      if (colgroupEl) {
        colgroupEl.querySelectorAll('col').forEach(col => {
          (col as HTMLTableColElement).style.width = `${100 / colgroupEl.children.length}%`;
        });
      }
      const colgroupHtml = colgroupEl?.outerHTML || '';
      const sections: PreviewTableSection[] = [];
      let currentSection: { title: string; question: string; base: string; rows: HTMLTableRowElement[] } | null = null;
      const rows = Array.from(tableElement.querySelectorAll('tr'));
      
      const setTableLayoutFixed = () => {
        const tables = doc.querySelectorAll('table');
        tables.forEach((tbl) => {
          (tbl as HTMLTableElement).style.tableLayout = 'fixed';
          const columns = tbl.querySelectorAll('col');
          if (columns.length > 1) {
            const colWidth = `${100 / columns.length}%`;
            columns.forEach((col) => {
              (col as HTMLTableColElement).style.width = colWidth;
            });
          }
        });
      };
      
      const mergeLabelCells = (rows: HTMLTableRowElement[]) => {
        if (!rows || rows.length === 0) return;
        for (let i = 0; i < rows.length - 1; i++) {
          const firstRow = rows[i];
          const nextRow = rows[i + 1];
          if (!firstRow || !nextRow) continue;
          const firstCell = firstRow.querySelector('td:first-child');
          const nextCell = nextRow.querySelector('td:first-child');
          if (!firstCell || !nextCell) continue;
          const firstText = firstCell.textContent?.trim() || '';
          const nextText = nextCell.textContent?.trim() || '';
          if (!firstText || !nextText || firstText !== nextText) continue;
          const currentRowspan = parseInt(firstCell.getAttribute('rowspan') || '1', 10);
          firstCell.setAttribute('rowspan', String(currentRowspan + 1));
          firstCell.style.verticalAlign = 'middle';
          nextRow.removeChild(nextCell);
          rows.splice(i + 1, 1);
          i--;
        }
      };

      rows.forEach(row => {
        const cells = row.querySelectorAll('td, th');
        const cellTexts = Array.from(cells).map(cell => {
          const cellText = cell.textContent?.trim() || '';
          const cellValue = (cell as HTMLElement).getAttribute('data-value') || cellText;
          return cellValue || cellText;
        }).filter(t => t);
        const text = cellTexts.join(' ') || row.textContent?.trim() || '';
        
        const hasCellsWithContent = cells.length > 0 && Array.from(cells).some(cell => {
          const cellText = cell.textContent?.trim() || '';
          const cellValue = (cell as HTMLElement).getAttribute('data-value');
          const innerHTML = cell.innerHTML?.trim() || '';
          return cellText || cellValue || innerHTML;
        });
        
        if (!text && !hasCellsWithContent) return;
        
        if (text.startsWith('Table ') || cellTexts.some(t => t.startsWith('Table '))) {
          const tableTitleText = text.startsWith('Table ') ? text : cellTexts.find(t => t.startsWith('Table ')) || text;
          if (currentSection) {
            if (currentSection.rows.length > 0) {
              mergeLabelCells(currentSection.rows);
              sections.push({
                title: currentSection.title,
                question: currentSection.question,
                base: currentSection.base,
                tableHtml: `<table>${colgroupHtml}${currentSection.rows.map(row => row.outerHTML).join('')}</table>`
              });
            } else if (currentSection.title) {
              sections.push({
                title: currentSection.title,
                question: currentSection.question,
                base: currentSection.base,
                tableHtml: ''
              });
            }
          }
          currentSection = { title: tableTitleText, question: '', base: '', rows: [] };
        } else if (currentSection && !currentSection.question) {
          if (text) {
            currentSection.question = text;
          } else if (cellTexts.length > 0) {
            currentSection.question = cellTexts[0];
          }
        } else if (currentSection && text.toLowerCase().startsWith('base')) {
          currentSection.base = text;
          const clone = row.cloneNode(true) as HTMLTableRowElement;
          clone.classList.add('preview-base-row');
          currentSection.rows.push(clone);
        } else if (currentSection) {
          if (cells.length === 0) return;
          const clone = row.cloneNode(true) as HTMLTableRowElement;
          const rowIndex = currentSection.rows.length;
          if (rowIndex <= 2) {
            clone.classList.add('preview-header-row');
          }
          const lowerText = text.toLowerCase();
          if (lowerText.startsWith('base') || lowerText.includes('base (total responding')) {
            clone.classList.add('preview-base-row');
          } else if (lowerText.startsWith('mean') || lowerText.includes('sum') || lowerText.includes('mode') || lowerText.includes('median') || lowerText.includes('std') || lowerText.includes('max') || lowerText.includes('min') || lowerText.includes('outlier') || lowerText.includes('t2b') || lowerText.includes('b2b') || lowerText.includes('m3b')) {
            clone.classList.add('preview-stat-row');
          }
          currentSection.rows.push(clone);
        }
      });

      if (currentSection) {
        if (currentSection.rows.length > 0) {
          mergeLabelCells(currentSection.rows);
          sections.push({
            title: currentSection.title,
            question: currentSection.question,
            base: currentSection.base,
            tableHtml: `<table>${colgroupHtml}${currentSection.rows.map(row => row.outerHTML).join('')}</table>`
          });
        } else if (currentSection.title) {
          sections.push({
            title: currentSection.title,
            question: currentSection.question,
            base: currentSection.base,
            tableHtml: ''
          });
        }
      }

      // Separate NetSummaryTable entries from regular tables
      const netSummaryTableSections: PreviewTableSection[] = [];
      const regularTableSections: PreviewTableSection[] = [];
      
      sections.forEach(section => {
        const isNetSummaryTable = previewVariable && 
          previewVariable.type?.toLowerCase().includes('single select grid') &&
          (() => {
            const baseName = previewVariable.name;
            const netCodes = netSummaryTableSelectedCodes[baseName] || [];
            return netCodes.some(net => section.title.includes(net.name));
          })();
        
        if (isNetSummaryTable) {
          netSummaryTableSections.push(section);
        } else {
          regularTableSections.push(section);
        }
      });
      
      // Sort NetSummaryTables by their original order
      if (previewVariable) {
        const baseName = previewVariable.name;
        const netCodes = netSummaryTableSelectedCodes[baseName] || [];
        netSummaryTableSections.sort((a, b) => {
          const aIndex = netCodes.findIndex(net => a.title.includes(net.name));
          const bIndex = netCodes.findIndex(net => b.title.includes(net.name));
          return aIndex - bIndex;
        });
      }
      
      // Renumber regular tables to continue after NetSummaryTables
      const netTableCount = netSummaryTableSections.length;
      regularTableSections.forEach((section, idx) => {
        const tableNumber = netTableCount + idx + 1;
        section.title = section.title.replace(/^Table \d+:/, `Table ${tableNumber}:`);
      });
      
      // Combine: NetSummaryTables first, then regular tables
      let finalSections = [...netSummaryTableSections, ...regularTableSections];
      
      // Filter to only include sections for tables that are actually selected
      if (previewVariable) {
        const expectedTables = getTablesForVariable(previewVariable);
        finalSections = finalSections.filter(section => {
          const titleMatch = section.title.match(/Table \d+:\s*(.+)/);
          if (!titleMatch) {
            return expectedTables.length === 0 || finalSections.length === 0;
          }
          
          const tableIdentifier = titleMatch[1].trim();
          const baseName = previewVariable.name;
          
          return expectedTables.some(expectedTable => {
            if (expectedTable === baseName) {
              return tableIdentifier === baseName || 
                     tableIdentifier.startsWith(baseName + ':') || 
                     tableIdentifier.startsWith(baseName + '_') ||
                     (tableIdentifier === baseName.replace(/^Q/, ''));
            }
            return tableIdentifier.includes(expectedTable) || expectedTable.includes(tableIdentifier);
          });
        });
      }
      
      const summaryTableIds = new Set(
        expectedTables.filter(tableId =>
          tableId.includes('_MeanSummaryTable') ||
          tableId.includes('_SumSummaryTable') ||
          tableId.includes('_NetSummaryTable') ||
          tableId.includes('_Summary_') ||
          tableId.endsWith('_VerbatimSummary')
        )
      );
      const netNames = previewVariable
        ? (netSummaryTableSelectedCodes[previewVariable.name] || [])
            .map(net => (net.name || '').toLowerCase())
            .filter(Boolean)
        : [];

      const resolveSectionTableId = (sectionTitle: string): string | null => {
        const titleMatch = sectionTitle.match(/Table \d+:\s*(.+)/i);
        const identifier = (titleMatch ? titleMatch[1] : sectionTitle).trim();
        const baseName = previewVariable.name;
        const normalizedIdentifier = identifier.replace(/^Q/i, '');
        for (const tableId of expectedTables) {
          const normalizedId = tableId.replace(/^Q/i, '');
          if (
            identifier === tableId ||
            normalizedIdentifier === normalizedId ||
            identifier.includes(tableId) ||
            tableId.includes(identifier) ||
            normalizedIdentifier === tableId ||
            identifier === normalizedId
          ) {
            return tableId;
          }
        }
        if (identifier === baseName.replace(/^Q/i, '')) return baseName;
        return null;
      };

      const processedSections: PreviewTableSection[] = finalSections.map(section => {
        const tableId = resolveSectionTableId(section.title);
        const lowerTitle = section.title.toLowerCase();
        const matchesNetName = netNames.some(name => lowerTitle.includes(name));
        const isNetSummaryTitle = lowerTitle.includes('net summary');
        const isSummarySection = tableId
          ? summaryTableIds.has(tableId) || matchesNetName
          : /summary/i.test(section.title) || matchesNetName || isNetSummaryTitle;
        if (!isSummarySection) return section;

        if (!section.tableHtml) {
          return { ...section, tableHtml: '' };
        }

        try {
          const sectionDoc = parser.parseFromString(section.tableHtml, 'text/html');
          const tableEl = sectionDoc.querySelector('table');
          if (!tableEl) return { ...section, tableHtml: '' };

          const rows = Array.from(tableEl.querySelectorAll('tr'));
          const headerRows = rows.filter(r => r.querySelector('th'));
          const baseRow = rows.find(r => {
            const text = (r.textContent || '').toLowerCase();
            return text.startsWith('base') || text.includes('total answering') || text.includes('total responding');
          });

          const keptRows: HTMLElement[] = [];
          headerRows.forEach(r => keptRows.push(r.cloneNode(true) as HTMLElement));
          if (baseRow) {
            const alreadyIncluded = headerRows.includes(baseRow);
            if (!alreadyIncluded) {
              keptRows.push(baseRow.cloneNode(true) as HTMLElement);
            }
          }

          const colgroup = tableEl.querySelector('colgroup');
          const trimmedHtml = keptRows.length > 0
            ? `<table>${colgroup ? colgroup.outerHTML : ''}${keptRows.map(r => r.outerHTML).join('')}</table>`
            : '';
          return { ...section, tableHtml: trimmedHtml };
        } catch {
          return { ...section, tableHtml: '' };
        }
      });

      if (!isCancelled) {
        setPreviewSectionsHtml(processedSections);
        setPreviewDebugInfo(debugInfo || {});
        if (previewVariable) {
          setVariableRenderedTableCounts(prev => ({
            ...prev,
            [previewVariable.name]: finalSections.length
          }));
        }
      }
    } catch (error) {
      console.error('Preview generation error:', error);
      if (!isCancelled) {
        setPreviewError(error instanceof Error ? error.message : 'Failed to generate preview.');
        setPreviewSectionsHtml([]);
        setPreviewDebugInfo({});
        if (previewVariable) {
          setVariableRenderedTableCounts(prev => ({
            ...prev,
            [previewVariable.name]: 0
          }));
        }
      }
    } finally {
      if (!isCancelled) {
        setPreviewLoading(false);
      }
    }
  }, [previewVariable, buildTabSpecsWorkbook, getTablesForVariable, netSummaryTableSelectedCodes]);

  // Auto-generate preview when previewVariable changes
  useEffect(() => {
    if (previewVariable && buildTabSpecsWorkbook && getTablesForVariable) {
      generatePreview();
    } else {
      setPreviewSectionsHtml([]);
      setPreviewError(null);
      setPreviewLoading(false);
      setPreviewDebugInfo({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewVariable?.name, buildTabSpecsWorkbook, getTablesForVariable]);

  return {
    previewVariable,
    previewSectionsHtml,
    previewLoading,
    previewError,
    previewDebugInfo,
    variableRenderedTableCounts,
    generatePreview,
    setPreviewVariable,
    setPreviewSectionsHtml,
    setPreviewLoading,
    setPreviewError,
    setPreviewDebugInfo,
    setVariableRenderedTableCounts,
  };
};

