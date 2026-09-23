"use client";

import { createContext, useContext, type ReactNode } from "react";
import { getDict, type Dict, type Locale } from "@/lib/i18n";

const LocaleContext = createContext<Locale>("en");

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export const useLocale = (): Locale => useContext(LocaleContext);

/** The dictionary for the current page's language. */
export const useT = (): Dict => getDict(useContext(LocaleContext));
