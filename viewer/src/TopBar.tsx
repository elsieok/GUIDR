import { useState, type FormEvent } from "react";

interface Props {
  chromName: string | null;
  geneName: string | null;
  guideLabel: string | null;
  canGoBack: boolean;
  status: string;                         // an error or progress message ("" when there is nothing to say)
  onSearch: (mode: "gene" | "region", text: string) => void;
  onGoGenome: () => void;                 // whole chromosome
  onGoGene: () => void;                   // zoom back to the selected gene
  onBack: () => void;                     // previous view
}

/** Search box (gene or region), the Back button, and the breadcrumb Genome > chromosome > gene > guide. */
export function TopBar(props: Props) {
  const { chromName, geneName, guideLabel, canGoBack, status, onSearch, onGoGenome, onGoGene, onBack } = props;
  const [mode, setMode] = useState<"gene" | "region">("gene");
  const [text, setText] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();                   // a form submit would reload the page
    if (text.trim()) onSearch(mode, text.trim());
  };

  return (
    <header className="topbar">
      <form onSubmit={submit} className="search">
        <select value={mode} onChange={(e) => setMode(e.target.value as "gene" | "region")} aria-label="Search type">
          <option value="gene">Gene</option>
          <option value="region">Region</option>
        </select>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={mode === "gene" ? "lacZ or b0344" : "1,000-5,000 or NC_000913.3:1000-5000"}
          aria-label="Search"
        />
        <button type="submit">Search</button>
        <button type="button" onClick={onBack} disabled={!canGoBack}>Back</button>
      </form>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <button type="button" onClick={onGoGenome}>Genome</button>
        {chromName && <><span>›</span><button type="button" onClick={onGoGenome}>{chromName}</button></>}
        {geneName && <><span>›</span><button type="button" onClick={onGoGene}>{geneName}</button></>}
        {guideLabel && <><span>›</span><span className="crumb-current">{guideLabel}</span></>}
      </nav>
      {status && <div className="status" role="status">{status}</div>}
    </header>
  );
}
