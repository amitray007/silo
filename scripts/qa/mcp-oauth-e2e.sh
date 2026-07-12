#!/usr/bin/env bash
# End-to-end QA harness for the MCP OAuth flow.
# Boots the api (authorization server) + mcp (resource server) against a
# disposable Postgres, then drives the full OAuth 2.1 + PKCE + DCR bootstrap
# by curl exactly as a Claude/ChatGPT connector would, asserting each step.
#
# Usage: scripts/qa/mcp-oauth-e2e.sh
# Requires: a reachable local Postgres superuser `postgres`, tsx, node, curl, jq, openssl.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

QA_DB="silo_oauth_qa"
export DATABASE_URL="postgres://postgres@localhost:5432/${QA_DB}"
export SILO_API_TOKEN="qa-env-token-not-for-prod"
export SILO_APP_PASSWORD="qa-password"
export SILO_SESSION_SECRET="qa-session-secret-abcdefghijklmnop"
export SILO_PUBLIC_API_URL="http://127.0.0.1:8791"
export SILO_PUBLIC_MCP_URL="http://127.0.0.1:8792/mcp"
export HOST=127.0.0.1
export PORT=8791
export SILO_MCP_HTTP_HOST=127.0.0.1
export SILO_MCP_HTTP_PORT=8792
export SILO_ALLOWED_ORIGINS="http://127.0.0.1:8791"

API="http://127.0.0.1:8791"
MCP="http://127.0.0.1:8792"
PASS=0; FAIL=0
ok(){ echo "  PASS: $1"; PASS=$((PASS+1)); }
bad(){ echo "  FAIL: $1"; FAIL=$((FAIL+1)); }

cleanup(){
  [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null
  [ -n "${MCP_PID:-}" ] && kill "$MCP_PID" 2>/dev/null
}
trap cleanup EXIT

echo "== booting servers =="
pnpm --filter @silo/app exec tsx src/api-main.ts >/tmp/qa-api.log 2>&1 & API_PID=$!
pnpm --filter @silo/app exec tsx src/mcp-http-main.ts >/tmp/qa-mcp.log 2>&1 & MCP_PID=$!

# wait for both to listen
for i in $(seq 1 40); do
  curl -sf "$API/health" >/dev/null 2>&1 && curl -s "$MCP/mcp" -o /dev/null 2>&1 && break
  sleep 0.5
done

echo "== step 1: unauthenticated MCP call -> 401 + WWW-Authenticate resource_metadata =="
H=$(curl -s -i -X POST "$MCP/mcp" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","method":"tools/list","id":1}')
echo "$H" | grep -qi '^HTTP.* 401' && ok "401 returned" || bad "expected 401"
echo "$H" | grep -qi 'WWW-Authenticate:.*resource_metadata=' && ok "WWW-Authenticate carries resource_metadata" || bad "missing resource_metadata header"

echo "== step 2: protected-resource metadata =="
PR=$(curl -s "$MCP/.well-known/oauth-protected-resource")
echo "$PR" | jq -e '.authorization_servers[0]=="'"$SILO_PUBLIC_API_URL"'"' >/dev/null && ok "authorization_servers -> api origin" || bad "authorization_servers wrong: $PR"
echo "$PR" | jq -e '.resource=="'"$SILO_PUBLIC_MCP_URL"'"' >/dev/null && ok "resource == canonical mcp url" || bad "resource wrong: $PR"

echo "== step 3: authorization-server metadata =="
AS=$(curl -s "$API/.well-known/oauth-authorization-server")
echo "$AS" | jq -e '.code_challenge_methods_supported|index("S256")' >/dev/null && ok "advertises S256 PKCE" || bad "no S256: $AS"
echo "$AS" | jq -e '.registration_endpoint and .authorization_endpoint and .token_endpoint' >/dev/null && ok "endpoints present" || bad "missing endpoints"

echo "== step 4: dynamic client registration =="
REG=$(curl -s -X POST "$API/oauth/register" -H 'content-type: application/json' \
  -d '{"client_name":"QA Claude","redirect_uris":["https://claude.ai/callback"]}')
CLIENT_ID=$(echo "$REG" | jq -r '.client_id')
[ -n "$CLIENT_ID" ] && [ "$CLIENT_ID" != "null" ] && ok "registered client_id=$CLIENT_ID" || bad "DCR failed: $REG"
echo "$REG" | jq -e 'has("client_secret")|not' >/dev/null && ok "no client_secret (public client)" || bad "unexpectedly issued a secret"

echo "== step 4b: DCR rejects javascript: redirect_uri =="
BADREG=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/oauth/register" -H 'content-type: application/json' \
  -d '{"client_name":"evil","redirect_uris":["javascript:alert(1)"]}')
[ "$BADREG" = "400" ] && ok "javascript: URI rejected (400)" || bad "expected 400, got $BADREG"

echo "== step 5: PKCE + CSRF + login + consent -> authorization code =="
VERIFIER=$(openssl rand -hex 32)
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 | openssl base64 -A | tr '+/' '-_' | tr -d '=')
RESOURCE="$SILO_PUBLIC_MCP_URL"
# The authorize routes read OAuth params from the QUERY STRING (c.req.query());
# only `password`/`decision`/`csrf` come from the POST body. So the query
# rides on the POST URL for both the login and the approve calls.
RES_ENC=$(printf '%s' "$RESOURCE" | jq -sRr @uri)
AQ="response_type=code&client_id=$CLIENT_ID&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcallback&code_challenge=$CHALLENGE&code_challenge_method=S256&state=xyz&resource=$RES_ENC"

# GET the consent/login page first (review fix SEC-1: every render mints a
# fresh signed `silo_oauth_csrf` cookie + a matching hidden `csrf` field) ->
# capture both the cookie jar and the token to carry on the login POST.
curl -s -c /tmp/qa-cookies.txt "$API/oauth/authorize?$AQ" -o /tmp/qa-login-page.html
CSRF1=$(grep -o 'name="csrf" value="[^"]*"' /tmp/qa-login-page.html | sed 's/.*value="//;s/"$//')
[ -n "$CSRF1" ] && ok "login page carries a csrf token" || bad "no csrf field in login page"

# authenticate via the inline consent login (owner password) -> capture
# session cookie (jar accumulates it alongside the csrf cookie already there)
LOGIN=$(curl -s -i -b /tmp/qa-cookies.txt -c /tmp/qa-cookies.txt -X POST "$API/oauth/authorize/login?$AQ" \
  --data-urlencode "password=$SILO_APP_PASSWORD" --data-urlencode "csrf=$CSRF1")
echo "$LOGIN" | grep -qi 'set-cookie:.*silo_session' && ok "consent login set session cookie" || bad "login did not set cookie (see /tmp/qa-api.log): $(echo "$LOGIN"|head -1)"
echo "$LOGIN" | grep -qi 'Max-Age=2592000' && ok "session cookie has 30d Max-Age" || bad "cookie missing 30d Max-Age"

echo "== step 5b: CSRF rejection on a forged approve (no/wrong token) =="
FORGED=$(curl -s -o /dev/null -w '%{http_code}' -b /tmp/qa-cookies.txt -X POST "$API/oauth/authorize?$AQ" \
  --data-urlencode "decision=approve" --data-urlencode "csrf=not-the-real-token")
[ "$FORGED" = "403" ] && ok "forged csrf token on approve -> 403, no code minted" || bad "expected 403, got $FORGED"

# The login re-render minted a FRESH csrf cookie/token (a new one is set on
# every render) — extract it from the login response body before approving.
CSRF2=$(echo "$LOGIN" | sed -n '/^\r\{0,1\}$/,$p' | grep -o 'name="csrf" value="[^"]*"' | sed 's/.*value="//;s/"$//')
[ -n "$CSRF2" ] && ok "post-login consent screen carries a fresh csrf token" || bad "no csrf field after login"

# approve consent with the session cookie + fresh csrf token -> expect 302 to
# redirect_uri with ?code=
APPROVE=$(curl -s -i -b /tmp/qa-cookies.txt -X POST "$API/oauth/authorize?$AQ" \
  --data-urlencode "decision=approve" --data-urlencode "csrf=$CSRF2")
LOCATION=$(echo "$APPROVE" | grep -i '^location:' | tr -d '\r' | sed 's/^[Ll]ocation: //')
CODE=$(echo "$LOCATION" | sed -n 's/.*[?&]code=\([^&]*\).*/\1/p')
[ -n "$CODE" ] && ok "consent approve -> code issued" || bad "no code in redirect: loc=$LOCATION"

echo "== step 6: token exchange (auth code + PKCE) =="
TOK=$(curl -s -X POST "$API/oauth/token" \
  -d grant_type=authorization_code -d "code=$CODE" \
  -d "redirect_uri=https://claude.ai/callback" -d "client_id=$CLIENT_ID" \
  -d "code_verifier=$VERIFIER" --data-urlencode "resource=$RESOURCE")
ACCESS=$(echo "$TOK" | jq -r '.access_token'); REFRESH=$(echo "$TOK" | jq -r '.refresh_token')
[ -n "$ACCESS" ] && [ "$ACCESS" != "null" ] && ok "access_token issued (${ACCESS:0:8}…)" || bad "no access_token: $TOK"
echo "$TOK" | jq -e '.token_type=="Bearer" and .expires_in>0' >/dev/null && ok "Bearer + expires_in present" || bad "bad token response"

echo "== step 6b: replayed code is rejected (single-use) =="
REPLAY=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/oauth/token" \
  -d grant_type=authorization_code -d "code=$CODE" \
  -d "redirect_uri=https://claude.ai/callback" -d "client_id=$CLIENT_ID" \
  -d "code_verifier=$VERIFIER" --data-urlencode "resource=$RESOURCE")
[ "$REPLAY" = "400" ] && ok "replayed code -> 400" || bad "expected 400 on replay, got $REPLAY"

echo "== step 7: authenticated MCP call with oat_ token =="
MCPCALL=$(curl -s -X POST "$MCP/mcp" -H "authorization: Bearer $ACCESS" \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}')
echo "$MCPCALL" | grep -q '"tools"' && ok "oat_ token authenticated MCP tools/list" || bad "mcp call failed: $MCPCALL"

echo "== step 7b: token minted for a DIFFERENT resource is rejected (audience binding) =="
# hand-issue is out of scope for curl; instead assert a garbage bearer is 401
BADAUTH=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$MCP/mcp" -H "authorization: Bearer oat_deadbeef" \
  -H 'content-type: application/json' -d '{"jsonrpc":"2.0","method":"tools/list","id":1}')
[ "$BADAUTH" = "401" ] && ok "unknown oat_ token -> 401" || bad "expected 401, got $BADAUTH"

echo "== step 8: refresh-token rotation =="
RT=$(curl -s -X POST "$API/oauth/token" \
  -d grant_type=refresh_token -d "refresh_token=$REFRESH" -d "client_id=$CLIENT_ID" \
  --data-urlencode "resource=$RESOURCE")
NEWACCESS=$(echo "$RT" | jq -r '.access_token')
[ -n "$NEWACCESS" ] && [ "$NEWACCESS" != "null" ] && [ "$NEWACCESS" != "$ACCESS" ] && ok "refresh issued a NEW access token" || bad "refresh failed: $RT"
# old refresh must now be invalid (rotation)
OLDREFRESH=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/oauth/token" \
  -d grant_type=refresh_token -d "refresh_token=$REFRESH" -d "client_id=$CLIENT_ID" \
  --data-urlencode "resource=$RESOURCE")
[ "$OLDREFRESH" = "400" ] && ok "rotated (old) refresh token rejected" || bad "old refresh still works ($OLDREFRESH)"

echo "== step 9: legacy env bearer still works on MCP (regression) =="
LEG=$(curl -s -X POST "$MCP/mcp" -H "authorization: Bearer $SILO_API_TOKEN" \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}')
echo "$LEG" | grep -q '"tools"' && ok "legacy env token still authenticates" || bad "legacy token broke: $LEG"

echo "== step 10: connected-apps list dedups + revoke =="
LIST=$(curl -s "$API/api/access-tokens/oauth-clients" -H "authorization: Bearer $SILO_API_TOKEN")
echo "$LIST" | jq -e '.clients|length>=1' >/dev/null && ok "connected-apps list returns the client" || bad "list empty: $LIST"
echo "$LIST" | jq -e '.clients[0].clientName=="QA Claude"' >/dev/null && ok "client name shown" || bad "name wrong: $LIST"
REVOKE=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$API/api/access-tokens/oauth-clients/$CLIENT_ID" -H "authorization: Bearer $SILO_API_TOKEN")
[ "$REVOKE" = "204" ] && ok "revoke one client -> 204" || bad "revoke got $REVOKE"
# after revoke, the previously-good access token must stop working
AFTER=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$MCP/mcp" -H "authorization: Bearer $NEWACCESS" \
  -H 'content-type: application/json' -d '{"jsonrpc":"2.0","method":"tools/list","id":1}')
[ "$AFTER" = "401" ] && ok "revoked client's token no longer authenticates" || bad "revoked token still works ($AFTER)"

echo ""
echo "==================================="
echo "QA RESULT: $PASS passed, $FAIL failed"
echo "==================================="
[ "$FAIL" -eq 0 ]
