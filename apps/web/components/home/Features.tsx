import type { CSSProperties } from "react";
import { brand } from "@refract/config";

const bar = (w: string, c: string) => ({ "--w": w, "--c": c }) as CSSProperties;

export function Features() {
  return (
    <section className="block" id="features">
      <div className="wrap">
        <div className="head">
          <div className="kick">
            <i />
            Product
          </div>
          <h2>Built for choosing, then shipping.</h2>
          <p>Everything you need to find the right model and put it to work, without a single signup form.</p>
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
              <h3>See speed and quality in the same view</h3>
              <p>
                Every run shows time to first word, total time and length for each model, next to the answer
                itself.
              </p>
            </div>
          </div>
          <div className="tile w2">
            <div className="viz">
              <div className="keycard" aria-hidden="true">
                <div className="top">
                  <span>{brand.name} key</span>
                  <span className="on">Active</span>
                </div>
                <div className="k">{brand.keyPrefix}8c3f…a91e</div>
                <div className="w">
                  <span>0x71C4…9A2f</span>
                  <span>Holder</span>
                </div>
              </div>
            </div>
            <div className="txt">
              <h3>Your wallet is your account</h3>
              <p>No email, no card. Sign once, create keys, revoke them any time.</p>
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
              <h3>A one-line migration</h3>
              <p>
                {brand.name} uses the OpenAI format. Change the base URL and your app, bot or agent keeps
                working.
              </p>
            </div>
          </div>
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
              <h3>Free access, paid for in public</h3>
              <p>
                Trading fees fill a treasury that covers everyone&apos;s free requests. Every dollar in and
                out is on the ledger.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
