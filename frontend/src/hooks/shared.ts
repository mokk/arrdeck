import type { ServiceBlock, TorrentGroup } from "../api/types";

// Poll cadences shared by every hook module.
export const FAST = 5_000;
export const MEDIUM = 30_000;
export const SLOW = 300_000;

export type TorrentsCache = {
  qbittorrent: ServiceBlock<TorrentGroup>;
  transmission: ServiceBlock<TorrentGroup>;
};
