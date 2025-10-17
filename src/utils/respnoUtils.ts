interface InterviewMetadata {
  interviewDate?: string | null;
  interviewTime?: string | null;
  uploadedAt?: number | null;
}

export interface TranscriptLike extends InterviewMetadata {
  id: string;
  respno?: string | null;
}

const FALLBACK_BASE = 9e14;

export const normalizeRespnoValue = (value?: string | null): string => {
  if (!value) return '';
  return String(value).trim().toUpperCase();
};

export const respnoToNumber = (respno?: string | null): number => {
  if (!respno) return 0;
  const match = String(respno).match(/(\d+)/);
  if (!match) return 0;
  return parseInt(match[1], 10) || 0;
};

export const formatRespno = (index: number): string => {
  const padded = String(index).padStart(2, '0');
  return `R${padded}`;
};

export const computeInterviewTimestamp = (
  metadata: InterviewMetadata,
  fallbackOrder = 0,
  fallbackRespno?: string
): number => {
  const datePart = metadata.interviewDate?.trim();
  const timePart = metadata.interviewTime?.trim();

  const tryParseDate = (value: string) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
  };

  if (datePart && timePart) {
    const combined = `${datePart} ${timePart}`;
    const parsed = tryParseDate(combined);
    if (parsed !== null) return parsed;

    const isoAttempt = `${datePart}T${timePart}`;
    const parsedIso = tryParseDate(isoAttempt);
    if (parsedIso !== null) return parsedIso;
  }

  if (datePart) {
    const parsed = tryParseDate(datePart);
    if (parsed !== null) return parsed;
  }

  if (typeof metadata.uploadedAt === 'number' && !Number.isNaN(metadata.uploadedAt)) {
    return metadata.uploadedAt;
  }

  const respnoOrder = fallbackRespno ? respnoToNumber(fallbackRespno) : 0;
  return FALLBACK_BASE + respnoOrder + fallbackOrder;
};

export interface NormalizeTranscriptsResult<T extends TranscriptLike> {
  orderedAsc: T[];
  orderedDesc: T[];
  previousToNewRespno: Map<string, string>;
  idToRespno: Map<string, string>;
}

export const normalizeTranscriptList = <T extends TranscriptLike>(
  transcripts: T[]
): NormalizeTranscriptsResult<T> => {
  const withMeta = transcripts.map((item, idx) => {
    const normalizedRespno = normalizeRespnoValue(item.respno);
    const timestamp = computeInterviewTimestamp(
      {
        interviewDate: item.interviewDate,
        interviewTime: item.interviewTime,
        uploadedAt: item.uploadedAt ?? null
      },
      idx,
      normalizedRespno
    );

    return {
      original: item,
      timestamp,
      index: idx,
      normalizedRespno
    };
  });

  withMeta.sort((a, b) => {
    if (a.timestamp !== b.timestamp) {
      return a.timestamp - b.timestamp;
    }
    return a.index - b.index;
  });

  const previousToNewRespno = new Map<string, string>();
  const idToRespno = new Map<string, string>();

  const orderedAsc = withMeta.map((meta, idx) => {
    const newRespno = formatRespno(idx + 1);
    if (meta.normalizedRespno) {
      previousToNewRespno.set(meta.normalizedRespno, newRespno);
    }
    idToRespno.set(meta.original.id, newRespno);
    return {
      ...meta.original,
      respno: newRespno
    };
  });

  const orderedDesc = [...orderedAsc].sort((a, b) => {
    return respnoToNumber(b.respno) - respnoToNumber(a.respno);
  });

  return {
    orderedAsc,
    orderedDesc,
    previousToNewRespno,
    idToRespno
  };
};

export const buildRespnoOrderIndex = (respnos: string[]): Map<string, number> => {
  const index = new Map<string, number>();
  respnos.forEach((respno, idx) => {
    index.set(normalizeRespnoValue(respno), idx);
  });
  return index;
};

type AnalysisData = Record<string, any>;

interface TranscriptForAnalysis {
  respno?: string | null;
  demographics?: Record<string, any>;
  [key: string]: any;
}

interface AnalysisLike {
  data?: AnalysisData;
  transcripts?: TranscriptForAnalysis[];
  [key: string]: any;
}

const extractInterviewMetadataFromRow = (row: Record<string, any>) => {
  const date =
    row['Interview Date'] ||
    row['Date'] ||
    row['interviewDate'] ||
    row['Interview date'] ||
    row['interview date'] ||
    row['Date of Interview'];

  const time =
    row['Interview Time'] ||
    row['Time'] ||
    row['interviewTime'] ||
    row['Interview time'] ||
    row['interview time'] ||
    row['Time of Interview'];

  return {
    interviewDate: date,
    interviewTime: time
  };
};

export const normalizeAnalysisRespnos = (
  analysis: AnalysisLike,
  projectTranscripts?: TranscriptLike[]
): AnalysisLike => {
  if (!analysis || !analysis.data || !Array.isArray(analysis.data.Demographics)) {
    return analysis;
  }

  const demographicsRows = analysis.data.Demographics.map((row: any) => ({ ...row }));
  const previousToNew = new Map<string, string>();
  const rowOrderMeta = demographicsRows.map((row: any, idx: number) => {
    const normalizedRespno = normalizeRespnoValue(row['Respondent ID'] || row['respno']);
    const metadata = extractInterviewMetadataFromRow(row);
    const projectTranscript = projectTranscripts?.find(
      t => normalizeRespnoValue(t.respno) === normalizedRespno
    );

    const timestamp = computeInterviewTimestamp(
      {
        interviewDate: metadata.interviewDate ?? projectTranscript?.interviewDate,
        interviewTime: metadata.interviewTime ?? projectTranscript?.interviewTime
      },
      idx,
      normalizedRespno
    );

    return {
      row,
      index: idx,
      timestamp,
      normalizedRespno
    };
  });

  rowOrderMeta.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    return a.index - b.index;
  });

  rowOrderMeta.forEach((meta, idx) => {
    const newRespno = formatRespno(idx + 1);
    if (meta.normalizedRespno) {
      previousToNew.set(meta.normalizedRespno, newRespno);
    }
    meta.row['Respondent ID'] = newRespno;
    meta.row['respno'] = newRespno;
  });

  const updatedDemographics = rowOrderMeta
    .map(meta => meta.row)
    .sort((a, b) => respnoToNumber(a['Respondent ID']) - respnoToNumber(b['Respondent ID']));

  const normalizedData: AnalysisData = {};
  const respnoOrderIndex = buildRespnoOrderIndex(
    updatedDemographics.map(row => row['Respondent ID']).filter(Boolean)
  );

  Object.entries(analysis.data).forEach(([sheetName, sheetData]) => {
    if (!Array.isArray(sheetData)) {
      normalizedData[sheetName] = sheetData;
      return;
    }

    if (sheetName === 'Demographics') {
      normalizedData[sheetName] = updatedDemographics;
      return;
    }

    const updatedRows = sheetData.map((row: any) => {
      const newRow = { ...row };
      ['Respondent ID', 'respno'].forEach(key => {
        if (!newRow[key]) return;
        const normalized = normalizeRespnoValue(newRow[key]);
        if (!normalized) return;
        const mapped = previousToNew.get(normalized);
        if (mapped) {
          newRow[key] = mapped;
        }
      });
      return newRow;
    });

    const shouldSort = updatedRows.some(row => {
      if (!row) return false;
      const resp = row['Respondent ID'] || row['respno'];
      return typeof resp === 'string' && resp.trim().length > 0;
    });

    if (shouldSort) {
      normalizedData[sheetName] = [...updatedRows].sort((a, b) => {
        const respA = normalizeRespnoValue(a['Respondent ID'] || a['respno']);
        const respB = normalizeRespnoValue(b['Respondent ID'] || b['respno']);
        const indexA = respnoOrderIndex.get(respA) ?? Number.MAX_SAFE_INTEGER;
        const indexB = respnoOrderIndex.get(respB) ?? Number.MAX_SAFE_INTEGER;
        return indexA - indexB;
      });
    } else {
      normalizedData[sheetName] = updatedRows;
    }
  });

  const updatedTranscripts = Array.isArray(analysis.transcripts)
    ? analysis.transcripts.map(transcript => {
        const normalized = normalizeRespnoValue(transcript.respno);
        let mappedRespno = normalized ? previousToNew.get(normalized) : undefined;

        if (!mappedRespno && projectTranscripts && projectTranscripts.length > 0) {
          const metadata = extractInterviewMetadataFromRow(transcript.demographics || {});
          const matchingTranscript = projectTranscripts.find(pt => {
            return (
              normalizeRespnoValue(pt.respno) === normalized ||
              (metadata.interviewDate &&
                metadata.interviewDate === pt.interviewDate &&
                metadata.interviewTime === pt.interviewTime)
            );
          });
          if (matchingTranscript) {
            mappedRespno = matchingTranscript.respno || mappedRespno;
          }
        }

        const newRespno = mappedRespno || transcript.respno;
        const demographics = transcript.demographics ? { ...transcript.demographics } : {};
        if (newRespno) {
          demographics['Respondent ID'] = newRespno;
          demographics['respno'] = newRespno;
        }

        return {
          ...transcript,
          respno: newRespno,
          demographics
        };
      })
    : analysis.transcripts;

  const sortedTranscripts = Array.isArray(updatedTranscripts)
    ? [...updatedTranscripts].sort((a, b) => {
        const respA = normalizeRespnoValue(a?.respno);
        const respB = normalizeRespnoValue(b?.respno);
        const indexA = respnoOrderIndex.get(respA) ?? Number.MAX_SAFE_INTEGER;
        const indexB = respnoOrderIndex.get(respB) ?? Number.MAX_SAFE_INTEGER;
        return indexA - indexB;
      })
    : updatedTranscripts;

  return {
    ...analysis,
    data: normalizedData,
    transcripts: sortedTranscripts
  };
};

const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

const sanitizeFilenameComponent = (value: string): string => {
  return value.replace(INVALID_FILENAME_CHARS, '').replace(/\s+/g, ' ').trim();
};

const formatShortDate = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    const year = parsed.getFullYear().toString().slice(-2);
    return `${month}.${day}.${year}`;
  }

  const digitsOnly = trimmed.replace(/[^0-9]/g, '');
  if (digitsOnly.length === 8) {
    return `${digitsOnly.slice(0, 2)}.${digitsOnly.slice(2, 4)}.${digitsOnly.slice(6)}`;
  }

  return sanitizeFilenameComponent(trimmed).replace(/[\/-]/g, '.');
};

const toTwelveHourString = (hours: number, minutes: number): string => {
  const period = hours >= 12 ? 'pm' : 'am';
  let hour12 = hours % 12;
  if (hour12 === 0) hour12 = 12;
  const minuteStr = minutes.toString().padStart(2, '0');
  return `${hour12}${minuteStr}${period}`;
};

const formatTimeForFilename = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = new Date(`1970-01-01T${trimmed}`);
  if (!Number.isNaN(parsed.getTime())) {
    return toTwelveHourString(parsed.getHours(), parsed.getMinutes());
  }

  const ampmMatch = trimmed.match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM)$/i);
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1], 10);
    const minutes = ampmMatch[2] ? parseInt(ampmMatch[2], 10) : 0;
    const period = ampmMatch[3].toUpperCase();

    if (period === 'PM' && hours < 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;

    return toTwelveHourString(hours, minutes);
  }

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length >= 3) {
    let hours = 0;
    let minutes = 0;

    if (digits.length === 3) {
      hours = parseInt(digits.slice(0, 1), 10);
      minutes = parseInt(digits.slice(1), 10);
    } else {
      hours = parseInt(digits.slice(0, digits.length - 2), 10);
      minutes = parseInt(digits.slice(-2), 10);
    }

    if (!Number.isNaN(hours) && !Number.isNaN(minutes)) {
      hours = Math.max(0, Math.min(23, hours));
      minutes = Math.max(0, Math.min(59, minutes));
      return toTwelveHourString(hours, minutes);
    }
  }

  return sanitizeFilenameComponent(trimmed).replace(/[^0-9A-Za-z]/g, '');
};

const extractExtension = (filename?: string | null): string => {
  if (!filename) return '';
  const idx = filename.lastIndexOf('.');
  if (idx === -1 || idx === filename.length - 1) return '';
  return filename.slice(idx);
};

const removeExtension = (filename?: string | null): string => {
  if (!filename) return '';
  const idx = filename.lastIndexOf('.');
  if (idx === -1) return filename;
  return filename.slice(0, idx);
};

export const buildTranscriptDisplayName = ({
  projectName,
  respno,
  interviewDate,
  interviewTime,
  fallbackFilename,
  includeExtension = true,
  descriptor = 'Transcript'
}: {
  projectName?: string | null;
  respno?: string | null;
  interviewDate?: string | null;
  interviewTime?: string | null;
  fallbackFilename?: string | null;
  includeExtension?: boolean;
  descriptor?: string;
}): string => {
  const normalizedRespno = normalizeRespnoValue(respno);
  const shortDate = formatShortDate(interviewDate);
  const shortTime = formatTimeForFilename(interviewTime);
  const cleanProject = projectName ? sanitizeFilenameComponent(projectName) : '';
  const extension = includeExtension ? extractExtension(fallbackFilename) : '';

  if (cleanProject && normalizedRespno && shortDate && shortTime) {
    const base = [
      cleanProject,
      `${normalizedRespno} ${descriptor}`.trim(),
      shortDate,
      shortTime
    ]
      .map(segment => sanitizeFilenameComponent(segment))
      .filter(Boolean)
      .join('_');

    const safeBase = base || sanitizeFilenameComponent(removeExtension(fallbackFilename));
    return extension ? `${safeBase}${extension}` : safeBase;
  }

  const fallbackBase = sanitizeFilenameComponent(removeExtension(fallbackFilename)) || 'Transcript';
  return extension ? `${fallbackBase}${extension}` : fallbackBase;
};
