import {useEffect, useMemo, useRef, useState} from 'react';
import {Copy, Search, Trash2} from 'lucide-react';
import type {JSLog, JSValue} from '../../shared/jsConsole';
import {bridge} from './bridge';

function ValueTree({value, property}: {value: JSValue; property?: string}) {
	const [open, setOpen] = useState(false);
	const prefix = property === undefined ? null : <span className="js-property">{property}: </span>;
	const preview = <span className={`js-value js-${value.type}`}>{value.type === 'string' && property !== undefined ? JSON.stringify(value.preview) : value.preview}</span>;
	if (!value.entries?.length) {return <span className="js-leaf">{prefix}{preview}{value.truncated && ' …'}</span>;}
	return <details className="js-object" onToggle={event => setOpen(event.currentTarget.open)}><summary>{prefix}{preview}{value.truncated && ' …'}</summary>{open && <div className="js-properties">
		{value.entries.map((entry, index) => <ValueTree key={index} property={entry.key} value={entry.value} />)}
		{value.truncated && <span className="js-truncated">Additional properties omitted</span>}
	</div>}</details>;
}

export function JSConsole({records, hidden = false}: {records: JSLog[]; hidden?: boolean}) {
	const [query, setQuery] = useState('');
	const [level, setLevel] = useState('all');
	const viewport = useRef<HTMLDivElement>(null);
	const follow = useRef(true);
	const filtered = useMemo(() => records.filter(record => (level === 'all' || record.level === level) && (!query || JSON.stringify(record.args).toLocaleLowerCase().includes(query.toLocaleLowerCase()))), [records, query, level]);
	useEffect(() => {const el = viewport.current; if (el && follow.current) {el.scrollTop = el.scrollHeight;}}, [filtered]);
	return <section className="js-console-panel" role="tabpanel" aria-label="JS Console" hidden={hidden}>
		<header className="console-toolbar">
			<select aria-label="JS log level" value={level} onChange={event => setLevel(event.target.value)}>
				<option value="all">All levels</option>{['log', 'info', 'debug', 'warn', 'error'].map(name => <option key={name} value={name}>{name}</option>)}
			</select>
			<label className="console-search"><Search size={15} /><input aria-label="Search JS logs" placeholder="Search JS logs" value={query} onChange={event => setQuery(event.target.value)} /></label>
			<div className="console-actions"><button aria-label="Copy JS logs" onClick={() => bridge.postMessage({type: 'console-copy', text: filtered.map(record => JSON.stringify(record, null, 2)).join('\n')})}><Copy size={15} /></button>
				<button aria-label="Clear JS logs" onClick={() => bridge.postMessage({type: 'js-clear'})}><Trash2 size={15} /></button></div>
		</header>
		<div className="js-console-log" ref={viewport} role="log" aria-label="JavaScript logs" onWheel={event => {if (event.deltaY < 0) {follow.current = false;}}} onScroll={event => {const el = event.currentTarget; follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;}}>
			{!filtered.length && <div className="console-empty">{records.length ? 'No matching JS logs' : 'Waiting for JavaScript logs…'}</div>}
			{filtered.map(record => <div key={record.id} className={`js-log-row js-level-${record.level}`}>
				<time>{new Date(record.time).toLocaleTimeString()}</time><span className="js-level">{record.level}</span>
				<div className="js-args">{record.args.map((value, index) => <ValueTree key={index} value={value} />)}</div>
			</div>)}
		</div>
		<footer className="console-footer">Values are snapshots at log time · {filtered.length} / {records.length}</footer>
	</section>;
}
