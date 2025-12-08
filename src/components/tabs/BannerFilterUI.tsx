import React from 'react';
import { BannerConditionGroup } from '../../types/dataTabulation';
import { Variable } from '../../utils/tabs/types';
import BannerFilterConfig from '../BannerFilterConfig';

interface BannerFilterUIProps {
  filterConditions: BannerConditionGroup[] | null;
  onChange: (conditions: BannerConditionGroup[] | null) => void;
  variables: Variable[];
  rawData?: { rows: any[]; columns: string[] } | null;
  columnMapping?: Record<string, string>;
}

export const BannerFilterUI: React.FC<BannerFilterUIProps> = ({
  filterConditions,
  onChange,
  variables,
  rawData,
  columnMapping,
}) => {
  return (
    <BannerFilterConfig
      variables={variables}
      filterConditions={filterConditions}
      onFilterChange={onChange}
      rawData={rawData}
      columnMapping={columnMapping}
    />
  );
};
