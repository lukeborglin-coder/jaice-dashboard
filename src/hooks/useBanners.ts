import { useState, useRef, useCallback, useEffect } from 'react';
import { BannerGroup, BannerConditionGroup } from '../types/dataTabulation';
import { ParsedDataFile } from '../utils/dataTabulationHelpers';
import * as XLSX from 'xlsx';
import { Variable } from '../utils/tabs/types';

interface UseBannersProps {
  selectedQuestionnaire?: any | null;
  variables?: Variable[];
}

export const useBanners = (props?: UseBannersProps) => {
  const { selectedQuestionnaire, variables = [] } = props || {};
  
  const [newBannerGroups, setNewBannerGroups] = useState<BannerGroup[]>([]);
  const [showBannerBuilder, setShowBannerBuilder] = useState(false);
  const [editingBannerGroup, setEditingBannerGroup] = useState<BannerGroup | null>(null);
  const [selectedNewBannerGroupId, setSelectedNewBannerGroupId] = useState<string | null>(null);
  const [selectedNewBannerVariable, setSelectedNewBannerVariable] = useState<string | null>(null);
  const [bannerFilterConditions, setBannerFilterConditions] = useState<BannerConditionGroup[] | null>(null);
  const [parsedFile, setParsedFile] = useState<ParsedDataFile | null>(null);
  const [hiddenFromBanners, setHiddenFromBanners] = useState<Set<string>>(new Set());
  const bannerSettingsOpenRef = useRef<(() => void) | null>(null);
  const bannerSpecsFileInputRef = useRef<HTMLInputElement | null>(null);

  const handleClickImportBannerSpecs = useCallback(() => {
    bannerSpecsFileInputRef.current?.click();
  }, []);

  const handleBannerSpecsFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const file = e.target.files?.[0];
      if (!file) return;
      const arrayBuffer = await file.arrayBuffer();
      const wb = XLSX.read(arrayBuffer, { type: 'array' });
      if (!wb.SheetNames || wb.SheetNames.length === 0) {
        alert('No sheets found in the uploaded file.');
        return;
      }
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
      if (!rows || rows.length === 0) {
        alert('The uploaded sheet is empty.');
        return;
      }
      // Find header row and column indices for the three columns
      let headerRowIndex = -1;
      let headingCol = -1;
      let pointCol = -1;
      let defCol = -1;
      // Try to detect by exact header match first, then by startsWith
      for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const row = rows[i] || [];
        const lowered = row.map((c: any) => String(c || '').trim().toLowerCase());
        const idxHeading = lowered.findIndex((c: string) => c === 'banner heading (e.g. gender)' || c.startsWith('banner heading'));
        const idxPoint = lowered.findIndex((c: string) => c === 'banner point (e.g. male)' || c.startsWith('banner point'));
        const idxDef = lowered.findIndex((c: string) => c === 'banner definition' || c.startsWith('banner definition'));
        if (idxHeading !== -1 && idxPoint !== -1 && idxDef !== -1) {
          headerRowIndex = i;
          headingCol = idxHeading;
          pointCol = idxPoint;
          defCol = idxDef;
          break;
        }
      }
      if (headerRowIndex === -1) {
        alert('Could not find required headers: "Banner Heading", "Banner Point", "Banner Definition".');
        return;
      }
      // Build subgroups grouped by heading (preserve order), carry forward blank headings
      const subGroupMap = new Map<string, { id: string; title: string; cuts: any[] }>();
      let includeTotal = false;
      let currentHeading: string | null = null;
      for (let r = headerRowIndex + 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const headingRaw = row[headingCol];
        const pointRaw = row[pointCol];
        const defRaw = defCol !== -1 ? row[defCol] : '';

        const headingCell = headingRaw !== undefined && headingRaw !== null ? String(headingRaw).trim() : '';
        const point = pointRaw !== undefined && pointRaw !== null ? String(pointRaw).trim() : '';
        const definitionText = defRaw !== undefined && defRaw !== null ? String(defRaw).trim() : '';

        // Skip completely blank rows
        if (!headingCell && !point) continue;

        // If a heading cell is present and equals "Total", mark and skip; don't set currentHeading
        if (headingCell && headingCell.toLowerCase() === 'total') {
          includeTotal = true;
          continue;
        }

        // Update current heading when a non-empty, non-total heading is present
        if (headingCell) {
          currentHeading = headingCell;
        }

        // We need a valid heading context and a point to create a cut
        if (!currentHeading || !point) continue;

        // Ensure subgroup for current heading exists
        if (!subGroupMap.has(currentHeading)) {
          subGroupMap.set(currentHeading, { id: `${Date.now()}-${subGroupMap.size + 1}`, title: currentHeading, cuts: [] });
        }
        const sub = subGroupMap.get(currentHeading)!;
        sub.cuts.push({
          id: `${sub.id}-c${sub.cuts.length + 1}`,
          title: point,
          variableName: '',
          codes: [],
          definitionText
        });
      }
      if (subGroupMap.size === 0) {
        alert('No banner headings/points found to import.');
        return;
      }
      const importedGroup: BannerGroup = {
        id: `import_${Date.now()}`,
        title: file.name.replace(/\.(xlsx|xls)$/i, '') || 'Imported Banner Specs',
        groups: Array.from(subGroupMap.values()).map(sg => ({ id: sg.id, title: sg.title, cuts: sg.cuts })),
        includeTotal,
        // Mark as newly imported so BannerBuilder can auto-trigger AI config
        _isNewlyImported: true
      };
      // Add to list and open in editor for review
      setNewBannerGroups(prev => [...prev, importedGroup]);
      setEditingBannerGroup(importedGroup);
      setShowBannerBuilder(true);
    } catch (err: any) {
      alert(`Failed to import banner specs: ${err?.message || String(err)}`);
    } finally {
      // reset input
      if (e.target) e.target.value = '';
    }
  }, []);

  const handleBannerSave = useCallback((group: BannerGroup) => {
    if (editingBannerGroup) {
      setNewBannerGroups(prev => prev.map(g => g.id === group.id ? group : g));
    } else {
      setNewBannerGroups(prev => [...prev, group]);
    }
    setShowBannerBuilder(false);
    setEditingBannerGroup(null);
  }, [editingBannerGroup]);

  const handleBannerChange = useCallback((group: BannerGroup) => {
    // Persist edits without closing builder
    if (!group?.id) return;
    const exists = newBannerGroups.some(g => g.id === group.id);
    if (exists) {
      setNewBannerGroups(prev => prev.map(g => g.id === group.id ? group : g));
    } else {
      setNewBannerGroups(prev => [...prev, group]);
    }
  }, [newBannerGroups]);

  const handleBannerCancel = useCallback(() => {
    setShowBannerBuilder(false);
    setEditingBannerGroup(null);
  }, []);

  // Load new banner groups from localStorage when questionnaire changes
  useEffect(() => {
    if (selectedQuestionnaire?.id) {
      const key = `newBannerGroups_${selectedQuestionnaire.id}`;
      const stored = localStorage.getItem(key);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          setNewBannerGroups(parsed || []);
        } catch (e) {
          setNewBannerGroups([]);
        }
      } else {
        setNewBannerGroups([]);
      }
    } else {
      setNewBannerGroups([]);
    }
  }, [selectedQuestionnaire?.id]);

  // Save new banner groups to localStorage when they change
  useEffect(() => {
    if (selectedQuestionnaire?.id && newBannerGroups.length > 0) {
      const key = `newBannerGroups_${selectedQuestionnaire.id}`;
      localStorage.setItem(key, JSON.stringify(newBannerGroups));
    }
  }, [newBannerGroups, selectedQuestionnaire?.id]);

  // Load banner filter conditions from localStorage when questionnaire changes
  useEffect(() => {
    if (selectedQuestionnaire?.id) {
      const key = `bannerFilterConditions_${selectedQuestionnaire.id}`;
      const stored = localStorage.getItem(key);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          setBannerFilterConditions(parsed || null);
        } catch (e) {
          setBannerFilterConditions(null);
        }
      } else {
        setBannerFilterConditions(null);
      }
    } else {
      setBannerFilterConditions(null);
    }
  }, [selectedQuestionnaire?.id]);

  // Save banner filter conditions to localStorage when they change
  useEffect(() => {
    if (selectedQuestionnaire?.id) {
      const key = `bannerFilterConditions_${selectedQuestionnaire.id}`;
      if (bannerFilterConditions && bannerFilterConditions.length > 0) {
        localStorage.setItem(key, JSON.stringify(bannerFilterConditions));
      } else {
        localStorage.removeItem(key);
      }
    }
  }, [bannerFilterConditions, selectedQuestionnaire?.id]);

  // Initialize hiddenFromBanners: hide open ends and open end lists by default
  useEffect(() => {
    if (selectedQuestionnaire?.id) {
      const key = `hiddenFromBanners_${selectedQuestionnaire.id}`;
      const stored = localStorage.getItem(key);
      
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          setHiddenFromBanners(new Set(parsed));
        } catch (e) {
          // Initialize with defaults if loading fails
          if (variables.length > 0) {
            const defaultHidden = new Set<string>();
            variables.forEach(v => {
              const isOpenEnd = v.type?.toLowerCase().includes('open end');
              if (isOpenEnd) {
                defaultHidden.add(v.name);
              }
            });
            setHiddenFromBanners(defaultHidden);
          }
        }
      } else if (variables.length > 0) {
        // Initialize with defaults: hide open ends and open end lists
        const defaultHidden = new Set<string>();
        variables.forEach(v => {
          const isOpenEnd = v.type?.toLowerCase().includes('open end');
          if (isOpenEnd) {
            defaultHidden.add(v.name);
          }
        });
        setHiddenFromBanners(defaultHidden);
      }
    } else {
      setHiddenFromBanners(new Set());
    }
  }, [selectedQuestionnaire?.id, variables]);

  // Save hiddenFromBanners to localStorage when it changes
  useEffect(() => {
    if (selectedQuestionnaire?.id) {
      const key = `hiddenFromBanners_${selectedQuestionnaire.id}`;
      if (hiddenFromBanners.size > 0) {
        localStorage.setItem(key, JSON.stringify(Array.from(hiddenFromBanners)));
      } else {
        localStorage.removeItem(key);
      }
    }
  }, [hiddenFromBanners, selectedQuestionnaire?.id]);

  return {
    newBannerGroups,
    showBannerBuilder,
    editingBannerGroup,
    selectedNewBannerGroupId,
    selectedNewBannerVariable,
    bannerFilterConditions,
    parsedFile,
    hiddenFromBanners,
    bannerSettingsOpenRef,
    bannerSpecsFileInputRef,
    handleClickImportBannerSpecs,
    handleBannerSpecsFileChange,
    handleBannerSave,
    handleBannerChange,
    handleBannerCancel,
    setNewBannerGroups,
    setShowBannerBuilder,
    setEditingBannerGroup,
    setSelectedNewBannerGroupId,
    setSelectedNewBannerVariable,
    setBannerFilterConditions,
    setParsedFile,
    setHiddenFromBanners,
  };
};

