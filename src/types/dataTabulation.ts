/**
 * Data Tabulation Type Definitions
 */

export interface BannerCut {
  id: string;
  title: string;
  variableName: string;
  codes: string[]; // Codes that belong to this cut
}

export interface BannerSubGroup {
  id: string;
  title: string;
  cuts: BannerCut[];
}

export interface BannerGroup {
  id: string;
  title: string;
  groups: BannerSubGroup[];
  confidenceLevel?: 95 | 90 | 80; // Stat testing confidence level, default 95
}
