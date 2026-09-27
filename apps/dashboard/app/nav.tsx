"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Dynimo's" },
  { href: "/personen", label: "Personen" },
  { href: "/model", label: "Model" },
  { href: "/grafschriften", label: "Grafschriften" },
];

// Actief = deze pagina, of een Dynimo-pagina onder "Dynimo's".
function isActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/dynimo/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="nav" aria-label="Hoofdnavigatie">
      <Link href="/" className="nav-mark">
        Animus
      </Link>
      <ul>
        {LINKS.map((link) => (
          <li key={link.href}>
            <Link href={link.href} aria-current={isActive(link.href, pathname) ? "page" : undefined}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
