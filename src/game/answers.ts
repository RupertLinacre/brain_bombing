/** Accept harmless formatting differences and equivalent numeric fractions. */
export function answersMatch(input: string, expected: string): boolean {
  const normalize = (s: string) =>
    s
      .replace(/([¼½¾⅓⅔⅛⅜⅝⅞])/g, " $1")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[−–]/g, "-")
      .replace(/⁄/g, "/")
      .replace(/([+-]?\d+)\s+(\d+)\/(\d+)/g, (_, whole, n, d) =>
        Number(d) === 0
          ? "invalid"
          : String(
              Number(whole) +
                ((String(whole).startsWith("-") ? -1 : 1) * Number(n)) /
                  Number(d),
            ),
      )
      .replace(/,/g, "")
      .replace(/\s+/g, "")
      .trim();
  const a = normalize(input),
    b = normalize(expected);
  if (!a || !b) return false;
  if (a === b) return true;
  const numeric = (s: string): number | null => {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:\/[+-]?\d+(?:\.\d+)?)?$/.test(s))
      return null;
    const [n, d = "1"] = s.split("/");
    const result = Number(n) / Number(d);
    return Number.isFinite(result) ? result : null;
  };
  const x = numeric(a),
    y = numeric(b);
  return x !== null && y !== null && Math.abs(x - y) < 1e-9;
}
