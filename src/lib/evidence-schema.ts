/* The published DigitalOcean session summary, as the Omega Realm export writes it
   (`omega.do-session.published-summary/1`). Only what the evidence pages read is named. */
import { z } from 'astro/zod';

/** Where the sessions live. EVIDENCE_FIXTURES points a local build at test data instead. */
export const evidenceBase = process.env.EVIDENCE_FIXTURES || './src/content/evidence';

const num = z.number().nullable();
const str = z.string().nullable();
const flag = z.boolean().nullable();
const ratio = z.object({ exact: str, approximate: num }).nullable();
const series = z.array(num);

const host = z.object({
	size_slug: str,
	vcpus: num,
	memory_mib: num,
	disk_gib: num,
	architecture: str,
	cpu_class: str,
	image_id: z.union([z.number(), z.string()]).nullable(),
	region: str,
});

const run = z.object({
	run_id: z.string(),
	ordinal: z.number(),
	phase: z.string(),
	target: z.number(),
	repetition: z.number(),
	hold_s: z.number(),
	outcome: str,
	classification: str,
	offered_load: str,
	verified: z.boolean(),
	gates: z.object({
		continuity: str,
		bot_errors: str,
		tick_budget: str,
		game_socket_drops: str,
		rtt_p95: str,
		enet_loss: str,
	}),
	gate_values: z.object({
		tick_over_budget_worst_ratio: ratio,
		tick_over_budget_least_ratio: ratio,
		continuity_unexpected_disconnects: num,
		bot_errors_total: num,
	}),
	ticks: z.object({
		count: num,
		p50_work_ns: num,
		p90_work_ns: num,
		p95_work_ns: num,
		p99_work_ns: num,
		max_work_ns: num,
		over_budget_at_most: num,
		over_budget_at_least: num,
		achieved_per_s: num,
	}),
	peers: z.object({
		rtt_p95_ms: num,
		rtt_max_ms: num,
		rtt_samples: num,
		loss_estimate_peak_per_second_mean: num,
		loss_estimate_window_mean: num,
		loss_estimate_peer_peak: num,
	}),
	game_socket_drops: num,
	trajectory: z.object({
		covered: z.boolean(),
		seconds: z.number().optional(),
		scope: z.string().optional(),
		tick_p95_work_ns: series.optional(),
		tick_max_work_ns: series.optional(),
		tick_over_budget: series.optional(),
		rtt_p95_ms: series.optional(),
		loss_estimate_mean: series.optional(),
	}),
});

const hostCost = z.object({
	size_slug: str,
	compute_usd: num,
	transfer_overage_usd: num,
	measured_outbound_bytes_lower_bound: num,
});

export const evidenceSummary = z.object({
	schema: z.literal('omega.do-session.published-summary/1'),
	provider: z.string(),
	session_id: z.string(),
	label: z.string(),
	as_of: str,
	establishes: z.boolean(),
	separate_from_cax11: z.string(),
	reads_as: z.string(),
	manifest_sha256: str,
	synthetic_fixture: z.string().optional(),
	results: z.object({
		measurement: z.object({
			search_status: str,
			history_not_vouched_for: str,
			claim: z.object({
				kind: str,
				players: num,
				lower_bound: num,
				confirmed: flag,
				search_cap_reached: flag,
				statement: z.string(),
			}),
		}),
		evidence: z.object({ status: str, files: num, bytes: num }),
		cleanup: z.object({ overall: str, outcome: str, statement: z.string() }),
	}),
	condition: z.object({
		region: str,
		public_route: str,
		game: host,
		bot: host,
	}),
	source: z.object({
		benchmark_sha: str,
		controller_sha: str,
		adapter_sha: str,
		rust_toolchain: str,
		target_triple: str,
		profile: str,
	}),
	gate_policy: z.object({
		policy_sha256: z.string(),
		tick_budget: z.object({ budget_ns: z.number(), over_percent_strictly_below: z.number() }),
		rtt_p95: z.object({ limit_ms_strictly_below: z.number(), quantile_percent: z.number() }),
		enet_loss: z.object({ limit_strictly_below: z.string() }),
		game_socket_drops: z.object({ allowed: z.number() }),
		continuity: z.object({ unexpected_disconnects_allowed: z.number() }),
		bot_errors: z.object({ total_allowed: z.number() }),
	}),
	runs: z.array(run),
	economics: z.object({
		nominal_game_tier: z.object({
			monthly_usd: num,
			display: str,
			confirmed_players: num,
			players_per_monthly_game_usd: num,
			is_lower_bound: flag,
			meaning: z.string(),
		}),
		session_estimate: z.object({
			label: z.string(),
			lifetime_s: num,
			total_estimated_usd: num,
			hosts: z.object({ game: hostCost, bot: hostCost }),
		}),
		admission_estimate: z.object({
			label: z.string(),
			session_estimate_usd: num,
			max_estimated_session_usd: num,
		}),
		management_host: z.object({ label: z.string(), monthly_usd: num }),
		invoices: z.object({
			statement: z.string(),
			recorded: z.array(z.object({ period: str, amount_usd: num, recorded_at: str })),
		}),
	}),
	raw_evidence: z.object({
		policy: z.string(),
		inventory_file: z.string(),
		inventory_sha256: z.string(),
		files: num,
		bytes: num,
	}),
});

export type EvidenceSummary = z.infer<typeof evidenceSummary>;
export type EvidenceRun = EvidenceSummary['runs'][number];
