"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { brand } from "@refract/config";
import { shortAddr } from "@/lib/format";
import { href, switchPath } from "@/lib/i18n";
import { Logo } from "./Logo";
import { useLocale, useT } from "./LocaleProvider";
import { useWallet } from "./WalletProvider";

export function Nav() {
  const { addr, openModal } = useWallet();
  const locale = useLocale();
  const t = useT().nav;
  const pathname = usePathname() ?? "/";
  const [menuOpen, setMenuOpen] = useState(false);
  const h = (path: string) => href(locale, path);
  const other = switchPath(pathname);
  const otherLang = locale === "en" ? "id" : "en";

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const close = () => setMenuOpen(false);

  // Switching language changes the root layout, so these are plain links (full page load).
  return (
    <>
      <header className="nav">
        <div className="wrap">
          <Link className="brand" href={h("/")} aria-label={t.home}>
            <Logo />
            {brand.name}
          </Link>
          <ul>
            <li>
              <a href={h("/#features")}>{t.product}</a>
            </li>
            <li>
              <a href={h("/#models")}>{t.models}</a>
            </li>
            <li>
              <a href={h("/#pricing")}>{t.pricing}</a>
            </li>
            <li>
              <a href={h("/#token")}>{t.token}</a>
            </li>
            <li>
              <Link href="/docs">{t.docs}</Link>
            </li>
          </ul>
          <div className="right">
            <a
              className="navlink lang"
              href={other}
              hrefLang={otherLang}
              lang={otherLang}
              aria-label={t.switchAria}
            >
              {t.switchShort}
            </a>
            <Link className="navlink" href={h("/dashboard")}>
              {t.dashboard}
            </Link>
            <button className="btn dark sm" id="walletBtn" type="button" onClick={openModal}>
              <span className={addr ? "dot on" : "dot"} id="walletDot" />
              <span id="walletLabel">{addr ? shortAddr(addr) : t.connect}</span>
            </button>
            <button
              className="menu-btn"
              id="menuBtn"
              type="button"
              aria-label={menuOpen ? t.closeMenu : t.openMenu}
              aria-expanded={menuOpen}
              aria-controls="mnav"
              onClick={() => setMenuOpen((o) => !o)}
            >
              <span />
              <span />
            </button>
          </div>
        </div>
      </header>
      <nav className={menuOpen ? "mnav open" : "mnav"} id="mnav" aria-label={t.mobile}>
        <a href={h("/#compare")} onClick={close}>
          {t.compare}
        </a>
        <a href={h("/#features")} onClick={close}>
          {t.product}
        </a>
        <a href={h("/#models")} onClick={close}>
          {t.models}
        </a>
        <a href={h("/#api")} onClick={close}>
          {t.api}
        </a>
        <a href={h("/#pricing")} onClick={close}>
          {t.pricing}
        </a>
        <a href={h("/#token")} onClick={close}>
          {t.token}
        </a>
        <a href={h("/#faq")} onClick={close}>
          {t.faq}
        </a>
        <Link href="/docs" onClick={close}>
          {t.docs}
        </Link>
        <Link href={h("/dashboard")} onClick={close}>
          {t.dashboard}
        </Link>
        <a className="lang" href={other} hrefLang={otherLang} lang={otherLang}>
          {t.switchLong}
        </a>
      </nav>
    </>
  );
}
