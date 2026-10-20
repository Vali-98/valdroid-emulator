import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDownToLine, Copy, Pause, Play, Search, Send, Smartphone, Square, Trash2 } from 'lucide-react';
import { bridge } from './bridge';
import {JSConsole} from './JSConsole';
import {jsLogLimit, type JSLog} from '../../shared/jsConsole';
import { metroLogLimit, consoleLimit, filterRecords, levelRank, type ConsoleMessage, type ConsoleRecord, type ConsoleState, type LogLevel } from '../../shared/console';

const levelNames: Record<LogLevel, string> = { V: 'Verbose', D: 'Debug', I: 'Info', W: 'Warning', E: 'Error', F: 'Fatal' };

function Highlight({ text, search }: { text: string; search: string }) {
	if (!search) { return <>{text}</>; }
	const result = [];
	const lower = text.toLocaleLowerCase(), needle = search.toLocaleLowerCase();
	let from = 0, at: number;
	while ((at = lower.indexOf(needle, from)) !== -1) {
		result.push(text.slice(from, at), <mark key={at}>{text.slice(at, at+search.length)}</mark>);
		from = at+search.length;
	}
	result.push(text.slice(from));
	return <>{result}</>;
}

export function ConsoleApp() {
	const [projectTools, setProjectTools] = useState(false);
	const [metroText, setMetroText] = useState('');
	const [jsRecords, setJSRecords] = useState<JSLog[]>([]);
	const [tab, setTab] = useState<'logcat' | 'metro' | 'js'>(() => bridge.getState()?.tab ?? 'logcat');
	const activeTab = projectTools ? tab : 'logcat';
	const metroViewport = useRef<HTMLPreElement>(null);
	const metroFollow = useRef(true);
	useEffect(() => {
		const element = metroViewport.current;
		if (element && metroFollow.current) {element.scrollTop = element.scrollHeight;}
	}, [metroText, tab]);
	const [records, setRecords] = useState<ConsoleRecord[]>([]);
	const [state, setState] = useState<ConsoleState>({ streaming: false, busy: false, packages: [], processes: {} });
	const [preferences, setPreferences] = useState(() => {
		const saved = bridge.getState() ?? {};
		return {level: (saved.level && saved.level in levelRank ? saved.level : 'V') as LogLevel,
			packageName: saved.packageName ?? '', search: saved.search ?? '', history: saved.history ?? []};
	});
	const {level, packageName, search, history} = preferences;
	const updatePreferences = (change: Partial<typeof preferences>) => {
		const next = {...preferences, ...change};
		setPreferences(next); bridge.setState(next);
	};
	const [command, setCommand] = useState('');
	const historyIndex = useRef(-1);
	const [follow, setFollow] = useState(true);
	const viewport = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const receive = (event: MessageEvent<ConsoleMessage>) => {
			const message = event.data;
			switch (message.type) {
				case 'js-snapshot': setJSRecords(message.records); break;
				case 'js-records': setJSRecords(previous => [...previous, ...message.records].filter(record => record.id >= (message.oldestID ?? 0)).slice(-jsLogLimit)); break;
				case 'project-info': setProjectTools(message.expo || message.reactNative); break;
				case 'metro-snapshot': setMetroText(message.text); if (message.focus) {setTab('metro');} break;
				case 'metro-output': setMetroText(previous => (previous + message.text).slice(-metroLogLimit)); break;
				case 'console-snapshot': setState(message.state); setRecords(message.records); break;
				case 'console-state': setState(message.state); break;
				case 'console-records': setRecords(previous => [...previous, ...message.records].slice(-consoleLimit)); break;
			}
		};
		window.addEventListener('message', receive);
		bridge.postMessage({ type: 'console-ready' });
		return () => window.removeEventListener('message', receive);
	}, []);
	const filtered = useMemo(() => filterRecords(records, level, packageName, search, state.processes), [records, level, packageName, search, state.processes]);
	const virtual = useVirtualizer({ count: filtered.length, getScrollElement: () => viewport.current, estimateSize: () => 22, overscan: 12 });
	const scrollToLatest = useEffectEvent(() => virtual.scrollToIndex(filtered.length-1, { align: 'end' }));
	useEffect(() => {
		if (follow && filtered.length) { scrollToLatest(); }
	}, [filtered.length, records, follow]);
	const run = () => {
		if (!command.trim() || !state.serial || state.busy) { return; }
		bridge.postMessage({ type: 'console-command', command });
		updatePreferences({history: [command, ...history.filter(item => item !== command)].slice(0, 100)});
		historyIndex.current = -1; setCommand(''); setFollow(true);
	};
	return <main className="console-app">
		{projectTools && <nav className="console-tabs" role="tablist" aria-label="Valdroid logs">
			{(['logcat', 'metro', 'js'] as const).map(value => <button key={value} role="tab" aria-selected={activeTab === value} onClick={() => {setTab(value); bridge.setState({...bridge.getState(), tab: value});}}>{value === 'metro' ? 'Metro' : value === 'js' ? 'JS Console' : 'Logcat'}</button>)}
		</nav>}
		{projectTools && <JSConsole records={jsRecords} hidden={activeTab !== 'js'} />}
		{activeTab === 'metro' && <section className="metro-panel" role="tabpanel" aria-label="Metro">
			<header className="console-toolbar"><span>Expo build / Metro</span><div className="console-actions">
				<button aria-label="Copy Metro logs" onClick={() => bridge.postMessage({type: 'console-copy', text: metroText})}><Copy size={15} /></button>
				<button aria-label="Clear Metro logs" onClick={() => bridge.postMessage({type: 'metro-clear'})}><Trash2 size={15} /></button>
			</div></header>
			<pre className="metro-log" ref={metroViewport} onScroll={event => {const el = event.currentTarget; metroFollow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;}}>{metroText || 'Start Expo with Emulator to view build and Metro output.'}</pre>
		</section>}
		<div className="logcat-panel" hidden={activeTab !== 'logcat'}>
		<header className="console-toolbar">
			<span className="console-device" title={state.serial ?? 'No emulator loaded'}><Smartphone size={15} /><span>{state.serial ?? 'No emulator loaded'}</span></span>
			<select aria-label="Package" value={packageName} onChange={event => updatePreferences({packageName: event.target.value})}>
				<option value="">All packages</option>
				{packageName && !state.packages.includes(packageName) && <option value={packageName}>{packageName}</option>}
				{state.packages.map(name => <option key={name} value={name}>{name}</option>)}
			</select>
			<select aria-label="Minimum log level" className="level-select" value={level} onChange={event => updatePreferences({level: event.target.value as LogLevel})}>
				{Object.entries(levelNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
			</select>
			<label className="console-search"><Search size={15} /><input aria-label="Search logs" placeholder="Search" value={search} onChange={event => updatePreferences({search: event.target.value})} /></label>
			<div className="console-actions">
				<button title={state.streaming ? 'Pause logcat' : 'Resume logcat'} aria-label={state.streaming ? 'Pause logcat' : 'Resume logcat'} disabled={!state.serial} onClick={() => bridge.postMessage({ type: 'console-toggle' })}>{state.streaming ? <Pause size={15} /> : <Play size={15} />}</button>
				<button title="Follow latest" aria-label="Follow latest" aria-pressed={follow} onClick={() => setFollow(value => !value)}><ArrowDownToLine size={15} /></button>
				<button title="Copy filtered logs" aria-label="Copy filtered logs" onClick={() => bridge.postMessage({ type: 'console-copy', text: filtered.map(record => [record.time, record.level, record.pid, record.tag, record.text].filter(value => value !== undefined).join(' ')).join('\n') })}><Copy size={15} /></button>
				<button title="Clear console" aria-label="Clear console" onClick={() => bridge.postMessage({ type: 'console-clear' })}><Trash2 size={15} /></button>
			</div>
		</header>
		<div className="console-log" ref={viewport} role="log" aria-label="Android logs" onWheel={event => { if (event.deltaY < 0) { setFollow(false); } }} onScroll={event => {
			const element = event.currentTarget;
			if (element.scrollHeight-element.scrollTop-element.clientHeight > 44) { setFollow(false); }
		}}>
			{!filtered.length && <div className="console-empty">{!state.serial ? 'No emulator loaded' : records.length ? 'No matching logs' : 'Waiting for logs...'}</div>}
			<div className="console-log-space" style={{ height: virtual.getTotalSize() }}>
				{virtual.getVirtualItems().map(item => {
					const record = filtered[item.index];
					return <div key={record.id} className={`console-line level-${record.level} kind-${record.kind}`} style={{ height: item.size, transform: `translateY(${item.start}px)` }}>
						{record.kind === 'log' && <><span className="log-time"><span className="log-date">{record.time.slice(0, 6)}</span>{record.time.slice(6)}</span><span className="log-level">{record.level}</span><span className="log-pid">{record.pid}</span><span className="log-package" title={record.packageName ?? state.processes[record.pid ?? '']}>{record.packageName ?? state.processes[record.pid ?? ''] ?? '-'}</span><span className="log-tag" title={record.tag}><Highlight text={record.tag ?? ''} search={search} /></span></>}
						<span className="log-message"><Highlight text={record.text} search={search} /></span>
					</div>;
				})}
			</div>
		</div>
		<form className="console-command" onSubmit={event => { event.preventDefault(); run(); }}>
			<span className="adb-prompt">adb &gt;</span>
			<input aria-label="ADB command" spellCheck={false} autoComplete="off" value={command} disabled={!state.serial || state.busy} onChange={event => setCommand(event.target.value)} onKeyDown={event => {
				if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') { return; }
				event.preventDefault();
				historyIndex.current = event.key === 'ArrowUp' ? Math.min(history.length-1, historyIndex.current+1) : Math.max(-1, historyIndex.current-1);
				setCommand(history[historyIndex.current] ?? '');
			}} />
			{state.busy ? <button type="button" title="Cancel command" aria-label="Cancel command" onClick={() => bridge.postMessage({ type: 'console-cancel' })}><Square size={15} /></button> : <button title="Run command" aria-label="Run command" disabled={!state.serial || !command.trim()}><Send size={15} /></button>}
		</form>
		<footer className="console-footer"><span className={state.streaming ? 'log-live' : ''}>{state.streaming ? 'Logcat live' : 'Logcat stopped'}</span><span>{filtered.length.toLocaleString()} / {records.length.toLocaleString()}</span></footer>
		</div>
	</main>;
}
