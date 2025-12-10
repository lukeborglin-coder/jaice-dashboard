/**
 * Gets the mapped column header for an expected header
 */
export function getMappedColumn(
  columnMapping: Record<string, string>,
  expectedHeader: string
): string | null {
  // Try exact match
  if (columnMapping[expectedHeader]) {
    return columnMapping[expectedHeader];
  }

  // Try without Q prefix
  const withoutQ = expectedHeader.replace(/^Q/i, '');
  if (columnMapping[withoutQ]) {
    return columnMapping[withoutQ];
  }

  // Try case-insensitive match
  const expectedLower = expectedHeader.toLowerCase().trim();
  const matchingKey = Object.keys(columnMapping).find(
    (k) => k.toLowerCase().trim() === expectedLower
  );
  if (matchingKey) {
    return columnMapping[matchingKey];
  }

  return null;
}

/**
 * Extracts RESPNO from a data row (handles variations: record, respno, RESPNO, etc.)
 */
export function extractRespno(row: Record<string, any>): string | null {
  const respno =
    row['record'] ??
    row['respno'] ??
    row['Record'] ??
    row['Respno'] ??
    row['RECORD'] ??
    row['RESPNO'] ??
    row['RESPONO'] ??
    row['respono'] ??
    null;

  if (respno === null || respno === undefined || respno === '') {
    return null;
  }

  if (typeof respno === 'string' && respno.trim() === '') {
    return null;
  }

  return String(respno);
}

/**
 * Maps a data row to expected headers using column mapping
 */
export function mapRowToColumns(
  row: Record<string, any>,
  columnMapping: Record<string, string>,
  expectedHeaders: string[]
): Record<string, any> {
  const mappedRow: Record<string, any> = {};

  expectedHeaders.forEach((expectedHeader) => {
    // Handle RESPNO/record specially
    if (expectedHeader.toLowerCase() === 'record' || expectedHeader.toLowerCase() === 'respno') {
      const respno = extractRespno(row);
      mappedRow[expectedHeader] = respno;
      return;
    }

    // Check if it's a coded column (direct match in data)
    const isCodedColumn = /^[a-z0-9]+r\d+$/i.test(expectedHeader);
    if (isCodedColumn) {
      if (row.hasOwnProperty(expectedHeader)) {
        mappedRow[expectedHeader] = row[expectedHeader];
      } else {
        mappedRow[expectedHeader] = null;
      }
      return;
    }

    // Use column mapping
    const mappedColumn = getMappedColumn(columnMapping, expectedHeader);
    if (mappedColumn && row.hasOwnProperty(mappedColumn)) {
      const value = row[mappedColumn];
      if (
        value === null ||
        value === undefined ||
        value === '' ||
        (typeof value === 'string' && value.trim() === '')
      ) {
        mappedRow[expectedHeader] = null;
      } else {
        mappedRow[expectedHeader] = value;
      }
    } else {
      mappedRow[expectedHeader] = null;
    }
  });

  return mappedRow;
}

/**
 * Filters rows to only include those with valid RESPNO values
 */
export function filterRowsWithRespno(
  rows: Record<string, any>[]
): Record<string, any>[] {
  return rows.filter((row) => {
    const respno = extractRespno(row);
    return respno !== null;
  });
}


