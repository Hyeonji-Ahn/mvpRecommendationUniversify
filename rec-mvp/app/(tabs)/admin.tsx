import { useState } from 'react';
import { View, Text, TextInput, Button, Alert, ScrollView } from 'react-native';
import dayjs from 'dayjs';
import { supabase } from '../../lib/supabase';

export default function AdminScreen() {
  const [name, setName] = useState('');
  const [tags, setTags] = useState('board game, social');
  const [start, setStart] = useState(dayjs().add(1,'day').hour(19).minute(0).second(0).toISOString());
  const [end, setEnd] = useState(dayjs().add(1,'day').hour(21).minute(0).second(0).toISOString());
  const [loading, setLoading] = useState(false);

  async function addEvent() {
    if (!name) return Alert.alert('Name required');
    if (new Date(end) <= new Date(start)) return Alert.alert('End must be after start');
    setLoading(true);
    try {
      const tagsArr = tags.split(',').map(s=>s.trim()).filter(Boolean);
      const { error } = await supabase.from('events').insert({
        name, tags: tagsArr, start_ts: start, end_ts: end
      });
      if (error) throw error;
      Alert.alert('Saved', 'Event created.');
      setName('');
    } catch (e:any) {
      Alert.alert('Insert error', e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
      <Text style={{ fontSize: 20, fontWeight: '700' }}>Admin: Add Event</Text>
      <TextInput placeholder="Event name" value={name} onChangeText={setName} style={{ borderWidth:1, padding:8 }} />
      <TextInput placeholder="Tags (comma-separated)" value={tags} onChangeText={setTags} style={{ borderWidth:1, padding:8 }} />
      <TextInput placeholder="Start ISO" value={start} onChangeText={setStart} style={{ borderWidth:1, padding:8 }} />
      <TextInput placeholder="End ISO" value={end} onChangeText={setEnd} style={{ borderWidth:1, padding:8 }} />
      <Button title={loading ? 'Saving...' : 'Add Event'} onPress={addEvent} />
    </ScrollView>
  );
}
