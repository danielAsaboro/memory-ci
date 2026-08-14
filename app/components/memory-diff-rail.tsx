export function MemoryDiffRail({ before, after }: { before: string; after: string }) {
  return <div className="diff-rail" aria-label="Memory content diff"><div className="diff-side removed"><span>−</span><div><small>Active memory · before</small><p>{before}</p></div></div><div className="diff-side added"><span>+</span><div><small>Candidate · after</small><p>{after}</p></div></div></div>;
}
