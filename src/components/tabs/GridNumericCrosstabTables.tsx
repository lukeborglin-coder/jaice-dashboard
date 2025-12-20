import React from 'react';

function formatNumberLikeTables(value: number | string) {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (Number.isNaN(num)) return String(value);
  if (Number.isInteger(num)) return num.toLocaleString('en-US');
  if (typeof value === 'string' && value.includes('.')) {
    const [i, d] = value.split('.');
    const iNum = parseInt(i, 10);
    const iFmt = Number.isNaN(iNum) ? i : iNum.toLocaleString('en-US');
    return `${iFmt}.${d}`;
  }
  return num.toLocaleString('en-US');
}

export function GridNumericCrosstabTables({
  tables,
  onViewSummary,
}: {
  tables: any[];
  onViewSummary?: () => void;
}) {
  return (
    <div className="space-y-4">
      {tables.map((t: any) => {
        const isMean = !!t.isMeanSummaryTable;
        const gridCols: Array<{ code: string; text: string }> = Array.isArray(t.gridColumns) ? t.gridColumns : [];
        const cuts: Array<{ code: string; text: string; isTotal?: boolean }> = Array.isArray(t.cuts) ? t.cuts : [];
        const modelsByCutCode: Record<string, any> = t.modelsByCutCode || {};
        const rowOrder: string[] = Array.isArray(t.rowOrder) ? t.rowOrder : [];
        const rowTextByCode: Record<string, string> = t.rowTextByCode || {};
        const totalModel = modelsByCutCode.total;

        // For Sum tables, we stack % as the row below (like single-select crosstabs),
        // so each grid column contributes exactly 1 table column per cut.
        const cutColSpan = gridCols.length;
        const nonTotalCuts = cuts.filter((c) => c.code !== 'total');
        const letterByCutCode = nonTotalCuts.reduce((acc: Record<string, string>, c, idx) => {
          acc[c.code] = String.fromCharCode(65 + idx);
          return acc;
        }, {});

        const getRowForCut = (cutCode: string, rowCode: string) => {
          const model = modelsByCutCode[cutCode];
          return model?.rows?.find((r: any) => r.code === rowCode) || null;
        };

        const computeLettersForCell = (rowCode: string, gridColCode: string) => {
          const lettersMap: Record<string, string> = {};
          let hasLetters = false;

          nonTotalCuts.forEach((cut1) => {
            const row1 = getRowForCut(cut1.code, rowCode);
            const v1 = Number(row1?.columnValues?.[gridColCode] || 0);
            const n1 = Number(row1?.columnBases?.[gridColCode] || 0) || Number(row1?.base || 0);
            const sd1 = Number(row1?.columnStdDevs?.[gridColCode] || 0);
            const lettersArr: string[] = [];

            nonTotalCuts.forEach((cut2) => {
              if (cut2.code === cut1.code) return;

              const row2 = getRowForCut(cut2.code, rowCode);
              const v2 = Number(row2?.columnValues?.[gridColCode] || 0);
              const n2 = Number(row2?.columnBases?.[gridColCode] || 0) || Number(row2?.base || 0);
              const sd2 = Number(row2?.columnStdDevs?.[gridColCode] || 0);

              let isSignificant = false;
              if (isMean) {
                // T-test style comparison (same thresholding used elsewhere in the app)
                if (n1 > 1 && n2 > 1 && (sd1 > 0 || sd2 > 0)) {
                  const se = Math.sqrt((sd1 * sd1) / n1 + (sd2 * sd2) / n2);
                  if (se > 0) {
                    const t = (v1 - v2) / se;
                    // Only flag if cut1 is higher
                    isSignificant = t >= 1.96;
                  }
                }
              } else {
                // Proportion-style comparison on the displayed % (approx; matches other crosstab z-thresholding)
                const totals1 = modelsByCutCode[cut1.code]?.totalValuesByColumn || {};
                const totals2 = modelsByCutCode[cut2.code]?.totalValuesByColumn || {};
                const denom1 = Number(totals1?.[gridColCode] || 0);
                const denom2 = Number(totals2?.[gridColCode] || 0);
                const p1 = denom1 > 0 ? v1 / denom1 : 0;
                const p2 = denom2 > 0 ? v2 / denom2 : 0;
                if (n1 > 0 && n2 > 0) {
                  const zDen = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2);
                  if (zDen > 0) {
                    const z = (p1 - p2) / zDen;
                    isSignificant = z >= 1.96;
                  }
                }
              }

              if (isSignificant) {
                lettersArr.push(letterByCutCode[cut2.code] || '');
              }
            });

            const trimmed = lettersArr.filter(Boolean).join('');
            if (trimmed) hasLetters = true;
            lettersMap[cut1.code] = trimmed;
          });

          return { lettersMap, hasLetters };
        };

        return (
          <div key={t.optionId || t.tableName} className="border border-gray-200 rounded-lg bg-white overflow-hidden">
            <table className="min-w-full table-fixed">
              <colgroup>
                <col className="w-auto" />
                {cuts.flatMap((cut) =>
                  gridCols.map((gc) => (
                    <col key={`${cut.code}-${gc.code}`} className="w-28" />
                  ))
                )}
              </colgroup>
              <thead className="bg-[#D14A2D]">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-white uppercase tracking-wider border-r border-[#D14A2D] whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span>{t.tableName}</span>
                      {typeof onViewSummary === 'function' && (
                        <button
                          type="button"
                          className="text-[11px] px-2 py-0.5 rounded border border-white/60 text-white hover:bg-white/10 transition"
                          onClick={onViewSummary}
                        >
                          View Summary
                        </button>
                      )}
                    </div>
                  </th>
                  {cuts.map((cut) => (
                    <th
                      key={cut.code}
                      colSpan={Math.max(1, cutColSpan)}
                      className="px-3 py-2 text-center text-xs font-semibold text-white uppercase tracking-wider border-l border-[#D14A2D] whitespace-nowrap overflow-hidden text-ellipsis max-w-[7.5rem]"
                    >
                      {cut.text}
                    </th>
                  ))}
                </tr>
                {/* Stat letters row (like other crosstabs): blank under TOTAL, letters under cuts */}
                <tr className="bg-[#D14A2D]">
                  <th className="px-4 py-2 border-r border-[#D14A2D]"></th>
                  {cuts.map((cut) => {
                    if (cut.code === 'total') {
                      return (
                        <th
                          key={`${cut.code}-letters`}
                          colSpan={Math.max(1, cutColSpan)}
                          className="px-4 py-2 text-xs text-white text-center border-l border-[#D14A2D] font-semibold"
                        />
                      );
                    }
                    const letterIndex = Math.max(0, nonTotalCuts.findIndex((c) => c.code === cut.code));
                    const letter = String.fromCharCode(65 + letterIndex);
                    return (
                      <th
                        key={`${cut.code}-letters`}
                        colSpan={Math.max(1, cutColSpan)}
                        className="px-4 py-2 text-xs text-white text-center border-l border-[#D14A2D] font-semibold"
                      >
                        ({letter})
                      </th>
                    );
                  })}
                </tr>
              </thead>

              <tbody className="bg-white divide-y divide-gray-200">
                {rowOrder.map((rowCode, idx) => {
                  const showBaseRow = !(totalModel?.allBasesEqual) || idx === 0;
                  const rowLettersByGridCol = gridCols.reduce((acc: Record<string, { lettersMap: Record<string, string>; hasLetters: boolean }>, gc) => {
                    acc[gc.code] = computeLettersForCell(rowCode, gc.code);
                    return acc;
                  }, {});
                  const rowHasLetters = Object.values(rowLettersByGridCol).some((v) => v.hasLetters);

                  return (
                    <React.Fragment key={rowCode}>
                      {showBaseRow && (
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <td className="px-4 py-2 text-sm font-semibold border-r border-gray-200 text-gray-900">
                            Base (total responding)
                          </td>
                          {cuts.map((cut) => {
                            const model = modelsByCutCode[cut.code];
                            const row = model?.rows?.find((r: any) => r.code === rowCode);
                            const base = row?.base || 0;
                            const baseClass = base === 0 ? 'text-red-600' : 'text-gray-900';

                            return (
                              <React.Fragment key={`${rowCode}-base-${cut.code}`}>
                                {gridCols.map((gc) => (
                                  <td
                                    key={`${rowCode}-base-${cut.code}-${gc.code}`}
                                    className={`px-2 py-2 text-sm text-center font-medium border-l border-gray-200 ${baseClass} w-28 max-w-[7.5rem] overflow-hidden text-ellipsis whitespace-nowrap`}
                                  >
                                    {formatNumberLikeTables(base)}
                                  </td>
                                ))}
                              </React.Fragment>
                            );
                          })}
                        </tr>
                      )}

                      {isMean ? (
                        <>
                          <tr className="border-b border-gray-200 hover:bg-gray-50">
                            <td className="px-4 py-2 text-sm text-gray-900 border-r border-gray-200" rowSpan={rowHasLetters ? 2 : 1}>
                            {rowTextByCode[rowCode] || rowCode}
                            </td>
                            {cuts.map((cut) => {
                              const row = getRowForCut(cut.code, rowCode);
                              const colValues = row?.columnValues || {};

                              return (
                                <React.Fragment key={`${rowCode}-vals-${cut.code}`}>
                                  {gridCols.map((gc) => {
                                    const v = colValues[gc.code] || 0;
                                    const display = formatNumberLikeTables(Number(v).toFixed(2));
                                    const letters = cut.code === 'total' ? '' : (rowLettersByGridCol[gc.code]?.lettersMap?.[cut.code] || '');
                                    const highlight = !!letters;
                                    return (
                                      <td
                                        key={`${rowCode}-${cut.code}-${gc.code}-mean`}
                                        className="px-2 py-2 text-sm text-center text-gray-900 border-l border-gray-200 w-28 max-w-[7.5rem] overflow-hidden text-ellipsis whitespace-nowrap"
                                        style={{ backgroundColor: highlight ? '#e0f2ff' : 'transparent' }}
                                      >
                                        {display}
                                      </td>
                                    );
                                  })}
                                </React.Fragment>
                              );
                            })}
                          </tr>
                          {rowHasLetters && (
                            <tr className="border-b border-gray-200 hover:bg-gray-50">
                              {cuts.map((cut) => (
                                <React.Fragment key={`${rowCode}-letters-${cut.code}`}>
                                  {gridCols.map((gc) => {
                                    const letters = cut.code === 'total' ? '' : (rowLettersByGridCol[gc.code]?.lettersMap?.[cut.code] || '');
                                    const highlight = !!letters;
                                    return (
                                      <td
                                        key={`${rowCode}-${cut.code}-${gc.code}-mean-letters`}
                                        className="px-2 py-1 text-[11px] font-semibold text-blue-700 text-center border-l border-gray-200 w-28 max-w-[7.5rem] overflow-hidden text-ellipsis whitespace-nowrap"
                                        style={{ backgroundColor: highlight ? '#e0f2ff' : 'transparent' }}
                                      >
                                        {letters}
                                      </td>
                                    );
                                  })}
                                </React.Fragment>
                              ))}
                            </tr>
                          )}
                        </>
                      ) : (
                        <>
                          {/* Value row (top) */}
                          <tr className="border-b border-gray-200 hover:bg-gray-50">
                            <td
                              className="px-4 py-2 text-sm text-gray-900 border-r border-gray-200"
                              rowSpan={rowHasLetters ? 3 : 2}
                            >
                              {rowTextByCode[rowCode] || rowCode}
                            </td>
                            {cuts.map((cut) => {
                              const row = getRowForCut(cut.code, rowCode);
                              const colValues = row?.columnValues || {};

                              return (
                                <React.Fragment key={`${rowCode}-sum-top-${cut.code}`}>
                                  {gridCols.map((gc) => {
                                    const v = colValues[gc.code] || 0;
                                    const displayValue = formatNumberLikeTables(Math.round(Number(v) || 0));
                                    const letters = cut.code === 'total' ? '' : (rowLettersByGridCol[gc.code]?.lettersMap?.[cut.code] || '');
                                    const highlight = !!letters;
                                    return (
                                      <td
                                        key={`${rowCode}-${cut.code}-${gc.code}-sum-top`}
                                        className="px-2 py-2 text-sm text-center text-gray-900 border-l border-gray-200 w-28 max-w-[7.5rem] overflow-hidden text-ellipsis whitespace-nowrap"
                                        style={{ backgroundColor: highlight ? '#e0f2ff' : 'transparent' }}
                                      >
                                        {displayValue}
                                      </td>
                                    );
                                  })}
                                </React.Fragment>
                              );
                            })}
                          </tr>
                          {/* % row (bottom) */}
                          <tr className="border-b border-gray-200 hover:bg-gray-50">
                            {cuts.map((cut) => {
                              const model = modelsByCutCode[cut.code];
                              const row = getRowForCut(cut.code, rowCode);
                              const totalsByCol = model?.totalValuesByColumn || {};
                              const colValues = row?.columnValues || {};

                              return (
                                <React.Fragment key={`${rowCode}-sum-bottom-${cut.code}`}>
                                  {gridCols.map((gc) => {
                                    const v = colValues[gc.code] || 0;
                                    const totalForPct = totalsByCol[gc.code] || 0;
                                    const pct = totalForPct > 0 ? Math.round((Number(v) / totalForPct) * 100) : 0;
                                    const letters = cut.code === 'total' ? '' : (rowLettersByGridCol[gc.code]?.lettersMap?.[cut.code] || '');
                                    const highlight = !!letters;
                                    return (
                                      <td
                                        key={`${rowCode}-${cut.code}-${gc.code}-sum-bottom`}
                                        className="px-2 py-2 text-xs text-center text-gray-900 border-l border-gray-200 w-28 max-w-[7.5rem] overflow-hidden text-ellipsis whitespace-nowrap"
                                        style={{ backgroundColor: highlight ? '#e0f2ff' : 'transparent' }}
                                      >
                                        {pct}%
                                      </td>
                                    );
                                  })}
                                </React.Fragment>
                              );
                            })}
                          </tr>
                          {rowHasLetters && (
                            <tr className="border-b border-gray-200 hover:bg-gray-50">
                              {cuts.map((cut) => (
                                <React.Fragment key={`${rowCode}-sum-letters-${cut.code}`}>
                                  {gridCols.map((gc) => {
                                    const letters = cut.code === 'total' ? '' : (rowLettersByGridCol[gc.code]?.lettersMap?.[cut.code] || '');
                                    const highlight = !!letters;
                                    return (
                                      <td
                                        key={`${rowCode}-${cut.code}-${gc.code}-sum-letters`}
                                        className="px-2 py-1 text-[11px] font-semibold text-blue-700 text-center border-l border-gray-200 w-28 max-w-[7.5rem] overflow-hidden text-ellipsis whitespace-nowrap"
                                        style={{ backgroundColor: highlight ? '#e0f2ff' : 'transparent' }}
                                      >
                                        {letters}
                                      </td>
                                    );
                                  })}
                                </React.Fragment>
                              ))}
                            </tr>
                          )}
                        </>
                      )}
                    </React.Fragment>
                  );
                })}

                {!isMean && (
                  <>
                    {/* Total (value row) */}
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <td className="px-4 py-2 text-sm font-semibold text-gray-900 border-r border-gray-200" rowSpan={2}>
                        Total
                      </td>
                      {cuts.map((cut) => {
                        const model = modelsByCutCode[cut.code];
                        const totalsByCol = model?.totalValuesByColumn || {};
                        return (
                          <React.Fragment key={`totals-top-${cut.code}`}>
                            {gridCols.map((gc) => (
                              <td
                                key={`totals-top-${cut.code}-${gc.code}`}
                                className="px-2 py-2 text-sm text-center text-gray-900 font-medium border-l border-gray-200 w-28 max-w-[7.5rem] overflow-hidden text-ellipsis whitespace-nowrap"
                              >
                                {formatNumberLikeTables(Math.round(Number(totalsByCol[gc.code] || 0)))}
                              </td>
                            ))}
                          </React.Fragment>
                        );
                      })}
                    </tr>
                    {/* Total (% row) */}
                    <tr className="bg-gray-50 border-b border-gray-200">
                      {cuts.map((cut) => {
                        const model = modelsByCutCode[cut.code];
                        const totalsByCol = model?.totalValuesByColumn || {};
                        return (
                          <React.Fragment key={`totals-bottom-${cut.code}`}>
                            {gridCols.map((gc) => {
                              const total = Number(totalsByCol[gc.code] || 0);
                              return (
                                <td
                                  key={`totals-bottom-${cut.code}-${gc.code}`}
                                  className="px-2 py-2 text-xs text-center text-gray-900 font-medium border-l border-gray-200 w-28 max-w-[7.5rem] overflow-hidden text-ellipsis whitespace-nowrap"
                                >
                                  {total > 0 ? '100%' : '0%'}
                                </td>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

