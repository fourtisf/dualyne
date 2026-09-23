const NAMES = ["Anthropic", "OpenAI", "Google", "Meta", "Mistral", "DeepSeek", "Qwen", "xAI", "Cohere"];

export function Logos() {
  return (
    <section className="logos">
      <div className="wrap">
        <p>One catalog for the models teams actually use</p>
        <div className="marquee">
          <div className="track">
            <ul>
              {NAMES.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            <ul aria-hidden="true">
              {NAMES.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
