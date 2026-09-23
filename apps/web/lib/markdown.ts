/**
 * The prototype's tiny Markdown renderer, ported 1:1 from docs/refract.html.
 * Input is HTML-escaped before any markup is added, so the output is safe to inject.
 */
export const esc = (s: unknown): string =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

const inline = (s: string): string =>
  s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

export function md(src: string): string {
  let html = "";
  src.split(/```/).forEach((part, i) => {
    if (i % 2) {
      html += "<pre><code>" + esc(part.replace(/^[^\n]*\n/, "").replace(/\n$/, "")) + "</code></pre>";
      return;
    }
    let list: { t: "ul" | "ol"; items: string[] } | null = null;
    let para: string[] = [];
    const fp = () => {
      if (para.length) {
        html += "<p>" + inline(para.join(" ")) + "</p>";
        para = [];
      }
    };
    const fl = () => {
      if (list) {
        html += `<${list.t}>` + list.items.map((x) => "<li>" + inline(x) + "</li>").join("") + `</${list.t}>`;
        list = null;
      }
    };
    esc(part)
      .split("\n")
      .forEach((l) => {
        let m: RegExpMatchArray | null;
        if (!l.trim()) {
          fp();
          fl();
          return;
        }
        if ((m = l.match(/^\s*(#{1,4})\s+(.*)/))) {
          fp();
          fl();
          html += `<h3>${inline(m[2] ?? "")}</h3>`;
          return;
        }
        if ((m = l.match(/^\s*[-*•]\s+(.*)/))) {
          fp();
          if (!list || list.t !== "ul") {
            fl();
            list = { t: "ul", items: [] };
          }
          list.items.push(m[1] ?? "");
          return;
        }
        if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) {
          fp();
          if (!list || list.t !== "ol") {
            fl();
            list = { t: "ol", items: [] };
          }
          list.items.push(m[1] ?? "");
          return;
        }
        fl();
        para.push(l.trim());
      });
    fp();
    fl();
  });
  return html;
}
