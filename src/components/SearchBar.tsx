"use client";

import { useState } from "react";

export function SearchBar({
  initialCandidate,
  initialDisease,
  busy,
  onSubmit,
}: {
  initialCandidate: string;
  initialDisease: string;
  busy: boolean;
  onSubmit: (candidate: string, disease: string) => void;
}) {
  const [candidate, setCandidate] = useState(initialCandidate);
  const [disease, setDisease] = useState(initialDisease);
  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        if (candidate.trim()) onSubmit(candidate.trim(), disease.trim());
      }}
    >
      <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-zinc-700">
        Drug candidate (name or ChEMBL ID)
        <input
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 focus:border-blue-600 focus:outline-none"
          value={candidate}
          onChange={(e) => setCandidate(e.target.value)}
          placeholder="e.g. poziotinib or CHEMBL3545154"
        />
      </label>
      <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-zinc-700">
        Disease
        <input
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 focus:border-blue-600 focus:outline-none"
          value={disease}
          onChange={(e) => setDisease(e.target.value)}
          placeholder="e.g. non-small cell lung cancer"
        />
      </label>
      <button
        type="submit"
        disabled={busy || !candidate.trim()}
        className="rounded-md bg-blue-600 px-5 py-2 text-base font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {busy ? "Building…" : "Build graph"}
      </button>
    </form>
  );
}
