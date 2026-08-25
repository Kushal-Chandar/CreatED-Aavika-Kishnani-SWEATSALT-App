export function SaltDivider() {
  return (
    <div className="my-7 flex items-center gap-2" aria-hidden="true">
      <div className="bg-hairline h-px flex-1 rounded-full" />
      <div className="flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="bg-hairline block h-1.5 w-1.5 rotate-45" />
        ))}
      </div>
      <div className="bg-hairline h-px flex-1 rounded-full" />
    </div>
  );
}
