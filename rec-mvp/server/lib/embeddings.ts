export async function embedNormalized(text: string): Promise<number[]> {
  const dim = 384;
  const v = Array.from({length: dim}, (_, i) => Math.sin(i + text.length));
  const n = Math.hypot(...v);
  return v.map(x => (n ? x / n : x));
}
