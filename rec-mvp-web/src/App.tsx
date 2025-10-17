import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { supabase } from './supabase';

type EventRow = {
  id: string;
  name: string;
  start_ts: string;
  end_ts: string;
  tags: string[];
  attendees: string[] | null;
};

export default function App() {
  // Admin inputs
  const [name, setName] = useState('Catan Night');
  const [tags, setTags] = useState('board game, social');
  const [start, setStart] = useState(dayjs().add(1,'day').hour(19).minute(0).second(0).toISOString());
  const [end, setEnd] = useState(dayjs().add(1,'day').hour(21).minute(0).second(0).toISOString());

  // User inputs
  const [aStart, setAStart] = useState(dayjs().add(1,'day').hour(18).minute(0).second(0).toISOString());
  const [aEnd, setAEnd] = useState(dayjs().add(1,'day').hour(22).minute(0).second(0).toISOString());
  const [qTags, setQTags] = useState('board game, volleyball');

  const [events, setEvents] = useState<EventRow[]>([]);
  const [suggs, setSuggs] = useState<EventRow[]>([]);
  const [loadingAdd, setLoadingAdd] = useState(false);
  const [loadingSug, setLoadingSug] = useState(false);

  const qTagArr = useMemo(
    () => qTags.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean),
    [qTags]
  );

  async function addEvent() {
    if (!name) return alert('Name required');
    if (new Date(end) <= new Date(start)) return alert('End must be after start');
    setLoadingAdd(true);
    try {
      const tagsArr = tags.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
      const { error } = await supabase.from('events').insert({
        name, tags: tagsArr, start_ts: start, end_ts: end
      });
      if (error) throw error;
      alert('Event added!');
      setName('');
      await fetchEvents(); // refresh list
    } catch (e:any) {
      alert(e.message || String(e));
    } finally {
      setLoadingAdd(false);
    }
  }

  async function fetchEvents() {
    const { data, error } = await supabase
      .from('events')
      .select('id,name,start_ts,end_ts,tags,attendees')
      .order('start_ts', { ascending: true })
      .limit(200);
    if (error) { console.error(error); return; }
    setEvents(data || []);
  }

  // Simple in-browser ranking: Tag overlap + time fit + popularity
  function getSuggestions() {
    setLoadingSug(true);
    try {
      const A0 = Date.parse(aStart), A1 = Date.parse(aEnd);
      const span = Math.max(1, (A1 - A0)/1000);

      const jaccard = (A: string[] = [], B: string[] = []) => {
        const a = new Set(A.map(x=>x.toLowerCase())), b = new Set(B.map(x=>x.toLowerCase()));
        const inter = [...a].filter(x => b.has(x)).length;
        const uni = new Set([...A.map(x=>x.toLowerCase()), ...B.map(x=>x.toLowerCase())]).size;
        return uni ? inter/uni : 0;
      };

      const inWindow = events.filter(r =>
        Date.parse(r.start_ts) >= A0 && Date.parse(r.end_ts) <= A1
      );

      const scored = inWindow.map(r => {
        const s = Date.parse(r.start_ts), e = Date.parse(r.end_ts);
        const leftover = Math.max(0, (A1 - e)/1000 + (s - A0)/1000);
        const timeFit = Math.max(0, 1 - leftover/span); // 0..1
        const tagSim = jaccard(qTagArr, r.tags || []);
        const pop = Math.log1p((r.attendees || []).length);
        const score = 0.5*tagSim + 0.3*timeFit + 0.2*pop;
        return { row: r, score };
      }).sort((a,b)=> b.score - a.score);

      // small diversity (MMR) on top 30
      const pool = scored.slice(0, 30);
      const out: EventRow[] = [];
      const λ = 0.7;
      while (pool.length && out.length < 5) {
        let best = 0, bestVal = -1e9;
        for (let i=0;i<pool.length;i++){
          const e = pool[i];
          const sim = out.length ? Math.max(...out.map(x => {
            const A = new Set((e.row.tags||[]).map(t=>t.toLowerCase()));
            const B = new Set((x.tags||[]).map(t=>t.toLowerCase()));
            const inter = [...A].filter(t => B.has(t)).length;
            const uni = new Set([...(e.row.tags||[]).map(t=>t.toLowerCase()), ...(x.tags||[]).map(t=>t.toLowerCase())]).size;
            return uni ? inter/uni : 0;
          })) : 0;
          const val = λ*e.score - (1-λ)*sim;
          if (val > bestVal) { bestVal = val; best = i; }
        }
        out.push(pool.splice(best,1)[0].row);
      }
      setSuggs(out);
    } finally {
      setLoadingSug(false);
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: '24px auto', padding: 16, fontFamily: 'ui-sans-serif, system-ui' }}>
      <h2>MVP: Events Recommender (Web)</h2>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap: 24 }}>
        {/* Admin */}
        <section style={{ border:'1px solid #ddd', borderRadius:8, padding:16 }}>
          <h3>Admin: Add Event</h3>
          <label>Name</label>
          <input value={name} onChange={e=>setName(e.target.value)} style={{ width:'100%', marginBottom:8 }} />
          <label>Tags (comma-separated)</label>
          <input value={tags} onChange={e=>setTags(e.target.value)} style={{ width:'100%', marginBottom:8 }} />
          <label>Start (ISO)</label>
          <input value={start} onChange={e=>setStart(e.target.value)} style={{ width:'100%', marginBottom:8 }} />
          <label>End (ISO)</label>
          <input value={end} onChange={e=>setEnd(e.target.value)} style={{ width:'100%', marginBottom:8 }} />
          <button onClick={addEvent} disabled={loadingAdd}>{loadingAdd ? 'Saving…' : 'Add Event'}</button>
        </section>

        {/* User */}
        <section style={{ border:'1px solid #ddd', borderRadius:8, padding:16 }}>
          <h3>User: Get Suggestions</h3>
          <label>Availability start (ISO)</label>
          <input value={aStart} onChange={e=>setAStart(e.target.value)} style={{ width:'100%', marginBottom:8 }} />
          <label>Availability end (ISO)</label>
          <input value={aEnd} onChange={e=>setAEnd(e.target.value)} style={{ width:'100%', marginBottom:8 }} />
          <label>Tags (comma-separated)</label>
          <input value={qTags} onChange={e=>setQTags(e.target.value)} style={{ width:'100%', marginBottom:8 }} />

          <div style={{ display:'flex', gap: 8 }}>
            <button onClick={fetchEvents}>Load Events</button>
            <button onClick={getSuggestions} disabled={loadingSug}>{loadingSug ? 'Scoring…' : 'Get Suggestions'}</button>
          </div>
        </section>
      </div>

      {/* Results */}
      <section style={{ marginTop: 24 }}>
        <h3>Suggestions</h3>
        {suggs.length === 0 && <div style={{ opacity:0.7 }}>No suggestions yet — click “Load Events” then “Get Suggestions”.</div>}
        {suggs.map(e => (
          <div key={e.id} style={{ border:'1px solid #eee', borderRadius:8, padding:12, marginBottom:8 }}>
            <strong>{e.name}</strong>
            <div>{new Date(e.start_ts).toLocaleString()} → {new Date(e.end_ts).toLocaleString()}</div>
            <div>Tags: {(e.tags||[]).join(', ')}</div>
            <div>Attendees: {(e.attendees||[]).length}</div>
          </div>
        ))}
      </section>

      {/* Live Events (for debugging/demo) */}
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
