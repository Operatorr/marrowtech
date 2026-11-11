/* Build-time reads and display rules for the evidence pages. No value here is hand-entered:
   every number comes from a published summary, and a decision is only ever the export's own. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getCollection } from 'astro:content';
import { evidenceBase, type EvidenceRun, type EvidenceSummary } from './evidence-schema';

export type Session = { id: string; data: EvidenceSummary; inventory: string };

function inventoryOf(id: string, data: EvidenceSummary): string {
	const bytes = readFileSync(resolve(evidenceBase, id, data.raw_evidence.inventory_file));
	const digest = createHash('sha256').update(bytes).digest('hex');
	if (digest !== data.raw_evidence.inventory_sha256) {
		throw new Error(`Evidence ${id}: the inventory hashes to ${digest}, and its summary says ${data.raw_evidence.inventory_sha256}.`);
	}
	const text = bytes.toString('utf8');
	const lines = text.split('\n').filter(Boolean).length;
	if (data.raw_evidence.files !== null && lines !== data.raw_evidence.files) {
		throw new Error(`Evidence ${id}: the inventory lists ${lines} files, and its summary says ${data.raw_evidence.files}.`);
	}
	return text;
}

/** Every published session, oldest first. A build refuses synthetic data unless it asked for fixtures. */
export async function loadSessions(): Promise<Session[]> {
	const entries = await getCollection('evidence');
	return entries
		.map(({ id, data }) => {
			if (data.synthetic_fixture && !process.env.EVIDENCE_FIXTURES) {
				throw new Error(`Evidence ${id} is a synthetic fixture and cannot be published.`);
			}
			return { id, data, inventory: inventoryOf(id, data) };
		})
		.sort((a, b) => (a.data.as_of ?? '').localeCompare(b.data.as_of ?? ''));
}

/** A published value as it was published. Never rounded; missing reads as missing, not zero. */
export function show(value: number | string | boolean | null | undefined, unit = ''): string {
	if (value === null || value === undefined) return 'not recorded';
	return unit ? `${value} ${unit}` : String(value);
}

export type GateRow = { name: string; measured: string; limit: string; decision: string | null };

export function gateRows(run: EvidenceRun, policy: EvidenceSummary['gate_policy']): GateRow[] {
	const worst = run.gate_values.tick_over_budget_worst_ratio;
	const least = run.gate_values.tick_over_budget_least_ratio;
	const tick = worst
		? `over budget: worst case ${worst.exact} (${show(worst.approximate)}), best case ${least?.exact ?? 'not recorded'}`
		: 'not recorded';
	return [
		{ name: 'Continuity', measured: show(run.gate_values.continuity_unexpected_disconnects, 'unexpected disconnects'), limit: `${policy.continuity.unexpected_disconnects_allowed} allowed`, decision: run.gates.continuity },
		{ name: 'Bot errors', measured: show(run.gate_values.bot_errors_total, 'errors'), limit: `${policy.bot_errors.total_allowed} allowed`, decision: run.gates.bot_errors },
		{ name: 'Tick budget', measured: tick, limit: `under ${policy.tick_budget.over_percent_strictly_below}% of Ticks above ${policy.tick_budget.budget_ns} ns`, decision: run.gates.tick_budget },
		{ name: 'Game socket drops', measured: show(run.game_socket_drops, 'drops'), limit: `${policy.game_socket_drops.allowed} allowed`, decision: run.gates.game_socket_drops },
		{ name: `Pooled RTT p${policy.rtt_p95.quantile_percent}`, measured: show(run.peers.rtt_p95_ms, 'ms'), limit: `under ${policy.rtt_p95.limit_ms_strictly_below} ms`, decision: run.gates.rtt_p95 },
		{ name: 'ENet loss estimate, peak per-second mean', measured: show(run.peers.loss_estimate_peak_per_second_mean), limit: `under ${policy.enet_loss.limit_strictly_below}`, decision: run.gates.enet_loss },
	];
}

/** "2/100" as a number, for drawing the limit line only. */
export function fractionValue(text: string): number {
	const [top, bottom] = text.split('/').map(Number);
	return top / bottom;
}

export function headlineLabel(data: EvidenceSummary): string {
	const claim = data.results.measurement.claim;
	if (claim.confirmed && claim.players !== null) return `${claim.players} players confirmed`;
	if (claim.lower_bound !== null) return `At least ${claim.lower_bound} players`;
	return 'No capacity established';
}
