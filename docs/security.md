# JobHelp Security Model

This document describes where JobHelp stores secrets, the threat scenarios we
considered, and the recommendations a user should follow to keep their
Anthropic API key (and supporting configuration) safe.

JobHelp's design goal in v2.1: **nothing gets out, and no one who shouldn't
have access will get it.** The defaults are already strong (Drive's owner-only
ACL, browser-isolated extension storage). The recommendations below close the
remaining gaps that come from user error or accidental over-sharing.

---

## 1. Where secrets live

JobHelp handles four categories of sensitive data. Knowing where each lives is
the foundation for the rest of the threat model.

### 1.1 The Anthropic API key (`sk-ant-…`)

This is the most sensitive secret JobHelp touches — anyone with it can charge
your Anthropic account.

In **v2.0 and earlier**, the key lived in `chrome.storage.local` on each
machine the extension was installed on. `chrome.storage.local` is scoped to
the extension id and is unreadable by other extensions, by web pages, and by
other Chrome profiles. The data is, however, stored unencrypted on disk
under the Chrome user profile directory — anyone with read access to that
directory (root, an attacker who steals the laptop, a malicious process
running as your user) can recover it.

In **v2.1**, the key lives inside `jobhelp-config.json` on the user's Google
Drive. Drive's default ACL for newly-created files is "private to owner" —
no one except the file owner can read it, even via direct URL. This is
strictly stronger than v2.0 against the "stolen laptop" threat (the file is
not on disk) and strictly weaker against the "Drive ACL misconfiguration"
threat (a new failure mode that didn't exist before).

In **v2.1 with optional encryption** (this milestone), the key inside
`jobhelp-config.json` may additionally be wrapped in an AES-GCM 256-bit
ciphertext keyed by a user-supplied passphrase (see `configCrypto.ts`). With
this layer on, an attacker who reads the Drive file still cannot extract the
API key without the passphrase.

### 1.2 The Drive file id of `jobhelp-config.json`

The extension caches this in `chrome.storage.local` so it knows which Drive
file to fetch the config from. The file id itself is not sensitive — knowing
the id does not grant read access to the file. (Drive enforces ACL on every
read.)

### 1.3 Apps Script web app URL

The `/exec` URL of the deployed Apps Script (for example,
`<your Apps Script /exec URL>`) is a capability — anyone
who knows it can call the deployed endpoints. JobHelp deploys with
**Execute as: Me + Who has access: Anyone with the link** so the URL itself
is the only authorization. Treat it as a secret.

The URL lives in three places: inside `jobhelp-config.json`, inside the user's
Apps Script project (`Deploy → Manage deployments`), and in the extension's
in-memory state during a session.

### 1.4 Apps Script Script Properties

The Apps Script project itself can store small key-value secrets via
`PropertiesService`. v2.1 does **not** use this — all per-user configuration
lives in the Drive config file instead, by design (so a fresh deployment of
the Apps Script doesn't need any manual property setup).

### 1.5 The Anthropic API itself

Anthropic logs API requests for abuse-prevention and quota tracking, including
the API key used and the prompt content. This is outside JobHelp's control —
see Anthropic's data-retention policies.

---

## 2. Threat scenarios

We considered the following six scenarios. Each is rated low / medium / high
by **likelihood under normal use**, then mitigated by the recommendations in
§3.

### 2.1 Drive ACL misconfiguration (likelihood: medium)

The user shares the parent folder of `jobhelp-config.json` with a co-worker,
or sets it to "anyone with the link can view", and forgets that the config
file is inside that folder. Result: anyone with the share link can read the
API key.

**Mitigation:** keep `jobhelp-config.json` in a dedicated Drive folder that
is **not** shared with anyone. Audit sharing status periodically — Drive
displays a "shared" badge in the file list. The optional passphrase
encryption (§4) is a defense-in-depth layer against this scenario.

### 2.2 Malicious extension installed (likelihood: low)

A second Chrome extension with overly-broad permissions cannot read JobHelp's
`chrome.storage.local` directly (extension storage is per-extension), but it
can sometimes read web-page content. JobHelp's sidepanel renders the API key
in the Settings tab when the user views it. A malicious extension with
`<all_urls>` host permissions could potentially observe DOM content from a
side panel.

**Mitigation:** JobHelp's Settings tab masks the API key by default (only
shows the last 4 chars). Only install extensions you trust. Audit your
installed extensions: `chrome://extensions`.

### 2.3 Compromised browser / malware on the laptop (likelihood: low–medium)

If your machine is compromised, all bets are off — the attacker can read
`chrome.storage.local`, see what the API client sends to Anthropic, and
intercept your Google login. JobHelp cannot defend against this; the goal
shifts to **minimizing blast radius**.

**Mitigation:** rotate the API key as soon as you suspect compromise. Use
Anthropic's per-key spending limits (see Anthropic console).

### 2.4 Shoulder-surfer reading the Drive web UI (likelihood: low)

Someone glances at your screen while `jobhelp-config.json` is open in the
Drive document viewer. The JSON is shown as plaintext.

**Mitigation:** don't open the config file in the Drive web UI. The extension
fetches it via the API; you should never need to view the raw JSON. If you
do (debugging), use a private tab or close the file immediately. With
passphrase encryption (§4), only the encrypted blob is visible — useless to
a shoulder-surfer.

### 2.5 Drive search indexing (likelihood: low)

Drive indexes the content of files for in-account search. The API key would
match a search for `sk-ant`. This is only exploitable if an attacker can run
Drive searches **as you** (i.e. has your Google credentials) — at which
point they could read the file directly anyway. Cross-account search does
not exist.

**Mitigation:** none required at JobHelp's layer. Google-account 2FA is the
right defense.

### 2.6 Browser extension permission leaks (likelihood: low)

JobHelp requests `<all_urls>` host permissions (see
`extension/public/manifest.json`) so it can talk to `script.google.com`,
`api.anthropic.com`, and any job-board URL the user is viewing. A future
permission downgrade (to a narrower allowlist) would shrink the attack
surface. This is tracked but not blocking.

**Mitigation:** narrow the host_permissions in a future milestone once we
have a stable allowlist of which job boards we touch.

---

## 3. Recommendations

In order of impact:

### 3.1 Keep `jobhelp-config.json` in a dedicated, unshared Drive folder

Create a folder called something like "JobHelp Config" and put **only**
`jobhelp-config.json` inside it. Do not share this folder. Do not put it
inside another shared folder.

Drive shows a small "shared" badge on folders that have any sharing applied.
Glance at this every few weeks; if you see a badge on the JobHelp folder
unexpectedly, audit who has access.

### 3.2 Deploy Apps Script with the minimum-surface settings

When you create the deployment:

- **Execute as:** Me (so the deployed code runs as your Google account, with
  access to your Drive — anonymous callers don't get Drive access).
- **Who has access:** Anyone with the link (required for the extension to
  call the URL without OAuth — the URL itself is the credential).

If the `/exec` URL ever leaks, **redeploy** — Apps Script issues a new URL
on each new version. Save the new URL into `jobhelp-config.json` and discard
the old one.

### 3.3 Rotate the Anthropic API key quarterly

API key rotation is a standard hygiene practice. Anthropic's console lets
you create a new key without invalidating the old one — generate the new
key, paste it into JobHelp, verify a generate call works, then revoke the
old key.

If your Anthropic account is on a paid tier, you can also **restrict the
key to a specific IP**. JobHelp's calls all originate from the browser, so
restrict it to your home / office IP if you have a static one.

### 3.4 Use optional passphrase encryption (defense-in-depth)

See §4 below. This is optional — without it, Drive's owner-only ACL is your
only line of defense for the API key. With it, the API key is encrypted
inside `jobhelp-config.json` and a passphrase is required to unlock it.

### 3.5 Never paste config JSON into bug reports

If you file a bug, redact the `anthropicApiKey` field (and the `appsScriptUrl`,
which is also a capability). The other fields (folder ids, sheet id) are not
secret in themselves but combined with the API key they identify your
account uniquely — redact for privacy too.

### 3.6 Multi-user note

If you share JobHelp with a friend, **each user should deploy their own
Apps Script** with their own Anthropic API key — billed to them. Do not
share a single `jobhelp-config.json` between users.

This is for two reasons:

1. The Anthropic API key inside the file would be exposed to the second
   user, who could then consume your Anthropic quota.
2. The Apps Script `/exec` URL inside the file is deployed as "Execute as: Me",
   so the second user's Apps Script calls would run with **your** Drive
   permissions — they'd be writing into your Drive, not theirs.

Each user clones their own copy of the Apps Script project, deploys it,
generates their own API key, and creates their own `jobhelp-config.json`.

---

## 4. Optional passphrase encryption (configCrypto.ts)

This milestone adds `extension/src/lib/configCrypto.ts`, which provides
AES-GCM 256-bit encryption keyed by a PBKDF2-derived AES key. The intent is
to give users who are worried about the Drive ACL misconfiguration scenario
(§2.1) or the shoulder-surfer scenario (§2.4) a defense-in-depth option.

### 4.1 Algorithm choices

| Parameter        | Value          | Rationale |
| ---------------- | -------------- | --------- |
| Cipher           | AES-GCM        | NIST-standard authenticated encryption. Tamper-detection is built in. |
| Key length       | 256 bits       | Future-proofs against quantum-era halving (Grover's). |
| Key derivation   | PBKDF2-SHA256  | The only KDF Web Crypto exposes natively (Argon2 would be preferred but isn't in the spec). |
| PBKDF2 iterations| 600,000        | OWASP 2023 minimum for PBKDF2-SHA256. |
| IV size          | 12 bytes       | NIST SP 800-38D recommended for GCM. |
| Salt size        | 16 bytes       | Standard; defeats rainbow-table attacks. |
| Encoding         | base64         | Embeds cleanly in JSON; no `Buffer` dependency. |

### 4.2 The `EncryptedBlob` schema

```ts
interface EncryptedBlob {
  ciphertext: string; // base64
  iv: string;         // base64, 12 bytes
  salt: string;       // base64, 16 bytes
  iterations: number; // PBKDF2 iteration count used when encrypting
}
```

The `iterations` field travels with the blob so that future increases to the
default (e.g. when OWASP raises the floor) do not invalidate previously
encrypted blobs.

### 4.3 Integration plan — NOT yet wired

`configCrypto.ts` ships as standalone helpers only. The integration into
`configLoader.ts` is deferred to a follow-up milestone. The plan:

1. Add an optional `anthropicApiKeyEnc?: EncryptedBlob` field to
   `JobhelpConfig`, alongside the existing `anthropicApiKey: string`.
2. In `loadConfigFromDrive`, after parsing the JSON, branch:
   - If `anthropicApiKeyEnc` is present, prompt the user for the passphrase
     (one prompt per session, then cache the decrypted key in memory only),
     call `decryptString`, and replace `anthropicApiKey` with the result.
   - If only `anthropicApiKey` is present (legacy / unencrypted), use it
     directly.
3. Add a "Encrypt API key with passphrase" toggle in the Settings tab UI.
   When the user enables it: prompt for passphrase, call `encryptString`,
   write back to `jobhelp-config.json` with `anthropicApiKey: null` and the
   new `anthropicApiKeyEnc` field set.
4. Passphrase handling: never persist the passphrase. Cache only the
   *decrypted key* in memory (cleared on extension reload). Re-prompt on
   each browser session.

This keeps the change scope small in the current milestone (helpers + docs
only) and lets the integration land as a focused follow-up.

### 4.4 What encryption does NOT protect against

- A passphrase the user re-uses from another site that has been breached.
  → Pick a unique passphrase.
- A compromised browser (§2.3). The decrypted key sits in memory during
  use; malware on the machine can read it.
- Loss of the passphrase. There is no recovery — re-create the config file
  with a fresh API key.

The encryption layer **only** protects against scenarios where an attacker
can read the Drive file but cannot run code in your browser.

---

## 5. Logging and bug reports

JobHelp logs to the browser console for debugging. The current code does
**not** log the API key explicitly, but a config object accidentally passed
to `console.log` would expose it. When filing a bug:

- Open DevTools, copy the relevant console output.
- Search the copied text for `sk-ant` and `script.google.com/macros` and
  replace with `[REDACTED]` before sharing.
- The fileId of `jobhelp-config.json` is **not** sensitive; you can leave it.

If you spot a logging path that emits the API key, please file an issue —
that's a bug we'd fix immediately.

---

## 6. Change log

- **v2.1 (this doc):** initial security model written. `configCrypto.ts`
  helpers added; integration deferred to a follow-up milestone.
- **v2.0:** all secrets in `chrome.storage.local` per-machine.
