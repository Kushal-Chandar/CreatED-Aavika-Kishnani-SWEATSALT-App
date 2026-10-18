// Adds `cb` to `list` and returns a function that removes just that one
// registration (a no-op if it was already removed).
export function addListener<T>(list: T[], cb: T): () => void {
  list.push(cb);
  return () => {
    const i = list.indexOf(cb);
    if (i >= 0) list.splice(i, 1);
  };
}
