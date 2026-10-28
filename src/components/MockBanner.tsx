export function MockBanner({ what }: { what: string }) {
  return (
    <div role="alert" className="rounded-md border-2 border-red-600 bg-red-50 px-4 py-2 text-sm font-semibold text-red-800">
      MOCK DATA — {what} is placeholder data, not real results.
    </div>
  );
}
