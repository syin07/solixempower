import { Section } from "./Section";

export function WarningsPanel({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <Section title={`Comparability warnings (${warnings.length})`}>
      <ul className="flex flex-col gap-2">
        {warnings.map((w) => (
          <li key={w} className="flex gap-2 rounded-md border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            <span aria-hidden className="font-bold text-amber-600">!</span>
            {w}
          </li>
        ))}
      </ul>
    </Section>
  );
}
