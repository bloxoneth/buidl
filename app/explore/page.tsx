import { SiteHeader } from "@/components/site-header"
import { ExploreClient } from "@/components/explore/ExploreClient"
import { Suspense } from "react"

export const metadata = {
  title: "Explore Builds | BUIDL",
  description: "Discover and browse placeholder builds in the BUIDL ecosystem",
}

export default function ExplorePage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="pt-20 pb-12">
        <Suspense fallback={null}>
          <ExploreClient />
        </Suspense>
      </main>
    </div>
  )
}
