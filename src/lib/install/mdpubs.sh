#!/bin/sh
# mdpubs CLI: publish markdown as a document your client can sign on a phone.
#
#   mdpubs login            connect this machine to your mdpubs account
#   mdpubs publish FILE.md  publish or update; prints the link to send
#   mdpubs status FILE.md   who has signed (also takes a document id)
#   mdpubs logout           forget this machine's token
#
# The token lives in ~/.config/mdpubs/auth-header and is passed to curl with
# `-H @file`, so it never appears in a command line, in output, or in the
# transcript of the AI agent running this.
set -eu

ORIGIN="${MDPUBS_ORIGIN:-__ORIGIN__}"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/mdpubs"
AUTH="$CONFIG_DIR/auth-header"
PENDING="$CONFIG_DIR/pending-login"

die() { echo "mdpubs: $*" >&2; exit 1; }

# Value of `key=value` on stdin.
field() { sed -n "s/^$1=//p"; }

# A top-level string field out of one-line JSON. Quotes inside JSON strings are
# escaped, so `"key":"` only ever matches a real key.
json_field() { sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p"; }

open_url() {
	if command -v open >/dev/null 2>&1 && [ "$(uname)" = Darwin ]; then open "$1" >/dev/null 2>&1 && return 0; fi
	if command -v xdg-open >/dev/null 2>&1 && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
		xdg-open "$1" >/dev/null 2>&1 && return 0
	fi
	if command -v wslview >/dev/null 2>&1; then wslview "$1" >/dev/null 2>&1 && return 0; fi
	return 1
}

# Poll for approval for up to $1 seconds. 0 = connected, 1 = still waiting.
poll() {
	device=$(cat "$PENDING")
	tries=$(( $1 / 3 ))
	while [ "$tries" -gt 0 ]; do
		body=$(curl -sS -w '\n%{http_code}' -X POST --data-urlencode "device=$device" "$ORIGIN/api/cli/token") ||
			die "could not reach $ORIGIN"
		code=$(printf '%s\n' "$body" | tail -n 1)
		case "$code" in
			200)
				umask 077
				printf 'Authorization: Bearer %s\n' "$(printf '%s\n' "$body" | head -n 1)" > "$AUTH"
				rm -f "$PENDING"
				echo "Connected. Ask for a document and it will be published with mdpubs."
				return 0 ;;
			202) ;;
			403) rm -f "$PENDING"; die "login was cancelled in the browser." ;;
			*) rm -f "$PENDING"; die "that login link expired. Run \`mdpubs login\` again." ;;
		esac
		tries=$((tries - 1))
		sleep 3
	done
	return 1
}

cmd_login() {
	mkdir -p "$CONFIG_DIR"
	chmod 700 "$CONFIG_DIR"

	# A second run picks up the login the first one started.
	if [ -f "$PENDING" ]; then
		poll 9 && return 0
		rm -f "$PENDING"
	fi

	reply=$(curl -fsS -X POST "$ORIGIN/api/cli/login") || die "could not reach $ORIGIN"
	printf '%s\n' "$reply" | field device > "$PENDING"
	chmod 600 "$PENDING"
	url=$(printf '%s\n' "$reply" | field url)
	code=$(printf '%s\n' "$reply" | field code)

	echo "Log in to mdpubs to finish setup:"
	echo
	echo "  $url"
	echo
	echo "  Code: $code"
	echo
	if open_url "$url"; then
		echo "Opened in your browser. Waiting for you to click Allow..."
		poll 90 && return 0
	fi
	echo "After clicking Allow, run \`mdpubs login\` again to finish."
	echo "(AI agent: show the user the link above, wait until they say they're done, then run \`mdpubs login\`.)"
}

require_auth() {
	[ -f "$AUTH" ] || die "not logged in. Run \`mdpubs login\` first."
}

# Print the body; exit non-zero with the server's error on a non-2xx reply.
request() {
	body=$(curl -sS -w '\n%{http_code}' -H @"$AUTH" "$@") || die "could not reach $ORIGIN"
	code=$(printf '%s\n' "$body" | tail -n 1)
	body=$(printf '%s\n' "$body" | sed '$d')
	case "$code" in
		2??) printf '%s\n' "$body" ;;
		*) die "$(printf '%s' "$body" | json_field error || true) (HTTP $code)" ;;
	esac
}

# Frontmatter value of $1 in file $2, quotes stripped.
frontmatter() {
	awk -v key="$1" '
		NR == 1 && $0 != "---" { exit }
		NR > 1 && $0 == "---" { exit }
		NR > 1 && index($0, key ":") == 1 {
			v = substr($0, length(key) + 2)
			sub(/^[ \t]+/, "", v); sub(/[ \t]+$/, "", v)
			if (v ~ /^".*"$/ || v ~ /^\047.*\047$/) v = substr(v, 2, length(v) - 2)
			print v; exit
		}' "$2"
}

# Record the document id in the file, so the next publish updates it.
write_id() {
	tmp="$2.mdpubs.tmp"
	if [ "$(head -n 1 "$2")" = "---" ]; then
		awk -v id="$1" 'NR == 1 { print; print "mdpubs: " id; next } { print }' "$2" > "$tmp"
	else
		{ printf -- '---\nmdpubs: %s\n---\n\n' "$1"; cat "$2"; } > "$tmp"
	fi
	mv "$tmp" "$2"
}

cmd_publish() {
	file="${1:-}"
	[ -n "$file" ] && [ -f "$file" ] || die "usage: mdpubs publish FILE.md"
	require_auth

	id=$(frontmatter mdpubs "$file")
	title=$(frontmatter title "$file")
	[ -n "$title" ] || title=$(basename "$file" | sed 's/\.[^.]*$//')

	if [ -n "$id" ]; then
		res=$(request -X PUT --form-string "title=$title" -F "content=<$file" "$ORIGIN/api/notes/$id")
	else
		res=$(request -X POST --form-string "title=$title" -F "content=<$file" -F "file_extension=md" "$ORIGIN/api/notes")
		id=$(printf '%s' "$res" | json_field publicId)
		[ -n "$id" ] && write_id "$id" "$file"
	fi
	url=$(printf '%s' "$res" | json_field url)
	echo "Published: ${url:-$ORIGIN/$id}"
}

cmd_status() {
	ref="${1:-}"
	[ -n "$ref" ] || die "usage: mdpubs status FILE.md|ID"
	require_auth
	if [ -f "$ref" ]; then
		ref=$(frontmatter mdpubs "$ref")
		[ -n "$ref" ] || die "that file has not been published yet."
	fi
	request "$ORIGIN/api/notes/$ref/sign"
}

case "${1:-}" in
	login) cmd_login ;;
	logout) rm -f "$AUTH" "$PENDING"; echo "Logged out. Revoke the token at $ORIGIN/account too if this machine is gone." ;;
	publish) shift; cmd_publish "$@" ;;
	status) shift; cmd_status "$@" ;;
	*) sed -n '2,8s/^# \{0,1\}//p' "$0"; exit 1 ;;
esac
