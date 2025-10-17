import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { supabase } from './supabase';

/** ===== datetime-local helpers (ISO <-> local) ===== */
function isoToLocalInput(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function localInputToIso(localVal: string) {
  return new Date(localVal).toISOString();
}

/** ===== fuzzy text helpers ===== */
const SYNONYMS: Record<string, string[]> = {
  movie: ['film', 'cinema', 'movies', 'movie night'],
  movies: ['movie', 'film', 'cinema', 'movie night'],
  volleyball: ['volley'],
  'board game': ['boardgame', 'tabletop'],
  boardgame: ['board game', 'tabletop'],
  poker: ['cards', 'poker night'],
};
function normalizeWord(w: string) {
  let s = w.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
  if (s.endsWith('s') && s.length > 3) s = s.slice(0, -1); // naive singularization
  return s;
}
function expandTerms(terms: string[]) {
  const out = new Set<string>();
  for (const t of terms) {
    const n = normalizeWord(t);
    if (!n) continue;
    out.add(n);
    if (SYNONYMS[n]) for (const syn of SYNONYMS[n]) out.add(normalizeWord(syn));
  }
  return [...out];
}
function tokenizeText(text: string) {
  return normalizeWord(text).split(/\s+/).filter(Boolean);
}
function tokenJaccard(aTokens: string[], bTokens: string[]) {
  const a = new Set(aTokens), b = new Set(bTokens);
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = new Set([...a, ...b]).size;
  return uni ? inter / uni : 0;
}
function substringHit(aTokens: string[], bTokens: string[]) {
  for (const q of aTokens) {
    for (const e of bTokens) {
      if (q.length >= 3 && (e.includes(q) || q.includes(e))) return 1;
    }
  }
  return 0;
}
/** fraction (0..1) of EVENT that lies inside availability window */
function timeOverlapFrac(aStart: number, aEnd: number, eStart: number, eEnd: number) {
  const overlap = Math.max(0, Math.min(aEnd, eEnd) - Math.max(aStart, eStart));
  const eventSpan = Math.max(1, eEnd - eStart);
  return Math.max(0, Math.min(1, overlap / eventSpan));
}

/** ===== types ===== */
type EventRow = {
  id: string;
  name: string;
  start_ts: string;
  end_ts: string;
  tags: string[];
  attendees: string[] | null;
};

export default function App() {
  /** Admin inputs */
  const [name, setName] = useState('Catan Night');
  const [tags, setTags] = useState('board game, social');
  const [start, setStart] = useState(dayjs().add(1, 'day').hour(19).minute(0).second(0).toISOString());
  const [end, setEnd] = useState(dayjs().add(1, 'day').hour(21).minute(0).second(0).toISOString());

  /** User inputs */
  const [aStart, setAStart] = useState(dayjs().add(1, 'day').hour(18).minute(0).second(0).toISOString());
  const [aEnd, setAEnd] = useState(dayjs().add(1, 'day').hour(22).minute(0).second(0).toISOString());
  const [qTags, setQTags] = useState('movie, volleyball');
  const [k, setK] = useState<number>(5); // how many suggestions

  /** Data + UI */
  const [events, setEvents] = useState<EventRow[]>([]);
  const [suggs, setSuggs] = useState<EventRow[]>([]);
  const [loadingAdd, setLoadingAdd] = useState(false);
  const [loadingSug, setLoadingSug] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const qTagArr = useMemo(
    () => qTags.split(',').map(s => s.trim()).filter(Boolean),
    [qTags]
  );

  useEffect(() => {
    fetchEvents();
  }, []);

  /** Load events (cap 500 for demo) */
  async function fetchEvents() {
    setErrorMsg(null);
    const { data, error } = await supabase
      .from('events')
      .select('id,name,start_ts,end_ts,tags,attendees')
      .order('start_ts', { ascending: true })
      .limit(500);
    if (error) {
      setErrorMsg(`Fetch error: ${error.message}`);
      console.error(error);
      return;
    }
    setEvents(data || []);
    setInfoMsg(`Loaded ${data?.length ?? 0} events`);
  }

  /** Admin add */
  async function addEvent() {
    setErrorMsg(null);
    if (!name) { setErrorMsg('Name required'); return; }
    if (new Date(end) <= new Date(start)) { setErrorMsg('End must be after start'); return; }
    setLoadingAdd(true);
    try {
      const tagsArr = tags.split(',').map(s => s.trim()).filter(Boolean);
      const { error } = await supabase.from('events').insert({
        name, tags: tagsArr, start_ts: start, end_ts: end
      });
      if (error) throw error;
      setName('');
      await fetchEvents();
      setInfoMsg('Event added');
    } catch (e: any) {
      setErrorMsg(e.message || String(e));
    } finally {
      setLoadingAdd(false);
    }
  }

  /** Suggest with fuzzy text + partial overlap + diversity */
  async function getSuggestions() {
    setErrorMsg(null);
    setInfoMsg(null);
    setLoadingSug(true);
    try {
      if (events.length === 0) {
        await fetchEvents();
      }
      const A0 = Date.parse(aStart), A1 = Date.parse(aEnd);
      if (!(A1 > A0)) {
        setErrorMsg('Availability end must be after start.');
        return;
      }

      // candidates: any event with at least 20% of its duration inside availability
      const candidates = events.map(r => {
        const s = Date.parse(r.start_ts), e = Date.parse(r.end_ts);
        return { row: r, overlapFrac: timeOverlapFrac(A0, A1, s, e) };
      }).filter(x => x.overlapFrac > 0.2);

      if (candidates.length === 0) {
        setSuggs([]);
        setInfoMsg('No events overlap your availability. Try widening the window or add events.');
        return;
      }

      const qExpanded = expandTerms(qTagArr);
      const qTokens = qExpanded.flatMap(tokenizeText);

      const scored = candidates.map(({ row, overlapFrac }) => {
        const text = `${row.name} ${(row.tags || []).join(' ')}`;
        const eTokens = tokenizeText(text);
        const j = tokenJaccard(qTokens, eTokens);          // 0..1
        const sub = substringHit(qTokens, eTokens) ? 0.15 : 0; // small bonus
        const pop = Math.log1p((row.attendees || []).length);
        const textScore = Math.min(1, j + sub);

        // weights: text 0.55, time 0.30, pop 0.15
        const score = 0.55 * textScore + 0.30 * overlapFrac + 0.15 * pop;

        return { row, score, textScore, overlapFrac };
      }).sort((a, b) => b.score - a.score);

      // diversity (MMR) on top 30, choose k
      const pool = scored.slice(0, 30);
      const out: EventRow[] = [];
      const λ = 0.7;
      while (pool.length && out.length < k) {
        let bi = 0, bv = -1e9;
        for (let i = 0; i < pool.length; i++) {
          const e = pool[i];
          const sim = out.length ? Math.max(...out.map(x => {
            const A = new Set((e.row.tags || []).map(t => normalizeWord(t)));
            const B = new Set((x.tags || []).map(t => normalizeWord(t)));
            let inter = 0; for (const t of A) if (B.has(t)) inter++;
            const uni = new Set([...A, ...B]).size;
            return uni ? inter / uni : 0;
          })) : 0;
          const val = λ * e.score - (1 - λ) * sim;
          if (val > bv) { bv = val; bi = i; }
        }
        out.push(pool.splice(bi, 1)[0].row);
      }

      setSuggs(out);
      setInfoMsg(`Found ${out.length} suggestion(s) from ${candidates.length} overlapping events`);
    } catch (e: any) {
      setErrorMsg(e.message || String(e));
      console.error(e);
    } finally {
      setLoadingSug(false);
    }
  }

  return (
    <div style={{ maxWidth: 980, margin: '24px auto', padding: 16, fontFamily: 'ui-sans-serif, system-ui' }}>
      <h2>MVP: Events Recommender (Web)</h2>

      {(errorMsg || infoMsg) && (
        <div style={{ marginBottom: 12 }}>
          {errorMsg && <div style={{ color: '#b00020', marginBottom: 6 }}>Error: {errorMsg}</div>}
          {infoMsg && <div style={{ color: '#006400' }}>{infoMsg}</div>}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Admin */}
        <section style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
          <h3>Admin: Add Event</h3>
          <label>Name</label>
          <input value={name} onChange={e => setName(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
          <label>Tags (comma-separated)</label>
          <input value={tags} onChange={e => setTags(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
          <label>Start</label>
          <input
            type="datetime-local"
            value={isoToLocalInput(start)}
            onChange={e => setStart(localInputToIso(e.target.value))}
            style={{ width: '100%', marginBottom: 8 }}
          />
          <label>End</label>
          <input
            type="datetime-local"
            value={isoToLocalInput(end)}
            min={isoToLocalInput(start)}
            onChange={e => setEnd(localInputToIso(e.target.value))}
            style={{ width: '100%', marginBottom: 8 }}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={addEvent} disabled={loadingAdd}>{loadingAdd ? 'Saving…' : 'Add Event'}</button>
            <button onClick={fetchEvents} type="button">Reload Events</button>
          </div>
        </section>

        {/* User */}
        <section style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
          <h3>User: Get Suggestions</h3>
          <label>Availability start</label>
          <input
            type="datetime-local"
            value={isoToLocalInput(aStart)}
            onChange={e => setAStart(localInputToIso(e.target.value))}
            style={{ width: '100%', marginBottom: 8 }}
          />
          <label>Availability end</label>
          <input
            type="datetime-local"
            value={isoToLocalInput(aEnd)}
            min={isoToLocalInput(aStart)}
            onChange={e => setAEnd(localInputToIso(e.target.value))}
            style={{ width: '100%', marginBottom: 8 }}
          />
          <label>Tags (comma-separated)</label>
          <input value={qTags} onChange={e => setQTags(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
          <label>How many suggestions?</label>
          <input
            type="number"
            min={1}
            max={20}
            value={k}
            onChange={(e) => setK(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
            style={{ width: 120, marginBottom: 8 }}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={getSuggestions} disabled={loadingSug}>{loadingSug ? 'Scoring…' : 'Get Suggestions'}</button>
            <button onClick={fetchEvents} type="button">Load Events</button>
          </div>
        </section>
      </div>

      {/* Results */}
      <section style={{ marginTop: 24 }}>
        <h3>Suggestions</h3>
        {suggs.length === 0 && <div style={{ opacity: 0.7 }}>No suggestions yet — add/load events, ensure your window overlaps, then click “Get Suggestions”.</div>}
        {suggs.map(e => (
          <div key={e.id} style={{ border: '1px solid #eee', borderRadius: 8, padding: 12, marginBottom: 8 }}>
            <strong>{e.name}</strong>
            <div>{new Date(e.start_ts).toLocaleString()} → {new Date(e.end_ts).toLocaleString()}</div>
            <div>Tags: {(e.tags || []).join(', ')}</div>
            <div>Attendees: {(e.attendees || []).length}</div>
          </div>
        ))}
      </section>

      {/* All Events (debug) */}
      <section style={{ marginTop: 24 }}>
        <h3>All Events (debug)</h3>
        <button onClick={fetchEvents}>Refresh</button>
        <ul>
          {events.map(e => (
            <li key={e.id}>
              {e.name} — {e.tags?.join(', ')} — {new Date(e.start_ts).toLocaleString()}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
