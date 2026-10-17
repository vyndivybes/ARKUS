"""Minimal Google Gemini REST adapter for ARKUS.

The key stays in an HTTP header and local ARKUS configuration. No third-party
SDK is required; billable calls are gated separately by the application's
provider-cost policy.
"""
import base64
import binascii
import json
import re
import urllib.error
import urllib.parse
import urllib.request

BASE="https://generativelanguage.googleapis.com/v1beta"


class GeminiError(ValueError):
    pass


class GeminiAdapter:
    def __init__(self,key):
        if not isinstance(key,str) or not key or len(key)>1000:
            raise GeminiError("A local Gemini API key is required.")
        self.key=key

    def _request(self,path,payload=None):
        if not path.startswith("/models") or "?" in path or ".." in path:
            raise GeminiError("Invalid Gemini endpoint.")
        request=urllib.request.Request(
            BASE+path,
            data=json.dumps(payload).encode("utf-8") if payload is not None else None,
            headers={"X-goog-api-key":self.key, "Content-Type":"application/json", "Accept":"application/json"},
            method="POST" if payload is not None else "GET",
        )
        try:
            with urllib.request.urlopen(request,timeout=35) as response:
                raw=response.read(3_000_001)
                if len(raw)>3_000_000:
                    raise GeminiError("Gemini response was too large.")
                return json.loads(raw)
        except urllib.error.HTTPError as exc:
            if exc.code == 429:
                # Do not forward Google response bodies (which could echo private context).
                raise GeminiError("Gemini API quota/rate limit reached (HTTP 429). "
                                  "Free-tier Google Search grounding may be unavailable; check project limits.") from None
            raise GeminiError(f"Gemini API returned HTTP {exc.code}. Check key, quotas and model availability.") from None
        except (urllib.error.URLError,TimeoutError,ValueError) as exc:
            if isinstance(exc,GeminiError):
                raise
            raise GeminiError("Gemini API unavailable or returned invalid JSON.") from None

    def models(self):
        data=self._request("/models")
        models=data.get("models",[])
        if not isinstance(models,list):
            raise GeminiError("Invalid Gemini models response.")
        result=[]
        for item in models:
            if not isinstance(item,dict):
                continue
            name=item.get("name","")
            if ("generateContent" in item.get("supportedGenerationMethods",[])
                and isinstance(name,str) and name.startswith("models/")):
                model=name.removeprefix("models/")
                if re.fullmatch(r"[a-zA-Z0-9_.-]{3,100}",model):
                    result.append(model)
        return result

    def format_request(self,messages):
        if not isinstance(messages,list) or not 1<=len(messages)<=32:
            raise GeminiError("Invalid conversation length.")
        content=[]
        system=[]
        for msg in messages:
            if not isinstance(msg,dict) or msg.get("role") not in ("system","user","assistant"):
                raise GeminiError("Unsupported message role.")
            value=msg.get("content")
            if not isinstance(value,str) or len(value)>40_000:
                raise GeminiError("Only bounded text messages are supported.")
            if msg["role"]=="system":
                system.append(value)
            else:
                content.append({"role":"model" if msg["role"]=="assistant" else "user",
                                "parts":[{"text":value}]})
        if not content:
            raise GeminiError("A user prompt is required.")
        result={"contents":content,"generationConfig":{"temperature":0.2,"maxOutputTokens":1200}}
        if system:
            result["systemInstruction"]={"parts":[{"text":"\n".join(system)}]}
        return result

    def grounded(self,model,question):
        """One explicit Google Search grounding request with returned source URLs."""
        if not isinstance(model,str) or not re.fullmatch(r"[A-Za-z0-9_.-]{3,100}",model):
            raise GeminiError("Invalid Gemini search model.")
        if not isinstance(question,str) or not (2<=len(question.strip())<=500):
            raise GeminiError("Ask a short factual search question.")
        payload=self.format_request([{"role":"user","content":question}])
        payload["tools"]=[{"googleSearch":{}}]
        response=self._request("/models/"+urllib.parse.quote(model,safe="")+":generateContent",payload)
        try:
            candidate=response["candidates"][0]
            answer="".join(p["text"] for p in candidate["content"]["parts"]
                           if isinstance(p,dict) and isinstance(p.get("text"),str)).strip()
            if not answer:raise ValueError()
            chunks=candidate.get("groundingMetadata",{}).get("groundingChunks",[])
            sources=[];seen=set()
            for chunk in chunks[:25]:
                source=chunk.get("web",{}) if isinstance(chunk,dict) else {}
                url=source.get("uri")
                if not isinstance(url,str) or len(url)>1500:continue
                parsed=urllib.parse.urlsplit(url)
                if parsed.scheme!="https" or not parsed.hostname or parsed.username or parsed.password:continue
                if url in seen:continue
                seen.add(url)
                sources.append({"url":url,"title":str(source.get("title") or parsed.hostname)[:140]})
                if len(sources)>=6:break
            return {"answer":answer,"sources":sources,"kind":"web","grounded":bool(sources)}
        except (ValueError,TypeError,KeyError,IndexError):
            raise GeminiError("Google Search returned no usable grounded answer.") from None

    @staticmethod
    def _answer(response):
        try:
            parts = response["candidates"][0]["content"]["parts"]
            answer = "".join(part["text"] for part in parts
                             if isinstance(part, dict) and isinstance(part.get("text"), str))
            if not answer.strip():
                raise ValueError()
            return answer.strip()
        except (ValueError, TypeError, KeyError, IndexError):
            raise GeminiError("Gemini returned no usable text response.") from None

    def describe_image(self, model, system, question, jpeg_base64):
        """Send a user-approved JPEG as Gemini inline_data, not a text-only prompt."""
        if not isinstance(model, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{3,100}", model):
            raise GeminiError("Invalid vision model name.")
        if not isinstance(jpeg_base64, str) or len(jpeg_base64) > 2_800_000:
            raise GeminiError("Invalid or oversized JPEG.")
        try:
            image = base64.b64decode(jpeg_base64, validate=True)
        except (ValueError, binascii.Error):
            raise GeminiError("Invalid JPEG encoding.") from None
        if not image.startswith(b"\xff\xd8\xff") or not image.endswith(b"\xff\xd9") or len(image) > 2_000_000:
            raise GeminiError("Invalid or oversized JPEG.")
        payload = self.format_request([
            {"role": "system", "content": system},
            {"role": "user", "content": question}
        ])
        payload["contents"][0]["parts"].append({
            "inline_data": {"mime_type": "image/jpeg", "data": jpeg_base64}
        })
        response = self._request("/models/" + urllib.parse.quote(model, safe="") + ":generateContent", payload)
        return self._answer(response)

    def complete(self,model,messages):
        if not isinstance(model,str) or not re.fullmatch(r"[A-Za-z0-9_.-]{3,100}",model):
            raise GeminiError("Invalid model name.")
        response=self._request("/models/"+urllib.parse.quote(model,safe="")+":generateContent",
                               self.format_request(messages))
        return self._answer(response)
