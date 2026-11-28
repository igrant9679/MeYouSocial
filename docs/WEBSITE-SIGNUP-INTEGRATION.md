# Website sign-up → Publisher: integration guide

For whoever wires **www.meyousocial.com** (WordPress + MemberPress) to **MeYouSocial Publisher**.
Publisher's side was built on 2026-11-26. This file is the contract; the code that enforces it
is `src/lib/membership/` in this repository. If the two ever disagree, the code wins — and
this file needs fixing.

## What it does

A new workspace can start in two ways:

| Way | What the website does | What Publisher does |
| --- | --- | --- |
| **Free trial** (off until the operator opens it) | Links to Publisher's sign-up page: `<publisher>/signup`. Nothing else. | Anyone gets a workspace for the days the operator set (14 suggested) on MeYouSocial's AI, with an allowance. When the trial ends or the allowance is used up, the workspace is **paused** (never deleted). |
| **Membership** | When a member's plan starts or ends, it sends a signed call (below). It shows the member the link Publisher answers with. | Makes the member's workspace, or turns their trial into a member workspace if the email matches. It pauses the workspace when the plan ends and reopens it when the plan returns. |

Publisher decides **what each membership gives**: own workspace, a seat in a named workspace, or
nothing. The operator sets that on Settings → Sign-ups, keyed by the MemberPress membership id.
The website only reports what a member **has**. A call can never name a workspace or a role.

## Addresses

- **Publisher:** `https://sparkweb-production.up.railway.app`. This is the Railway address today; if a
  custom domain is added, use that instead (nothing else changes).
- **Endpoint:** `POST https://sparkweb-production.up.railway.app/api/membership/events`
- **Reachability check:** `GET` on the same address answers
  `{"ok":true,"endpoint":"…","accepts":"…","setUp":true|false}`. `setUp` is false until the
  operator has made the signing secret.
- **Free-trial link:** `https://sparkweb-production.up.railway.app/signup`. The site's "Free trial"
  buttons, which go to the contact form today, can point here — **but only once the operator has
  opened trials** on Settings → Sign-ups. Trials ship off, and since 28 Nov (the owner's "Send them to
  meyousocial.com") that page sends anyone without an invitation to the membership page
  (`https://www.meyousocial.com/membership/`, set on Sign-ups) — so for now everyone signs up on the
  website, and the buttons stay there.

## One-time setup

1. **Secret:** in Publisher go to Settings → Sign-ups → *meyousocial.com — the website's
   connection* and press **Make the signing secret**. It is shown once. Copy it into WordPress
   and nowhere else: never into page content, JavaScript or a public option.
   ```php
   // wp-config.php
   define( 'MYS_PUBLISHER_ENDPOINT', 'https://sparkweb-production.up.railway.app/api/membership/events' );
   define( 'MYS_PUBLISHER_SECRET',   'mys_whsec_…' );
   ```
2. **Map the memberships:** on the same page, under *What each membership gives in
   Publisher*, add each MemberPress membership id. That is the membership's post id: WP admin →
   MemberPress → Memberships, the `post=` number in its edit link. Choose for each one:
   - **their own workspace**: the member becomes its admin;
   - **a seat** in a chosen workspace, with a role;
   - **nothing**: for example a forum-only plan.

   A membership that isn't listed gives nothing. Its calls are logged as `ignored` and can be
   processed again once it is listed.
3. **Test:** send a `ping` (below). Settings → Sign-ups shows every call received, with what
   Publisher did.

## Signing a call

Every call carries

```
Content-Type: application/json
X-MeYouSocial-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>
```

where `v1 = lowercase hex of HMAC_SHA256(secret, "<t>.<raw body>")`.

- **Sign the exact bytes you send.** Re-encoding the JSON after signing breaks the signature.
- **`t` must be within 5 minutes of Publisher's clock.** Sign each attempt when it is sent,
  including retries.
- **Rotating the secret:** when the operator presses *Make a new secret*, the old one keeps
  working for 24 hours. Switch WordPress to the new one within that day.

**Test vector.** With secret `mys_whsec_example_do_not_use_0123456789abcdef`, `t = 1764158400`
and body (no trailing newline)

```
{"id":"evt_test_0001","type":"ping","occurredAt":"2026-11-26T12:00:00Z"}
```

the header is

```
t=1764158400,v1=3c75405692a3f0abd36128f13cf13ec2d8b5e71357724965c26a2daab4c50011
```

(checked against Publisher's own code and `openssl dgst -sha256 -hmac`). Change one byte of
the body and Publisher answers 401 `mismatch`. Send it more than 300 s late and it answers 401
`stale`.

## The four calls

All are JSON objects with these common fields:

| Field | Rules |
| --- | --- |
| `id` | 8–100 characters, `A–Z a–z 0–9 _ . : -`. **Unique per event; a retry of the same event reuses it.** Publisher applies an id once; a repeat gets the first answer back with `"duplicate": true`. |
| `type` | `ping`, `membership.activated`, `membership.deactivated` or `membership.link` |
| `occurredAt` | ISO 8601 with a zone, e.g. `2026-11-26T15:04:05Z`: when the change happened on the website. An event older than the last one applied for that member and membership changes nothing (`stale`), so send real times. |

Member calls add:

| Field | Rules |
| --- | --- |
| `member.id` | The WordPress user id (string or number). |
| `member.email` | The member's email. **To turn a free trial into a member workspace, this must be the email they started the trial with.** |
| `member.name` | Optional. Used for "<name>'s workspace" when there's no company. |
| `member.company` | Optional. Names their workspace. |
| `membership.id` | The MemberPress membership (post) id. This is the key the operator mapped. |
| `membership.name` | Optional, e.g. "Steward". Shown in Publisher's log. |

### `ping`: check the connection

```json
{ "id": "evt_ping_20261126_1", "type": "ping", "occurredAt": "2026-11-26T12:00:00Z" }
```
→ `200 {"ok":true,"outcome":"pong","message":"Signature checked — Publisher is listening.", "eventId":"…"}`

### `membership.activated`: the member has this membership now

```json
{
  "id": "evt_8f0c2b6e-3f5d-4a8e-9a51-6f1d0f2c9a10",
  "type": "membership.activated",
  "occurredAt": "2026-11-26T15:04:05Z",
  "member": { "id": 412, "email": "ada@example.com", "name": "Ada Lovelace", "company": "Analytical Ltd" },
  "membership": { "id": 7834, "name": "Steward" }
}
```

What Publisher does for **own workspace**:

- First time: makes the workspace and an invitation for the member. Answers `invited` with
  `link.kind = "claim"`.
- Same email has a free trial: that trial becomes the member workspace (no end date, no
  allowance). Answers `attached`; they're already in, so `link.kind = "sign_in"`.
- The member already has a workspace from another membership (an upgrade): that workspace keeps
  going. Answers `attached`.
- It had lapsed: the workspace opens again as it was. Answers `reactivated`.
- Already active: answers `unchanged` (harmless; send state as often as you like).

For **a seat**: an invitation into the chosen workspace with the chosen role. Answers `invited`,
or `refused` when that workspace only accepts certain email domains.

### `membership.deactivated`: the member no longer has this membership

Same shape as `activated`. Publisher:

- **own workspace:** pauses it. It is kept whole, closed to its members, with the engine and AI
  stopped. It does not pause if another active membership of theirs keeps it (an upgrade's old
  plan ending).
- **seat:** withdraws the seat. It comes back if the membership does.
- Any unused invitation is withdrawn. Answers `lapsed`, or `unchanged`, or `ignored` if the
  membership never gave anything.

Send this when access **ends**, not when someone cancels auto-renew while still paid up (see
*When to send which*).

### `membership.link`: where does this member go now?

```json
{
  "id": "evt_link_412_1764169445",
  "type": "membership.link",
  "occurredAt": "2026-11-26T15:04:05Z",
  "member": { "id": 412, "email": "ada@example.com" }
}
```
`membership` is optional. Without it, every membership of the member is listed in `grants`. This
call changes nothing except one thing: an expired unused invitation is replaced with a fresh one.
Use it whenever a page shows the member a Publisher button (their account page, say). Claim
links last 30 days, so don't store them.

## Answers

Always JSON:

```json
{
  "ok": true,
  "outcome": "invited",
  "message": "Steward started: workspace Analytical Ltd is ready for ada@example.com.",
  "eventId": "evt_8f0c…",
  "workspace": { "id": "cm…", "name": "Analytical Ltd", "held": null, "trialEndsAt": null },
  "link": { "kind": "claim", "url": "https://sparkweb-production.up.railway.app/invitations/AbC…", "expiresAt": "2026-12-26T15:04:06.000Z" }
}
```

- `link.kind = "claim"`: the member's invitation. Opening it lets them create their account (with
  **that email**) or sign in, and lands them in the workspace. Show it as **"Set up your
  Publisher account"**.
- `link.kind = "sign_in"`: they're already in. Show **"Open Publisher"** (`<publisher>/signin`).
- `link: null`: nothing to open, for example after `lapsed`.
- `workspace.held`: `null`, or `trial_ended` / `trial_used_up` / `membership_lapsed` when it is paused.
- `grants`: only on `membership.link`. Each entry is
  `{plan:{id,name}, status:"active"|"lapsed", access:"workspace"|"join", workspace, link}`.

| HTTP | `outcome` | Meaning | What the website does |
| --- | --- | --- | --- |
| 200 | `pong` | Ping answered | — |
| 200 | `invited` / `attached` / `reactivated` | Access given | Show `link.url` |
| 200 | `unchanged` | Already so | Show `link.url` if you need it |
| 200 | `lapsed` | Access ended, workspace paused | — |
| 200 | `linked` | Answer to `membership.link` | Show `link.url` |
| 200 | `stale` | Older than the last event applied | Nothing; it's harmless |
| 200 | `ignored` | Membership not mapped, or nothing to end | Tell the operator to map it on Settings → Sign-ups; retrying the same id later re-applies it |
| 200 | `refused` | Seat refused (email domain rule) | Tell the operator |
| 400 | `bad_request` | Payload invalid; `message` names the field | Fix the code; don't retry as is |
| 401 | `unauthorized` | Signature missing / malformed / stale / mismatch | Check the secret, the clock, and that you signed the exact body |
| 409 | `in_progress` | Same id is being applied right now | Retry in a minute |
| 413 | `bad_request` | Body over 64 KB | — |
| 429 | — | Over 120 calls a minute from one address (`Retry-After` header) | Back off |
| 500 | `failed` | Publisher couldn't apply it; nothing half-done is kept as the answer | Retry with the **same id**, freshly signed |
| 503 | `not_set_up` | No signing secret yet | Operator makes one |

## When to send which (MemberPress)

**Send state, not events.** Whenever something changes a user's memberships, ask MemberPress
whether the user is active on each mapped membership right now, and send `activated` or
`deactivated` with `occurredAt` = now. Sending the same state twice is harmless (`unchanged`).
Cancelling auto-renew, payments and expiries in any order all come out right.

- Good moments to send: signup completed, transaction completed / refunded / expired,
  subscription created / stopped / expired / upgraded / downgraded, member deleted. MemberPress
  fires these as WordPress actions named `mepr-event-<event>` (e.g.
  `mepr-event-transaction-completed`). **Check the names against the installed MemberPress
  version** (its event list, or the Developer Tools add-on) before relying on one.
- The check: `( new MeprUser( $user_id ) )->is_active_on_membership( $membership_id )`, or the
  user's active product subscriptions. Again, confirm against the installed version.
- **Daily reconciliation (recommended):** a once-a-day WP-Cron job that sends the current state
  for every member of a mapped membership. It repairs any call lost to an outage on either side.
- **Upgrades:** send `activated` for the new membership first, then `deactivated` for the old one.
  The order doesn't actually matter: Publisher keeps the workspace while any membership of theirs
  is active.

## Retries

- Network error, 409, 429, 500: retry with the **same `id` and body**, signed again with a fresh
  `t`. Back off, for example 1 min, 5 min, 30 min, then every 2 h for a day.
- 400, 401, 413: don't retry blindly; something on the website's side needs fixing.
- Keep each pending call (id, body, attempts) somewhere durable (an option or a small table) and
  retry it with `wp_schedule_single_event`, so a retry survives a page load ending.

## Reference sender (PHP sketch, adapt before use)

```php
/**
 * Send one event to Publisher. Returns the decoded answer, or WP_Error.
 * $event must already carry its id; a retry passes the same $event.
 */
function mys_publisher_send( array $event ) {
	$body = wp_json_encode( $event, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
	$t    = time();
	$sig  = hash_hmac( 'sha256', $t . '.' . $body, MYS_PUBLISHER_SECRET );
	$res  = wp_remote_post( MYS_PUBLISHER_ENDPOINT, array(
		'timeout' => 15,
		'headers' => array(
			'Content-Type'            => 'application/json',
			'X-MeYouSocial-Signature' => "t={$t},v1={$sig}",
		),
		'body'    => $body, // the exact bytes that were signed
	) );
	if ( is_wp_error( $res ) ) {
		return $res; // network error: retry later with the same $event
	}
	$code   = wp_remote_retrieve_response_code( $res );
	$answer = json_decode( wp_remote_retrieve_body( $res ), true );
	if ( in_array( $code, array( 409, 429, 500, 502, 503, 504 ), true ) ) {
		return new WP_Error( 'mys_retry', $answer['message'] ?? "HTTP $code", $answer );
	}
	return $answer; // 200: use $answer['link']; 4xx: log $answer['message'] and fix
}

/** The member's current state for one membership, as an event. */
function mys_membership_state_event( int $user_id, int $membership_id ) {
	$user   = get_userdata( $user_id );
	$mepr   = new MeprUser( $user_id );              // confirm the API on the installed version
	$active = $mepr->is_active_on_membership( $membership_id );
	return array(
		'id'         => 'evt_' . wp_generate_uuid4(),
		'type'       => $active ? 'membership.activated' : 'membership.deactivated',
		'occurredAt' => gmdate( 'c' ),
		'member'     => array(
			'id'      => $user_id,
			'email'   => $user->user_email,
			'name'    => trim( $user->first_name . ' ' . $user->last_name ),
			'company' => get_user_meta( $user_id, 'mepr_company', true ), // whichever field the signup form uses
		),
		'membership' => array( 'id' => $membership_id, 'name' => get_the_title( $membership_id ) ),
	);
}
```

**Testing from a shell** (Git Bash or Linux; replace the secret):

```bash
SECRET='mys_whsec_…'
BODY='{"id":"evt_ping_manual_1","type":"ping","occurredAt":"2026-11-26T12:00:00Z"}'
T=$(date +%s)
SIG=$(printf '%s' "$T.$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.*= //')
curl -s -X POST https://sparkweb-production.up.railway.app/api/membership/events \
  -H 'Content-Type: application/json' -H "X-MeYouSocial-Signature: t=$T,v1=$SIG" --data "$BODY"
```

## What to show the member

- **Thank-you page and welcome email:** after `activated`, show `link.url` as a button: "Set up
  your Publisher account" for `claim`, "Open Publisher" for `sign_in`. Publisher **can't email a
  brand-new person itself**: on its host, app mail has no mailbox. So the website is how the
  member gets the link.
- **Account page:** call `membership.link` when the page renders, and show the answer.
- **The claim link is personal.** It is an invitation for one email address and works once.
  Keep it out of public pages and page caches.
- **Free trial button:** link to `<publisher>/signup` once trials are open (they ship off). Tell
  people to use the same email when they become a member, so their trial workspace carries on.

## Data

Publisher stores what the calls carry (`member.id`, email, name, company, membership id and name)
in its log (MembershipEvent) and on the member's grant (MembershipGrant). Send nothing else.
