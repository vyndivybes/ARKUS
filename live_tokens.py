"""Issue one-use, tightly scoped Gemini Live tokens for consented direct WebSocket audio.

Only the short-lived Live token ever reaches the renderer; the real API key stays
server-side. This module makes no request until explicitly invoked.
"""
import json
import re
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

ENDPOINT="https://generativelanguage.googleapis.com/v1beta/auth_tokens"
MODEL_PATTERN=re.compile(r"gemini-[a-zA-Z0-9_.-]{3,90}")

class LiveTokenError(ValueError):
    pass

class LiveTokenIssuer:
    def __init__(self,key):
        if not isinstance(key,str) or not (8<=len(key)<=1000) or key.startswith("PUT-"):
            raise LiveTokenError("A private Google Gemini API key is required.")
        self.key=key

    def create(self,model):
        if not isinstance(model,str) or not MODEL_PATTERN.fullmatch(model):
            raise LiveTokenError("A valid Gemini Live model ID is required.")
        now=datetime.now(timezone.utc)
        expires=(now+timedelta(minutes=25)).strftime("%Y-%m-%dT%H:%M:%SZ")
        new_session=(now+timedelta(seconds=55)).strftime("%Y-%m-%dT%H:%M:%SZ")
        payload={
            "uses":1,
            "expireTime":expires,
            "newSessionExpireTime":new_session,
            "liveConnectConstraints":{
                "model":"models/"+model,
                "config":{"responseModalities":["AUDIO"]},
            },
        }
        request=urllib.request.Request(
            ENDPOINT,data=json.dumps(payload).encode("utf-8"),
            headers={"X-goog-api-key":self.key,"Content-Type":"application/json",
                     "Accept":"application/json"},method="POST")
        try:
            with urllib.request.urlopen(request,timeout=20) as response:
                raw=response.read(32769)
                if len(raw)>32768:
                    raise LiveTokenError("Gemini token response exceeds size limit.")
                data=json.loads(raw)
        except urllib.error.HTTPError as exc:
            raise LiveTokenError(f"Gemini token provisioning failed (HTTP {exc.code}). Check account and quota.") from None
        except (urllib.error.URLError,TimeoutError,OSError,ValueError) as exc:
            if isinstance(exc,LiveTokenError): raise
            raise LiveTokenError("Gemini Live token provisioning unavailable.") from None
        token=data.get("name") if isinstance(data,dict) else None
        if not isinstance(token,str) or not (8<=len(token)<=2048):
            raise LiveTokenError("Gemini did not return a usable scoped token.")
        return {"token":token,"model":model,"expires_at":expires}
