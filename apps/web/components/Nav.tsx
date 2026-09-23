"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { brand } from "@refract/config";
import { shortAddr } from "@/lib/format";
import { Logo } from "./Logo";
import { useWallet } from "./WalletProvider";

export function Nav() {
  const { addr, openModal } = useWallet();
  const [menuOpen, setMenuOpen] = useState(false);

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
        <div className="wrap">
          <Link className="brand" href="/" aria-label={`${brand.name} home`}>
            <Logo defs />
            {brand.name}
          </Link>
          <ul>
            <li>
              <a href="/#features">Product</a>
            </li>
            <li>
              <a href="/#models">Models</a>
            </li>
            <li>
              <a href="/#pricing">Pricing</a>
            </li>
            <li>
              <a href="/#token">Token</a>
            </li>
            <li>
              <Link href="/docs">Docs</Link>
            </li>
          </ul>
          <div className="right">
            <Link className="navlink" href="/dashboard">
              Dashboard
            </Link>
            <button className="btn dark sm" id="walletBtn" type="button" onClick={openModal}>
              <span className={addr ? "dot on" : "dot"} id="walletDot" />
              <span id="walletLabel">{addr ? shortAddr(addr) : "Connect wallet"}</span>
            </button>
            <button
              className="menu-btn"
              id="menuBtn"
              type="button"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
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
      <nav className={menuOpen ? "mnav open" : "mnav"} id="mnav" aria-label="Mobile">
        <a href="/#compare" onClick={close}>
          Compare
        </a>
        <a href="/#features" onClick={close}>
          Product
        </a>
        <a href="/#models" onClick={close}>
          Models
        </a>
        <a href="/#api" onClick={close}>
          API
        </a>
        <a href="/#pricing" onClick={close}>
          Pricing
        </a>
        <a href="/#token" onClick={close}>
          Token
        </a>
        <a href="/#faq" onClick={close}>
          FAQ
        </a>
        <Link href="/docs" onClick={close}>
          Docs
        </Link>
        <Link href="/dashboard" onClick={close}>
          Dashboard
        </Link>
      </nav>
    </>
  );
}
