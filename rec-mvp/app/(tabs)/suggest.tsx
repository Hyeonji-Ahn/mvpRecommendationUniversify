import { useState } from 'react';
import { View, Text, TextInput, Button, FlatList } from 'react-native';

type Suggestion = {
  id: string; name: string; start: string; end: string;
  tags: string[]; attendeesCount: number; score: number; reason: string;
};

const SUGGEST_URL = process.env.EXPO_PUBLIC_SUGGEST_URL!;

export default function SuggestScreen() {
  const [aStart, setAStart] = useState(new Date().toISOString());
  const [aEnd, setAEnd] = useState(new Date(Date.now()+2*60*60*1000).toISOString());
  const [tags, setTags] = useState('board game, volleyball');
  const [data, setData] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);

  async function fetchSuggestions() {
    setLoading(true);
    try {
      const r = await fetch(SUGGEST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aStart, aEnd,
          tags: tags.split(',').map(s=>s.trim()).filter(Boolean),
          k: 5
        })
      });
      const json = await r.json();
      setData(json.suggestions || []);
    } finally { setLoading(false); }
  }

  return (
    <View style={{ padding:16, gap:8 }}>
      <Text style={{ fontSize:20, fontWeight:'700' }}>Get Recommendations</Text>
      <TextInput value={aStart} onChangeText={setAStart} placeholder="Start ISO" style={{ borderWidth:1, padding:8 }} />
      <TextInput value={aEnd} onChangeText={setAEnd} placeholder="End ISO" style={{ borderWidth:1, padding:8 }} />
      <TextInput value={tags} onChangeText={setTags} placeholder="Tags (comma-separated)" style={{ borderWidth:1, padding:8 }} />
      <Button title={loading ? 'Loading...' : 'Get Suggestions'} onPress={fetchSuggestions} />

      <FlatList
        style={{ marginTop: 8 }}
        data={data}
        keyExtractor={(it)=>it.id}
        renderItem={({ item }) => (
          <View style={{ borderWidth:1, borderRadius:8, padding:12, marginBottom:8 }}>
            <Text style={{ fontWeight:'700' }}>{item.name}</Text>
            <Text>{new Date(item.start).toLocaleString()} → {new Date(item.end).toLocaleString()}</Text>
            <Text>Tags: {item.tags.join(', ')}</Text>
            <Text>Attendees: {item.attendeesCount}</Text>
            <Text style={{ opacity:0.7 }}>{item.reason}</Text>
          </View>
        )}
      />
    </View>
  );
}
