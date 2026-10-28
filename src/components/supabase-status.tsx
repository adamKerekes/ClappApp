import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { HintRow } from '@/components/hint-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

type Status = 'checking' | 'connected' | 'not-configured' | 'error';

const labels: Record<Status, string> = {
  checking: 'checking…',
  connected: 'connected',
  'not-configured': 'missing .env',
  error: 'unreachable',
};

export function SupabaseStatus() {
  const [status, setStatus] = useState<Status>(
    isSupabaseConfigured ? 'checking' : 'not-configured'
  );

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    supabase.auth
      .getSession()
      .then(({ error }) => setStatus(error ? 'error' : 'connected'))
      .catch(() => setStatus('error'));
  }, []);

  return (
    <ThemedView type="backgroundElement" style={styles.container}>
      <HintRow title="Supabase" hint={<ThemedText type="code">{labels[status]}</ThemedText>} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.four,
  },
});
