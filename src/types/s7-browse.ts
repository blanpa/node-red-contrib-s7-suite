export type S7BlockType = 'OB' | 'DB' | 'SDB' | 'FC' | 'SFC' | 'FB' | 'SFB';

export interface S7BlockList {
  OBCount: number;
  DBCount: number;
  SDBCount: number;
  FCCount: number;
  SFCCount: number;
  FBCount: number;
  SFBCount: number;
}

export interface S7BlockInfo {
  blockType: S7BlockType;
  blockNumber: number;
  sizeData: number;
  author?: string;
  family?: string;
  name?: string;
  version?: string;
  date?: string;
}

export type BrowseScope = 'DB' | 'M' | 'I' | 'Q';

export interface BrowseOptions {
  scope: BrowseScope[];
  maxDbNumber?: number;
  onProgress?: (progress: BrowseProgress) => void;
}

export interface BrowseProgress {
  phase: string;
  current: number;
  total: number;
  percent: number;
}

export interface BrowseResult {
  cpuInfo?: Record<string, unknown>;
  blocks: S7BlockInfo[];
  areas: AreaInfo[];
}

export interface AreaInfo {
  area: string;
  size: number;
}
