"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

const docsLinks = [
  { slug: "overview", label: "Overview" },
  { slug: "protocol", label: "Protocol" },
  { slug: "building", label: "Building" },
  { slug: "tokenomics", label: "Tokenomics" },
  { slug: "gameplay", label: "Gameplay" },
  { slug: "smart-contracts", label: "Smart Contracts" },
  { slug: "api", label: "API" },
  { slug: "faq", label: "FAQ" },
  { slug: "changelog", label: "Changelog" },
]

export function DocsNav() {
  const pathname = usePathname()

  return (
    <nav className="space-y-2 sticky top-24 self-start">
      <h3 className="text-sm font-heading font-semibold text-[hsl(var(--buidl-text-primary))] mb-4">Documentation</h3>
      {docsLinks.map((link) => {
        const isActive = pathname === `/docs/${link.slug}`
        return (
          <Link
            key={link.slug}
            href={`/docs/${link.slug}`}
            className={cn(
              "block px-3 py-2 text-sm rounded transition-colors",
              isActive
                ? "bg-[hsl(var(--buidl-surface-elevated))] text-[hsl(var(--buidl-accent-cyan))]"
                : "text-[hsl(var(--buidl-text-secondary))] hover:bg-[hsl(var(--buidl-surface))] hover:text-[hsl(var(--buidl-text-primary))]",
            )}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
