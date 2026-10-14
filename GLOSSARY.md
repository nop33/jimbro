# Jimbro

A workout tracker that runs on one phone and backs its data up to an account on the server.

## Backup

**Account**:
The backup on the server that this phone syncs with, named by a user ID and reached with a token. A phone has at most one at a time.
_Avoid_: cloud backup, credentials, config, user

**Passkey**:
The way a person signs up or signs in to an account, kept by the phone's password manager. One account can have several.
_Avoid_: login, key

**Token**:
The secret a phone sends to reach its account. A passkey sign-in gets one, and local runs, tests and MCP type one into Settings.
_Avoid_: password, API key

**Switch**:
Saving an account on a phone, whether by sign-up, sign-in or a typed token. The next sync is then a first sync with that account.
_Avoid_: login, save credentials

**First sync**:
The sync after a switch or a fresh install, which restores the account's rows and pushes it every row only this phone has.
_Avoid_: bootstrap, initial sync, restore

**Sign out**:
Forgetting the account on this phone. Its data stays on the phone and stops backing up.
_Avoid_: log out, disconnect
