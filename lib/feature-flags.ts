export const FEATURES = {
  IPFS_ENABLED: process.env.NEXT_PUBLIC_IPFS_ENABLED === '1',
  ON_CHAIN_TOKENURI: true, // always on in v2.0
} as const
