import type { CSSProperties } from "react";
import { brand } from "@dualyne/config";
import { getDict, type Locale } from "@/lib/i18n";

const bar = (w: string, c: string) => ({ "--w": w, "--c": c }) as CSSProperties;

export function Features({ locale }: { locale: Locale }) {
  const t = getDict(locale).features;
  return (
    <section className="block" id="features">
      <div className="wrap">
        <div className="head">
          <div className="kick">
            <i />
            {t.kick}
          </div>
          <h2>{t.h2}</h2>
          <p>{t.p}</p>
        </div>
        <div className="bento">
          <div className="tile w4">
            <div className="viz">
              <div className="race" aria-hidden="true">
                <div className="r">
                  <span>Claude Swift</span>
                  <div className="track">
                    <i style={bar("28%", "var(--cyan)")} />
                  </div>
                  <span className="ms">0.4s</span>
                </div>
                <div className="r">
                  <span>Gemini</span>
                  <div className="track">
                    <i style={bar("41%", "var(--amber)")} />
                  </div>
                  <span className="ms">0.6s</span>
                </div>
                <div className="r">
                  <span>GPT</span>
                  <div className="track">
                    <i style={bar("55%", "var(--pink)")} />
                  </div>
                  <span className="ms">0.8s</span>
                </div>
                <div className="r">
                  <span>Claude Deep</span>
                  <div className="track">
                    <i style={bar("86%", "var(--violet)")} />
                  </div>
                  <span className="ms">1.3s</span>
                </div>
              </div>
            </div>
            <div className="txt">
              <h3>{t.speedTitle}</h3>
              <p>{t.speedText}</p>
            </div>
          </div>
          <div className="tile w2">
            <div className="viz">
              <div className="keycard" aria-hidden="true">
                <div className="top">
                  <span>{t.keyLabel}</span>
                  <span className="on">{t.active}</span>
                </div>
                <div className="k">{brand.keyPrefix}8c3f…a91e</div>
                <div className="w">
                  <span>0x71C4…9A2f</span>
                  <span>{brand.tokenEnabled ? "Holder" : "Explorer"}</span>
                </div>
              </div>
            </div>
            <div className="txt">
              <h3>{t.walletTitle}</h3>
              <p>{t.walletText}</p>
            </div>
          </div>
          <div className="tile w3">
            <div className="viz">
              <div className="mini" aria-hidden="true">
                {"client = OpenAI(\n"}
                <span className="d">{'  base_url="https://api.openai.com/v1",'}</span>
                <span className="a">{`  base_url="${brand.apiBaseUrl}",`}</span>
                {"  api_key=KEY,\n)"}
              </div>
            </div>
            <div className="txt">
              <h3>{t.migrateTitle}</h3>
              <p>{t.migrateText}</p>
            </div>
          </div>
          {brand.tokenEnabled ? (
            <div className="tile w3">
              <div className="viz">
                <svg className="spark" viewBox="0 0 400 130" preserveAspectRatio="none" aria-hidden="true">
                  <defs>
                    <linearGradient id="sf" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#8B5CF6" stopOpacity=".35" />
                      <stop offset="1" stopColor="#8B5CF6" stopOpacity="0" />
                    </linearGradient>
                    <linearGradient id="ss" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0" stopColor="#67E8F9" />
                      <stop offset="1" stopColor="#A78BFA" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M0 110 C40 104 60 96 90 90 S150 70 180 74 240 52 270 46 330 36 360 26 390 18 400 16 L400 130 L0 130Z"
                    fill="url(#sf)"
                  />
                  <path
                    d="M0 110 C40 104 60 96 90 90 S150 70 180 74 240 52 270 46 330 36 360 26 390 18 400 16"
                    fill="none"
                    stroke="url(#ss)"
                    strokeWidth="2"
                  />
                  <circle cx="400" cy="16" r="4" fill="#A78BFA" />
                </svg>
              </div>
              <div className="txt">
                <h3>{t.treasuryTitle}</h3>
                <p>{t.treasuryText}</p>
              </div>
            </div>
          ) : (
            <div className="tile w3">
              <div className="viz">
                <div className="tgmini" aria-hidden="true">
                  <div className="me">What is an API? Keep it short</div>
                  <div className="bot">
                    An <b>API</b> is a bridge that lets two apps talk to each other.
                    <small>Claude Swift</small>
                  </div>
                  <div className="btns">
                    <span>Try again</span>
                    <span>Other model</span>
                    <span>Compare</span>
                    <span>New chat</span>
                  </div>
                </div>
              </div>
              <div className="txt">
                <h3>{t.telegramTitle}</h3>
                <p>{t.telegramText}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
