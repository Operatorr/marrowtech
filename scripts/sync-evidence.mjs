#!/usr/bin/env node
// Copies one published session from an Omega Realm checkout into the evidence collection.
// Takes the newest generation, and only the two text files the pages read.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const CANONICAL = 'docs/netcode/perf-notes/digitalocean-capacity/sessions';
const FILES = ['summary.json', 'SHA256SUMS'];

const [checkout, session] = process.argv.slice(2);
if (!checkout || !session) {
	console.error('usage: pnpm evidence:sync <omega-realm-checkout> <session_id>');
	process.exit(2);
}

const root = join(checkout, CANONICAL, session);
if (!existsSync(root)) {
	console.error(`No published session at ${root}`);
	process.exit(1);
}
const generation = readdirSync(root).filter((name) => /^gen-\d+$/.test(name)).sort().at(-1);
if (!generation) {
	console.error(`No generation under ${root}`);
	process.exit(1);
}

const source = join(root, generation);
const summary = JSON.parse(readFileSync(join(source, 'summary.json'), 'utf8'));
if (summary.synthetic_fixture) {
	console.error(`${session} is a synthetic fixture and cannot be published.`);
	process.exit(1);
}
const digest = createHash('sha256').update(readFileSync(join(source, 'SHA256SUMS'))).digest('hex');
if (digest !== summary.raw_evidence.inventory_sha256) {
	console.error(`${session}: SHA256SUMS does not match its summary.`);
	process.exit(1);
}

const target = join('src/content/evidence', session);
mkdirSync(target, { recursive: true });
for (const name of FILES) copyFileSync(join(source, name), join(target, name));
console.log(`${session} ${generation} -> ${target}`);
