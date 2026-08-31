import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]

def test_web_has_fail_closed_oidc_code_pkce_session_lifecycle():
    result=subprocess.run(["npm","--prefix","apps/web","run","build"],cwd=ROOT,text=True,capture_output=True)
    assert result.returncode==0,result.stdout+result.stderr
    helper=(ROOT/"apps/web/app/lib/oidc.ts").read_text()
    sign_in=(ROOT/"apps/web/app/api/auth/sign-in/route.ts").read_text()
    callback=(ROOT/"apps/web/app/api/auth/callback/route.ts").read_text()
    sign_out=(ROOT/"apps/web/app/api/auth/sign-out/route.ts").read_text()
    for requirement in ('response_type: "code"','code_challenge_method: "S256"','sablestone_oidc_state','sablestone_oidc_verifier'):
        assert requirement in sign_in
    for requirement in ('equalState(state, expectedState)','grant_type: "authorization_code"','code_verifier: verifier','new URL("/v1/session", config.apiUrl)','token.refresh_token !== undefined','httpOnly: true','secure: true','sameSite: "lax"'):
        assert requirement in callback+helper
    assert 'startsWith("//")' in helper
    assert 'scope.includes("offline_access")' in helper
    assert 'cookies.delete("sablestone_session")' in sign_out

def test_api_validates_web_token_before_cookie_creation():
    api=(ROOT/"src/api/server.ts").read_text()
    assert '"/v1/session"' in api
    segment=api[api.index('"/v1/session"'):api.index('app.get("/readyz"')]
    for role in ("OPERATIONS","SYSTEM","SUPPLIER","BUYER"):
        assert f'"{role}"' in segment
    callback=(ROOT/"apps/web/app/api/auth/callback/route.ts").read_text()
    assert "if (!validation.ok)" in callback
    assert "response.cookies.set(" in callback
    assert '"sablestone_session"' in callback
