/**
 * Push main to BOTH remotes, one Railway deploy at a time (2026-11-23, the owner's "Build push guard").
 *
 * Why: Railway builds the `deploy` remote (sgrant5724/spark). A push that lands while the previous push's
 * deploy is still building gets one of the two deploys marked "Deployment failed": cea7f51 on 2026-11-01,
 * and 3306b23 on 2026-11-23, pushed 34 s after a0bebb3 by another session. Two Claude sessions often share
 * this repo, so waiting for the other deploy has to be a command, not a habit.
 *
 *   npm run push                    wait for a running deploy, push origin then deploy, watch the new deploy
 *   npm run push -- --dry-run       say what it would do; push nothing
 *   npm run push -- --no-watch      return as soon as both pushes are done
 *   npm run push -- --max-wait=30   minutes to wait for a running deploy (default 20)
 *   npm run push -- --no-wait       don't wait (a deploy you know is stuck); the fast-forward check still runs
 *
 * How it knows a deploy is running: Railway's commit status on the deploy repo reads "pending" while it
 * deploys and "success" or "failure" when it ends (afterwards GitHub shows only the final one). A head that is
 * pending, or has no status yet, and was pushed less than MAX_BUILD_MS ago (GitHub's activity API gives the
 * push time) is a build under way. A final status must also be SETTLE_MS old, so the switch-over finishes
 * before the next build starts.
 *
 * It never overwrites: both remotes must fast-forward to local main, so another session's commits are pulled
 * in first (`git pull --rebase <remote> main`), never pushed over. Run it from Bash with a long timeout or in
 * the background; a watched push takes about four minutes.
 *
 * Exit: 0 pushed (and deployed, if watched) · 1 refused, or a push failed · 2 the new deploy failed ·
 * 3 timed out waiting.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Railway's builds took 3–5 minutes in November 2026; past this, a missing status means none is coming. */
export const MAX_BUILD_MS = 15 * 60_000;
/** How long after a deploy's final status the next push waits. */
export const SETTLE_MS = 60_000;
const POLL_MS = 15_000;

/** Railway's last word on a commit, or null while nothing has been posted. */
export type DeployStatus = { state: string; at: Date; description: string; url: string | null } | null;

export type Decision = { go: true; why: string } | { go: false; why: string; recheckMs: number };

const ago = (ms: number) =>
  ms < 90_000 ? `${Math.round(ms / 1000)} s` : ms < 90 * 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 3_600_000)} h`;

/**
 * Whether a push may start now, from the deploy remote's head: its status (null = none yet), when it was
 * pushed (null = the activity API didn't say) and when it was committed (the fallback for the push time).
 */
export function decide(o: {
  head: string;
  status: DeployStatus;
  pushedAt: Date | null;
  committedAt: Date | null;
  now: Date;
  settleMs?: number;
  maxBuildMs?: number;
}): Decision {
  const settle = o.settleMs ?? SETTLE_MS;
  const maxBuild = o.maxBuildMs ?? MAX_BUILD_MS;
  const short = o.head.slice(0, 7);
  const now = o.now.getTime();

  if (o.status && o.status.state !== "pending") {
    const age = now - o.status.at.getTime();
    if (age < settle) {
      return { go: false, why: `${short}'s deploy ended ${ago(Math.max(0, age))} ago (${o.status.state}); letting it settle`, recheckMs: settle - age };
    }
    if (o.status.state === "success") return { go: true, why: `${short}'s deploy succeeded ${ago(age)} ago` };
    return { go: true, why: `${short}'s deploy ended ${ago(age)} ago with ${o.status.state} ("${o.status.description}"); this push deploys again` };
  }

  const since = o.pushedAt ?? o.committedAt;
  if (!since) return { go: true, why: `${short} has no deploy status and no push time; nothing to wait for` };
  const age = now - since.getTime();
  const what = o.pushedAt ? "pushed" : "committed";
  if (age < maxBuild) {
    const state = o.status ? "is pending" : "has no status yet";
    return { go: false, why: `${short}'s deploy is still running (${what} ${ago(Math.max(0, age))} ago, ${state})`, recheckMs: POLL_MS };
  }
  const silence = o.status ? "its deploy is still pending" : "Railway never reported on it";
  return { go: true, why: `${short} was ${what} ${ago(age)} ago and ${silence}; not waiting longer` };
}

// ── the command ───────────────────────────────────────────────────────────────────────────────────────

const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const git = (...args: string[]) => run("git", args);
const ghJson = (path: string): unknown => JSON.parse(run("gh", ["api", path]));
const say = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)}Z  ${line}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isAncestor(a: string, b: string): boolean {
  return spawnSync("git", ["merge-base", "--is-ancestor", a, b]).status === 0;
}

function deploySlug(): string {
  const url = git("remote", "get-url", "deploy");
  const m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!m) throw new Error(`the deploy remote isn't a GitHub repo: ${url}`);
  return `${m[1]}/${m[2]}`;
}

function readStatus(slug: string, sha: string): DeployStatus {
  const body = ghJson(`repos/${slug}/commits/${sha}/status`) as {
    statuses: { state: string; updated_at: string; description: string | null; target_url: string | null }[];
  };
  if (!body.statuses.length) return null;
  const latest = [...body.statuses].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  return { state: latest.state, at: new Date(latest.updated_at), description: latest.description ?? "", url: latest.target_url };
}

function readPushedAt(slug: string, sha: string): Date | null {
  try {
    const rows = ghJson(`repos/${slug}/activity?ref=refs/heads/main&activity_type=push&per_page=30`) as { after: string; timestamp: string }[];
    const row = rows.find((r) => r.after === sha);
    return row ? new Date(row.timestamp) : null;
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const known = /^--(dry-run|no-watch|no-wait|max-wait=\d+)$/;
  const unknown = args.filter((a) => !known.test(a));
  if (unknown.length) {
    console.error(`Unknown option ${unknown.join(" ")}. Options: --dry-run --no-watch --no-wait --max-wait=<minutes>`);
    process.exit(1);
  }
  const dryRun = args.includes("--dry-run");
  const watch = !args.includes("--no-watch");
  const noWait = args.includes("--no-wait");
  const maxWaitMs = Number(args.find((a) => a.startsWith("--max-wait="))?.split("=")[1] ?? 20) * 60_000;

  process.chdir(git("rev-parse", "--show-toplevel"));
  const branch = (spawnSync("git", ["symbolic-ref", "--short", "-q", "HEAD"], { encoding: "utf8" }).stdout ?? "").trim();
  if (branch !== "main") {
    const where = branch ? `On branch ${branch}` : "HEAD is detached (a rebase or checkout in progress?)";
    console.error(`${where}. This pushes main only; finish that and switch to main first.`);
    process.exit(1);
  }
  const slug = deploySlug();
  const started = Date.now();
  let lastWhy = "";

  for (;;) {
    git("fetch", "--quiet", "origin", "main");
    git("fetch", "--quiet", "deploy", "main");
    for (const remote of ["origin", "deploy"]) {
      if (!isAncestor(`${remote}/main`, "HEAD")) {
        console.error(
          `${remote}/main has commits this checkout doesn't (${git("log", "--oneline", "-3", `HEAD..${remote}/main`).replace(/\n/g, " · ")}).\n` +
            `Another session probably pushed. Take them first — git pull --rebase ${remote} main — check the build again, then rerun this.`,
        );
        process.exit(1);
      }
    }
    const local = git("rev-parse", "HEAD");
    const head = git("rev-parse", "deploy/main");
    if (local === head && local === git("rev-parse", "origin/main")) {
      say(`Nothing to push: origin and deploy are both at ${local.slice(0, 7)}.`);
      return;
    }
    if (noWait) {
      say("--no-wait: not checking for a running deploy.");
      break;
    }

    let decision: Decision;
    try {
      decision = decide({
        head,
        status: readStatus(slug, head),
        pushedAt: readPushedAt(slug, head),
        committedAt: new Date(git("show", "-s", "--format=%cI", head)),
        now: new Date(),
      });
    } catch (e) {
      console.error(`Couldn't read Railway's status for ${head.slice(0, 7)} on ${slug} through gh: ${(e as Error).message.split("\n")[0]}`);
      console.error("Not pushing blind. Check `gh auth status`, or pass --no-wait if you know no deploy is running.");
      process.exit(1);
    }
    if (decision.go) {
      say(decision.why);
      break;
    }
    if (dryRun) {
      say(`Would wait: ${decision.why}.`);
      return;
    }
    if (Date.now() - started > maxWaitMs) {
      console.error(`Gave up after ${ago(Date.now() - started)}: ${decision.why}. Check Railway, then rerun (or --no-wait).`);
      process.exit(3);
    }
    if (decision.why !== lastWhy) say(`Waiting: ${decision.why}.`);
    lastWhy = decision.why;
    await sleep(Math.max(POLL_MS, Math.min(decision.recheckMs, 60_000)));
  }

  const local = git("rev-parse", "HEAD");
  const range = git("log", "--oneline", "deploy/main..HEAD");
  if (dryRun) {
    say(`Would push ${local.slice(0, 7)} to origin and deploy:\n${range}`);
    return;
  }
  for (const [remote, ref] of [["origin", "main"], ["deploy", "main:main"]]) {
    say(`git push ${remote} ${ref}`);
    const r = spawnSync("git", ["push", remote, ref], { stdio: "inherit" });
    if (r.status !== 0) {
      console.error(remote === "deploy" ? "origin has the push and deploy doesn't: fix the cause, then rerun this." : "Nothing was pushed.");
      process.exit(1);
    }
  }
  const pushedAt = Date.now();
  say(`Pushed ${local.slice(0, 7)} to origin and deploy.`);
  if (!watch) return;

  say("Watching Railway's deploy (the commit reads pending until the deploy ends, usually 3–5 minutes)…");
  while (Date.now() - pushedAt < MAX_BUILD_MS + 5 * 60_000) {
    await sleep(20_000);
    let status: DeployStatus = null;
    try {
      status = readStatus(slug, local);
    } catch {
      continue;
    }
    if (status && status.state !== "pending") {
      const line = `${local.slice(0, 7)}: ${status.description || status.state} (${ago(status.at.getTime() - pushedAt)} after the push)`;
      if (status.state === "success") {
        say(line);
        return;
      }
      console.error(`${line}\n${status.url ?? ""}`);
      process.exit(2);
    }
  }
  console.error(`No deploy status for ${local.slice(0, 7)} after ${ago(Date.now() - pushedAt)}. Check Railway.`);
  process.exit(3);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
