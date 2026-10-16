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
        if key.strip().lower().endswith(".apps.googleusercontent.com"):
            raise LiveTokenError("Google OAuth client ID is not a Gemini API key. Create a Gemini key in Google AI Studio.")
        self.key=key

    def create(self,model,allow_unconstrained_fallback=False):
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
            if exc.code == 400 and allow_unconstrained_fallback is True:
                # Only an explicit local opt-in may remove model/config restrictions.
                # The token remains one-use and can start a session for only 55s;
                # the permanent API key never leaves this backend.
                basic_payload={
                    "uses":1,
                    "expireTime":expires,
                    "newSessionExpireTime":new_session
                }
                basic_request=urllib.request.Request(
                    ENDPOINT,data=json.dumps(basic_payload).encode("utf-8"),
                    headers={"X-goog-api-key":self.key,"Content-Type":"application/json",
                             "Accept":"application/json"},method="POST")
                try:
                    with urllib.request.urlopen(basic_request,timeout=20) as response:
                        raw=response.read(32769)
                        if len(raw)>32768:
                            raise LiveTokenError("Basic Gemini Live token response exceeds size limit.")
                        basic_data=json.loads(raw)
                except urllib.error.HTTPError as fallback:
                    raise LiveTokenError(
                        f"Basic one-use Gemini Live token request failed (HTTP {fallback.code}); "
                        f"no further fallback was attempted.") from None
                except (urllib.error.URLError,TimeoutError,OSError,ValueError):
                    raise LiveTokenError("Basic Gemini Live token unavailable.") from None
                token=basic_data.get("name") if isinstance(basic_data,dict) else None
                if not isinstance(token,str) or not (8<=len(token)<=2048):
                    raise LiveTokenError("Gemini did not return a usable one-use Live token.")
                return {"token":token,"model":model,"expires_at":expires,
                        "scope":"basic-one-use"}
            # Google error bodies can contain sensitive user data or credentials.
            # Show only an allowlisted machine-readable status, never raw text.
            reason = ""
            if exc.code == 400:
                try:
                    raw = exc.read(4097)
                    if len(raw) <= 4096:
                        body = json.loads(raw)
                        value = body.get("error", {}).get("status", "") if isinstance(body, dict) else ""
                        if value in ("INVALID_ARGUMENT", "FAILED_PRECONDITION",
                                     "PERMISSION_DENIED", "UNAUTHENTICATED", "RESOURCE_EXHAUSTED"):
                            reason = ": " + value
                except (ValueError, OSError, AttributeError, TypeError):
                    pass
            if exc.code == 400:
                raise LiveTokenError(
                    f"Gemini Live token rejected (HTTP 400{reason}). Check the Gemini API key and "
                    f"live_model; Google recommends gemini-3.8-live. This error occurs before "
                    f"microphone recording starts.") from None
            if exc.code == 401 or exc.code == 403:
                raise LiveTokenError(
                    f"Gemini Live authentication refused (HTTP {exc.code}). Check Gemini API key "
                    f"type, restrictions and project access in Google AI Studio.") from None
            if exc.code == 429:
                raise LiveTokenError("Gemini Live token quota exceeded (HTTP 429). Check Gemini API quota.") from None
            raise LiveTokenError(f"Gemini Live token provisioning failed (HTTP {exc.code}).") from None
        except (urllib.error.URLError,TimeoutError,OSError,ValueError) as exc:
            if isinstance(exc,LiveTokenError): raise
            raise LiveTokenError("Gemini Live token provisioning unavailable.") from None
        token=data.get("name") if isinstance(data,dict) else None
        if not isinstance(token,str) or not (8<=len(token)<=2048):
            raise LiveTokenError("Gemini did not return a usable scoped token.")
        return {"token":token,"model":model,"expires_at":expires}
