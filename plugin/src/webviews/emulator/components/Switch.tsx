export function Switch({label, checked, onChange, disabled = false}: {
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
	disabled?: boolean;
}) {
	return <label className="toggle-switch">
		<span>{label}</span>
		<span className="toggle-switch-control">
			<input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
			<span className="toggle-switch-track" aria-hidden="true"><span className="toggle-switch-thumb" /></span>
		</span>
	</label>;
}
