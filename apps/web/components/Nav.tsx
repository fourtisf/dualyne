"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { brand } from "@dualyne/config";
import { shortAddr } from "@/lib/format";
import { href } from "@/lib/i18n";
import { Logo } from "./Logo";
import { TopBar } from "./TopBar";
import { useLocale, useT } from "./LocaleProvider";
import { useWallet } from "./WalletProvider";

export function Nav() {
  const { addr, openModal } = useWallet();
  const locale = useLocale();
  const t = useT().nav;
  const [menuOpen, setMenuOpen] = useState(false);
  const h = (path: string) => href(locale, path);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const close = () => setMenuOpen(false);

  return (
    <>
      <header className="nav">
        <TopBar />
        <div className="wrap">
          <Link className="brand" href={h("/")} aria-label={t.home}>
            <Logo />
            {brand.name}
          </Link>
          <ul>
            <li>
              <Link href="/chat">{t.chat}</Link>
            </li>
            <li>
              <a href={h("/#compare")}>{t.compare}</a>
            </li>
            <li>
              <a href={h("/#features")}>{t.product}</a>
            </li>
            <li>
              <a href={h("/#models")}>{t.models}</a>
            </li>
            <li>
              <a href={h("/#pricing")}>{t.pricing}</a>
            </li>
            {brand.tokenEnabled && (
              <li>
                <a href={h("/#token")}>{t.token}</a>
              </li>
            )}
            <li>
              <Link href="/docs">{t.docs}</Link>
            </li>
          </ul>
          <div className="right">
            <Link className="navlink" href={h("/dashboard")}>
              {t.dashboard}
            </Link>
            <button className="btn dark sm nav-wallet" id="walletBtn" type="button" onClick={openModal}>
              <span className={addr ? "dot on" : "dot"} id="walletDot" />
              <span id="walletLabel">{addr ? shortAddr(addr) : t.connect}</span>
            </button>
            <Link className="btn sm nav-cta" href="/chat">
              {t.start}
            </Link>
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
        <Link href="/chat" onClick={close}>
          {t.chat}
        </Link>
        <a href={h("/#compare")} onClick={close}>
          {t.compare}
        </a>
        <a href={h("/#features")} onClick={close}>
          {t.product}
        </a>
        <a href={h("/#models")} onClick={close}>
          {t.models}
        </a>
        <a href="/docs" onClick={close}>
          {t.api}
        </a>
        <a href={h("/#pricing")} onClick={close}>
          {t.pricing}
        </a>
        {brand.tokenEnabled && (
          <a href={h("/#token")} onClick={close}>
            {t.token}
          </a>
        )}
        <a href={h("/#faq")} onClick={close}>
          {t.faq}
        </a>
        <Link href="/docs" onClick={close}>
          {t.docs}
        </Link>
        <Link href={h("/dashboard")} onClick={close}>
          {t.dashboard}
        </Link>
        <button type="button" className="mnav-wallet" onClick={() => (close(), openModal())}>
          {addr ? shortAddr(addr) : t.connect}
        </button>
      </nav>
    </>
  );
}
