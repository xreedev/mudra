/**
 * MUDRA+ on-device LLM testbed.
 *
 * Standalone harness to prove a quantized GGUF runs on the phone via llama.rn,
 * benchmark it (load time, tokens/sec, first-token + end-to-end latency), and
 * eyeball the two real LLM tasks — gloss→sentence and smart replies — against
 * the PLAN.md latency budget (gloss→sentence < 1.5s on device).
 *
 * Model is pushed to the app's external files dir via adb (see README), so the
 * APK stays small and we can swap models without rebuilding.
 */
import React, {useCallback, useMemo, useState} from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import RNFS from 'react-native-fs';
import {
  load,
  unload,
  warmup,
  completeWithStats,
  localProvider,
  currentModelPath,
} from './src/llm/LocalLlmProvider';
import {
  glossToText,
  smartReplies,
  glossSystemWithFewShot,
  appendTurn,
  buildRecentContext,
  type ConversationTurn,
} from './src/llm/features';
import {GLOSS_CASES, REPLY_CASES, CONVERSATION_SCRIPTS} from './src/llm/testCases';

const MODELS_DIR = `${RNFS.ExternalDirectoryPath}/models`;
// react-native-fs's readDir() calls File.listFiles() natively, which has a
// known bug on some OEM builds (throws NPE "Attempt to get length of null
// array" instead of returning []). We sidestep it by stat()-ing known
// filenames directly instead of listing the directory.
const KNOWN_MODEL_NAMES = [
  'Qwen2.5-7B-Instruct-Q4_K_M.gguf',
  'Qwen2.5-3B-Instruct-Q4_K_M.gguf',
  'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
];

type LogLine = {kind: 'info' | 'ok' | 'warn' | 'err' | 'metric'; text: string};

export default function App(): React.JSX.Element {
  const isDark = useColorScheme() === 'dark';
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [freeText, setFreeText] = useState('NEED MEDICINE METFORMIN ONE STRIP');

  const push = useCallback((line: LogLine) => {
    setLog(prev => [...prev, line]);
  }, []);
  const clear = useCallback(() => setLog([]), []);

  const scanModels = useCallback(async () => {
    try {
      const found: string[] = [];
      for (const name of KNOWN_MODEL_NAMES) {
        const path = `${MODELS_DIR}/${name}`;
        try {
          const stat = await RNFS.stat(path);
          if (stat.isFile()) {
            found.push(path);
            push({kind: 'info', text: `• ${name} (${(Number(stat.size) / 1e6).toFixed(0)} MB)`});
          }
        } catch {
          // not present — fine, keep checking the rest
        }
      }
      setModels(found);
      if (found.length === 0) {
        push({
          kind: 'warn',
          text: `No known model found under:\n${MODELS_DIR}\nPush a .gguf there (see README), then Rescan.\n(Using direct stat() checks — readDir() is unreliable on this device.)`,
        });
      } else {
        push({kind: 'ok', text: `Found ${found.length} model(s).`});
      }
    } catch (e: any) {
      push({kind: 'err', text: `scan failed: ${e?.message ?? e}`});
    }
  }, [push]);

  const doLoad = useCallback(
    async (path: string) => {
      setBusy(true);
      push({kind: 'info', text: `Loading ${path.split('/').pop()} …`});
      // GPU offload disabled: this device's Hexagon lockdown breaks llama.rn's
      // only GPU-capable Android lib (OpenCL is bundled with Hexagon in one
      // .so). See AndroidManifest.xml comment + llm-testbed-decisions memory.
      // CPU-only speed tuning: device has 8 cores, llama.rn's own default
      // used only 4 — push generation to 6 threads (leave 2 for RN/JS/UI),
      // batch threads to 8 (prompt eval parallelizes better), bigger n_batch
      // to speed up first-token latency on our longer few-shot prompt.
      const res = await load({
        modelPath: path,
        nCtx: 1024,
        nGpuLayers: 0,
        nThreads: 6,
        nThreadsBatch: 8,
        nBatch: 512,
        flashAttn: 'auto',
      });
      if (res.ok) {
        setLoaded(path);
        push({
          kind: res.gpu ? 'ok' : 'warn',
          text: `Loaded in ${res.loadMs} ms · GPU=${String(res.gpu)}${res.gpu ? ' 🚀' : ''}`,
        });
        if (!res.gpu && res.reasonNoGPU) {
          push({kind: 'warn', text: `CPU fallback reason: ${res.reasonNoGPU}`});
        }
        try {
          // Prime with the SAME (long) prompt shape the real gloss suite uses,
          // so this pays the one-time cold-start cost instead of the first sign.
          const w = await warmup(glossSystemWithFewShot());
          push({kind: 'metric', text: `Warmup done in ${w} ms — first real inference will now be fast.`});
        } catch (e: any) {
          push({kind: 'warn', text: `warmup skipped: ${e?.message ?? e}`});
        }
      } else {
        push({kind: 'err', text: `Load failed: ${res.error}`});
        push({kind: 'warn', text: 'Retrying on CPU (nGpuLayers=0) …'});
        const cpu = await load({modelPath: path, nCtx: 1024, nGpuLayers: 0});
        if (cpu.ok) {
          setLoaded(path);
          push({kind: 'ok', text: `Loaded on CPU in ${cpu.loadMs} ms`});
        } else {
          push({kind: 'err', text: `CPU load also failed: ${cpu.error}`});
        }
      }
      setBusy(false);
    },
    [push],
  );

  const runGlossSuite = useCallback(async () => {
    if (!(await localProvider.ready())) {
      push({kind: 'err', text: 'Load a model first.'});
      return;
    }
    setBusy(true);
    push({kind: 'info', text: '── gloss → sentence suite ──'});
    let totalMs = 0;
    let totalTps = 0;
    for (const c of GLOSS_CASES) {
      const t0 = Date.now();
      try {
        const stats = await completeWithStats(
          glossSystemWithFewShot(), // same prompt as features.glossToText
          `Glosses: ${c.gloss.join(' ')}`,
          {maxTokens: 48, temperature: 0.2},
        );
        const dt = Date.now() - t0;
        totalMs += dt;
        totalTps += stats.tokensPerSecond;
        const budget = dt <= 1500 ? '✓' : '✗>1.5s';
        push({kind: 'ok', text: `[${c.id}] ${c.gloss.join(' ')}\n→ "${stats.text}"`});
        push({kind: 'metric', text: `   ${dt}ms ${budget} · ${stats.tokensPerSecond} tok/s · ftt ${stats.msToFirstToken}ms`});
      } catch (e: any) {
        push({kind: 'err', text: `[${c.id}] ${e?.message ?? e}`});
      }
    }
    push({kind: 'metric', text: `avg ${(totalMs / GLOSS_CASES.length).toFixed(0)}ms · avg ${(totalTps / GLOSS_CASES.length).toFixed(1)} tok/s`});
    setBusy(false);
  }, [push]);

  const runReplySuite = useCallback(async () => {
    if (!(await localProvider.ready())) {
      push({kind: 'err', text: 'Load a model first.'});
      return;
    }
    setBusy(true);
    push({kind: 'info', text: '── smart replies suite ──'});
    for (const c of REPLY_CASES) {
      const t0 = Date.now();
      try {
        const replies = await smartReplies(localProvider, c.context, c.lastTranscript);
        push({kind: 'ok', text: `[${c.id}] callee: "${c.lastTranscript}"`});
        replies.forEach((r, i) => push({kind: 'info', text: `   ${i + 1}. ${r}`}));
        push({kind: 'metric', text: `   ${Date.now() - t0}ms`});
      } catch (e: any) {
        push({kind: 'err', text: `[${c.id}] ${e?.message ?? e}`});
      }
    }
    setBusy(false);
  }, [push]);

  const runConversationMemoryDemo = useCallback(async () => {
    if (!(await localProvider.ready())) {
      push({kind: 'err', text: 'Load a model first.'});
      return;
    }
    setBusy(true);
    push({kind: 'info', text: '── conversation memory demo ──'});
    for (const script of CONVERSATION_SCRIPTS) {
      push({kind: 'info', text: `[${script.id}]`});
      let turns: ConversationTurn[] = [];
      for (const t of script.turns) {
        turns = appendTurn(turns, t.speaker, t.text);
        push({kind: 'info', text: `  +${t.speaker}: ${t.text}`});
      }
      // Now ask for smart replies to a NEW callee line, using only the
      // rolling window built from everything appended above — proves the
      // window still carries the original topic several turns later.
      const newLine = 'Would you like a text reminder when it is ready?';
      const context = buildRecentContext(turns, {maxTurns: 6, maxChars: 500});
      push({kind: 'metric', text: `  context window fed to LLM:\n${context.split('\n').map(l => '    ' + l).join('\n')}`});
      const t0 = Date.now();
      try {
        const replies = await smartReplies(localProvider, context, newLine);
        push({kind: 'ok', text: `  callee: "${newLine}"`});
        replies.forEach((r, i) => push({kind: 'info', text: `    ${i + 1}. ${r}`}));
        push({kind: 'metric', text: `  ${Date.now() - t0}ms`});
      } catch (e: any) {
        push({kind: 'err', text: `  ${e?.message ?? e}`});
      }
    }
    setBusy(false);
  }, [push]);

  const runFree = useCallback(async () => {
    if (!(await localProvider.ready())) {
      push({kind: 'err', text: 'Load a model first.'});
      return;
    }
    setBusy(true);
    const gloss = freeText.trim().split(/\s+/);
    const t0 = Date.now();
    try {
      const out = await glossToText(localProvider, gloss);
      push({kind: 'ok', text: `free: ${gloss.join(' ')}\n→ "${out}"  (${Date.now() - t0}ms)`});
    } catch (e: any) {
      push({kind: 'err', text: e?.message ?? String(e)});
    }
    setBusy(false);
  }, [freeText, push]);

  const doUnload = useCallback(async () => {
    await unload();
    setLoaded(null);
    push({kind: 'info', text: 'Model released.'});
  }, [push]);

  const bg = isDark ? '#0b0f14' : '#f6f7f9';
  const fg = isDark ? '#e6edf3' : '#1b1f24';

  return (
    <SafeAreaView style={[styles.root, {backgroundColor: bg}]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <Text style={[styles.title, {color: fg}]}>MUDRA+ · On-device LLM testbed</Text>
      <Text style={[styles.sub, {color: fg}]} numberOfLines={1}>
        {loaded ? `● ${loaded.split('/').pop()}` : '○ no model loaded'}
      </Text>

      <View style={styles.row}>
        <Btn label="Rescan models" onPress={scanModels} disabled={busy} />
        <Btn
          label="Create models dir"
          onPress={async () => {
            try {
              await RNFS.mkdir(MODELS_DIR);
              push({kind: 'ok', text: `Created (or already existed):\n${MODELS_DIR}\nNow adb push the .gguf into it, then Rescan.`});
            } catch (e: any) {
              push({kind: 'err', text: `mkdir failed: ${e?.message ?? e}`});
            }
          }}
          disabled={busy}
        />
        <Btn label="Unload" onPress={doUnload} disabled={busy || !loaded} />
        <Btn label="Clear log" onPress={clear} disabled={busy} />
      </View>

      {models.length > 0 && (
        <View style={styles.row}>
          {models.map(m => (
            <Btn
              key={m}
              label={`Load ${m.split('/').pop()}`}
              onPress={() => doLoad(m)}
              disabled={busy}
              primary
            />
          ))}
        </View>
      )}

      <View style={styles.row}>
        <Btn label="Run gloss→text suite" onPress={runGlossSuite} disabled={busy || !loaded} primary />
        <Btn label="Run smart-replies suite" onPress={runReplySuite} disabled={busy || !loaded} primary />
        <Btn label="Run conversation-memory demo" onPress={runConversationMemoryDemo} disabled={busy || !loaded} primary />
      </View>

      <View style={styles.freeRow}>
        <TextInput
          style={[styles.input, {color: fg, borderColor: isDark ? '#30363d' : '#ccc'}]}
          value={freeText}
          onChangeText={setFreeText}
          placeholder="GLOSS TOKENS HERE"
          placeholderTextColor="#888"
          autoCapitalize="characters"
        />
        <Btn label="Go" onPress={runFree} disabled={busy || !loaded} primary />
      </View>

      <ScrollView style={styles.logBox} contentContainerStyle={{padding: 10}}>
        {log.length === 0 && (
          <Text style={{color: '#888'}}>
            1) Rescan models  2) Load one  3) Run a suite.{'\n'}
            Push a .gguf to:{'\n'}{MODELS_DIR}
          </Text>
        )}
        {log.map((l, i) => (
          <Text key={i} style={[styles.logLine, {color: colorFor(l.kind, isDark)}]}>
            {l.text}
          </Text>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function Btn(props: {label: string; onPress: () => void; disabled?: boolean; primary?: boolean}) {
  return (
    <TouchableOpacity
      onPress={props.onPress}
      disabled={props.disabled}
      style={[
        styles.btn,
        props.primary && styles.btnPrimary,
        props.disabled && styles.btnDisabled,
      ]}>
      <Text style={[styles.btnText, props.primary && {color: '#fff'}]}>{props.label}</Text>
    </TouchableOpacity>
  );
}

function colorFor(kind: LogLine['kind'], dark: boolean): string {
  switch (kind) {
    case 'ok':
      return dark ? '#3fb950' : '#1a7f37';
    case 'warn':
      return dark ? '#d29922' : '#9a6700';
    case 'err':
      return dark ? '#f85149' : '#cf222e';
    case 'metric':
      return dark ? '#79c0ff' : '#0969da';
    default:
      return dark ? '#adbac7' : '#57606a';
  }
}

const styles = StyleSheet.create({
  root: {flex: 1, paddingHorizontal: 12, paddingTop: 8},
  title: {fontSize: 18, fontWeight: '700', marginTop: 4},
  sub: {fontSize: 12, marginBottom: 8, opacity: 0.8},
  row: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8},
  freeRow: {flexDirection: 'row', gap: 8, marginBottom: 8, alignItems: 'center'},
  input: {flex: 1, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13},
  btn: {backgroundColor: '#e7ebef', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8},
  btnPrimary: {backgroundColor: '#1f6feb'},
  btnDisabled: {opacity: 0.4},
  btnText: {fontSize: 13, fontWeight: '600', color: '#1b1f24'},
  logBox: {flex: 1, borderRadius: 8, backgroundColor: '#00000010', marginBottom: 8},
  logLine: {fontSize: 12, fontFamily: 'monospace', marginBottom: 4},
});
