import { describe, expect, it } from "vitest";
import { md } from "../lib/markdown";

describe("md()", () => {
  it("renders the prototype's subset", () => {
    expect(md("### Title\nSome **bold** and `code`.")).toBe(
      "<h3>Title</h3><p>Some <strong>bold</strong> and <code>code</code>.</p>",
    );
    expect(md("1. one\n2. two")).toBe("<ol><li>one</li><li>two</li></ol>");
    expect(md("- a\n- b")).toBe("<ul><li>a</li><li>b</li></ul>");
    expect(md("```js\nconst x = 1;\n```")).toBe("<pre><code>const x = 1;</code></pre>");
  });

  it("escapes HTML so model output can never inject markup", () => {
    const out = md("<img src=x onerror=alert(1)> **<b>x</b>** `<script>`\n```\n</code><script>\n```");
    expect(out).not.toMatch(/<img|<script|<b>/);
    expect(out).toContain("&lt;img");
  });
});
