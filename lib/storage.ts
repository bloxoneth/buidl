export type SavedBuild = {
  id: string
  name: string
  bricks: any[]
  timestamp: number
  walletAddress: string
  baseWidth: number
  baseDepth: number
}

const STORAGE_KEY = "buidl_saves"

export function saveBuild(
  name: string,
  bricks: any[],
  walletAddress: string,
  baseWidth: number,
  baseDepth: number,
  existingId?: string,
): void {
  if (typeof window === "undefined") return
  if (!walletAddress) {
    throw new Error("Wallet address required to save build")
  }

  const allSaves = loadAllBuilds()
  
  // Check if we're updating an existing build (by ID)
  const existingIndex = existingId 
    ? allSaves.findIndex(s => s.id === existingId && s.walletAddress?.toLowerCase() === walletAddress.toLowerCase())
    : -1
  
  if (existingIndex >= 0) {
    // Update existing build
    allSaves[existingIndex] = {
      ...allSaves[existingIndex],
      name,
      bricks,
      timestamp: Date.now(),
      baseWidth,
      baseDepth,
    }
  } else {
    // Create new build
    const newSave: SavedBuild = {
      id: Date.now().toString(),
      name,
      bricks,
      timestamp: Date.now(),
      walletAddress: walletAddress.toLowerCase(),
      baseWidth,
      baseDepth,
    }
    allSaves.push(newSave)
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(allSaves))
}

export function loadBuild(walletAddress?: string): SavedBuild[] {
  if (typeof window === "undefined") return []
  if (!walletAddress) return []

  try {
    const allSaves = loadAllBuilds()
    // Filter by wallet address
    return allSaves.filter((s) => s.walletAddress?.toLowerCase() === walletAddress.toLowerCase())
  } catch {
    return []
  }
}

function loadAllBuilds(): SavedBuild[] {
  if (typeof window === "undefined") return []

  try {
    const data = localStorage.getItem(STORAGE_KEY)
    return data ? JSON.parse(data) : []
  } catch {
    return []
  }
}

export function loadBuildById(id: string): SavedBuild | null {
  if (typeof window === "undefined") return null
  
  try {
    const allSaves = loadAllBuilds()
    return allSaves.find((s) => s.id === id) || null
  } catch {
    return null
  }
}

export function deleteBuild(id: string, walletAddress: string): void {
  if (typeof window === "undefined") return
  if (!walletAddress) return

  const allSaves = loadAllBuilds()
  // Only delete if owned by the wallet
  const filtered = allSaves.filter(
    (s) => !(s.id === id && s.walletAddress?.toLowerCase() === walletAddress.toLowerCase()),
  )
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered))
}
