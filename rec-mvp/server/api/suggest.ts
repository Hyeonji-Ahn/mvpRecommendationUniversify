import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { embedNormalized } from '../lib/embeddings';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function timeFit(aStartISO: string, aEndISO: string, sISO: string, eISO: string) {
  const A0 = Date.parse(aStartISO), A1 = Date.parse(aEndISO);
  const s = Date.parse(sISO), e = Date.parse(eISO);
  const span = Math.max(1, (A1 - A0) / 1000);
  const leftover = Math.max(0, (A1 - e)/1000 + (s - A0)/1000);
  return Math.max(0, 1 - leftover / span);
}
const jaccard = (A: string[] = [], B: string[] = []) => {
  const a = new Set(A), b = new Set(B);
  const inter = [...a].filter(x => b.has(x)).length;
  const uni = new Set([...A, ...B]).size;
  return uni ? inter/uni : 0;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  try {
    const { aStart, aEnd, tags, k = 5 } = req.body || {};
    if (!aStart || !aEnd || !Array.isArray(tags) || !tags.length) {
      return res.status(400).send('Bad Request');
    }

    // 1) Build query embedding
    const qv = await embedNormalized(`Interested in: ${tags.join(', ')}.`);

    // 2) Fetch candidates from Supabase RPC
    const { data, error } = await supabase.rpc('recommend_raw', {
      p_a_start: aStart, p_a_end: aEnd, p_qvec: qv
    });
    if (error) throw error;

    // 3) Score + diversify
    const rows = (data as any[]).map(r => {
      const tf = timeFit(aStart, aEnd, r.start_ts, r.end_ts);
      const pop = Math.log1p((r.attendees || []).length);
      const score = 0.6*r.embed_sim + 0.2*tf + 0.2*pop;
      return { ...r, _score: score };
    }).sort((a,b)=> b._score - a._score).slice(0, 30);

    const λ = 0.7;
    const out:any[] = [];
    while (rows.length && out.length < k) {
      let best = 0, bestVal = -1e9;
      for (let i=0;i<rows.length;i++){
        const e = rows[i];
        const sim = out.length ? Math.max(...out.map(x => jaccard(e.tags, x.tags))) : 0;
        const val = λ*e._score - (1-λ)*sim;
        if (val > bestVal) { bestVal = val; best = i; }
      }
      out.push(rows.splice(best,1)[0]);
    }

    const suggestions = out.map(r => ({
      id:r.id, name:r.name, start:r.start_ts, end:r.end_ts,
      tags:r.tags, attendeesCount:(r.attendees||[]).length,
      score:Number(r._score.toFixed(3)),
      reason:`Semantic match; good time fit; ${(r.attendees||[]).length} attending`
    }));
    res.status(200).json({ suggestions });
  } catch (e:any) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
