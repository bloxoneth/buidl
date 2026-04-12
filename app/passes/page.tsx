import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { AccessPassClient } from "@/components/passes/AccessPassClient"

export default function PassesPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="pt-20 container mx-auto px-6 max-w-[1800px] py-10">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-5xl md:text-6xl font-heading font-bold text-[hsl(var(--buidl-blue))] mb-4">
            BUIDL Genesis Access
          </h1>
          <p className="text-lg text-[hsl(var(--buidl-text-secondary))] mb-8">
            Mint the launch access pass collection, receive BLOX, and unlock participation rights for MVP build
            access and mainnet-first mint pathways.
          </p>
          <AccessPassClient />
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
