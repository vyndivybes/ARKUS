"""Optional local-only TP-Link Kasa/Tapo device probe with human-gated switching.

Nothing scans the LAN or contacts a device until an explicit user-approved exact
RFC1918 IPv4 host is submitted. No model, voice agent, or MCP tool can invoke this
gateway. Hardware integration requires optional python-kasa and real verification.
No cloud credentials are collected, returned, logged, or persisted here.
"""
import asyncio
import ipaddress
import json
import os
import re
import secrets
import threading
import time
from pathlib import Path

RFC1918 = tuple(ipaddress.ip_network(n) for n in
                ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))
SAFE_TYPES = {"Bulb", "Plug", "WallSwitch", "LightStrip", "Strip"}
VOICE_AUTO_TYPES = {"Bulb", "LightStrip"}  # Never auto-switch outlets or relays.
MAC_PATTERN = re.compile(r"^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$")
MAX_DEVICES = 12


class SmartHomeError(ValueError):
    pass


def normalize_lan_host(host):
    if not isinstance(host, str) or not 7 <= len(host) <= 15:
        raise SmartHomeError("Enter a private LAN IPv4 address; hostnames and URLs are not allowed.")
    try:
        address = ipaddress.IPv4Address(host)
    except ipaddress.AddressValueError:
        raise SmartHomeError("Enter a private LAN IPv4 address; hostnames and URLs are not allowed.") from None
    if not any(address in network for network in RFC1918) or address.packed[-1] in (0, 255):
        raise SmartHomeError("Only an exact private LAN device address is permitted.")
    return str(address)


def _validate_device(result, host):
    if not isinstance(result, dict) or result.get("host") != host:
        raise SmartHomeError("The device returned inconsistent identification.")
    mac = result.get("mac")
    if not isinstance(mac, str) or not MAC_PATTERN.fullmatch(mac.upper()):
        raise SmartHomeError("Device has no usable identity fingerprint; pairing refused.")
    kind = result.get("type")
    if kind not in SAFE_TYPES:
        raise SmartHomeError("Unsupported device type; only selected lights and switches are eligible.")
    if type(result.get("is_on")) is not bool:
        raise SmartHomeError("Device power state unavailable; pairing refused.")
    return {
        "host": host, "mac": mac.upper(), "type": kind,
        "model": str(result.get("model") or "")[:80],
        "alias": str(result.get("alias") or "")[:80],
        "is_on": result["is_on"],
    }


class KasaAdapter:
    """Requires an optionally installed python-kasa package; never broadcasts."""
    @staticmethod
    def _device(host, operation):
        async def work():
            try:
                from kasa import Discover
            except ImportError:
                raise SmartHomeError("Optional python-kasa is not installed. No network action taken.") from None
            try:
                device = await asyncio.wait_for(
                    Discover.discover_single(host, discovery_timeout=3, timeout=3), timeout=7)
                if device is None:
                    raise SmartHomeError("No supported Kasa device replied at that local IP.")
                try:
                    await asyncio.wait_for(device.update(), timeout=7)
                    category = getattr(device, "device_type", None)
                    kind = getattr(category, "name", str(category))
                    observed = {
                        "host": host,
                        "mac": str(device.mac or ""),
                        "model": str(device.model or ""),
                        "alias": str(device.alias or ""),
                        "type": kind,
                        "is_on": device.is_on,
                    }
                    _validate_device(observed, host)
                    if operation is not None:
                        expected_mac, desired = operation
                        if observed["mac"].upper() != expected_mac:
                            raise SmartHomeError("Device identity changed. Action refused.")
                        method = device.turn_on if desired else device.turn_off
                        await asyncio.wait_for(method(), timeout=7)
                        await asyncio.wait_for(device.update(), timeout=7)
                        observed["is_on"] = device.is_on
                        if observed["is_on"] is not desired:
                            raise SmartHomeError("Requested state was not confirmed by the device.")
                    return observed
                finally:
                    protocol = getattr(device, "protocol", None)
                    close = getattr(protocol, "close", None)
                    if close is not None:
                        await close()
            except SmartHomeError:
                raise
            except Exception:
                # Never surface raw provider credentials or LAN request contents.
                raise SmartHomeError("Local device unavailable, unsupported, or requires authentication.") from None
        return asyncio.run(work())

    def probe(self, host):
        return self._device(host, None)

    def switch(self, host, on, expected_mac):
        return self._device(host, (expected_mac, on))


class SmartHomeGateway:
    def __init__(self, data_dir, adapter=None):
        self.root = Path(data_dir).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.file = self.root / "smart-home-devices.json"
        self.lock = threading.RLock()
        self.adapter = adapter if adapter is not None else KasaAdapter()
        self.candidates = {}
        self.pending = {}
        self.last_voice = {}  # Session-only debounce.
        self.records = []
        self.events = []
        if self.file.is_symlink():
            raise SmartHomeError("Linked smart-home registry is prohibited.")
        if self.file.exists():
            if self.file.stat().st_size > 100_000:
                raise SmartHomeError("Smart-home registry exceeds limit.")
            try:
                payload = json.loads(self.file.read_text(encoding="utf-8"))
                self.records = payload["devices"]
                self.events = payload["audit"]
                if (not isinstance(self.records, list) or len(self.records) > MAX_DEVICES
                    or not isinstance(self.events, list) or len(self.events) > 80):
                    raise ValueError()
                for record in self.records:
                    if not isinstance(record, dict) or not isinstance(record.get("project"), str):
                        raise ValueError()
                    _validate_device({**record, "is_on": False}, normalize_lan_host(record.get("host")))
                    if type(record.get("voice_auto", False)) is not bool or (record.get("voice_auto") is True and record["type"] not in VOICE_AUTO_TYPES):
                        raise ValueError()
            except (ValueError, TypeError, KeyError, OSError, json.JSONDecodeError):
                raise SmartHomeError("Saved smart-home registry is invalid; no device accessed.") from None

    @staticmethod
    def _project(project):
        if not isinstance(project, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", project):
            raise SmartHomeError("A valid active workspace is required.")
        return project

    def _save(self):
        if self.file.is_symlink():
            raise SmartHomeError("Linked smart-home registry is prohibited.")
        data = json.dumps({"devices": self.records, "audit": self.events[-80:]}, separators=(",", ":"))
        if len(data) > 100_000:
            raise SmartHomeError("Smart-home registry is full.")
        temporary = self.root / ("smart-home-" + secrets.token_hex(8) + ".tmp")
        try:
            with temporary.open("x", encoding="utf-8") as output:
                output.write(data)
            os.replace(temporary, self.file)
        finally:
            temporary.unlink(missing_ok=True)

    def devices(self, project):
        with self.lock:
            project = self._project(project)
            return [dict(device) for device in self.records if device["project"] == project]

    def audit(self, project):
        with self.lock:
            project = self._project(project)
            return [dict(event) for event in self.events if event["project"] == project][-25:]

    def discover(self, project, host, *, approved=False):
        project = self._project(project)
        host = normalize_lan_host(host)
        if approved is not True:
            raise SmartHomeError("Explicit approval is required to probe this one local host.")
        with self.lock:
            info = _validate_device(self.adapter.probe(host), host)
            identifier = secrets.token_urlsafe(10)
            self.candidates[identifier] = {"project": project, "device": info,
                                           "expires": time.monotonic() + 120}
            return {"status": "candidate", "id": identifier, **info}

    def pair(self, project, candidate_id, *, approved=False):
        with self.lock:
            project = self._project(project)
            candidate = self.candidates.get(candidate_id)
            if not candidate or candidate["project"] != project:
                raise SmartHomeError("No authorized device candidate in this workspace.")
            if approved is not True or time.monotonic() > candidate["expires"]:
                raise SmartHomeError("Pairing requires fresh explicit approval.")
            previous = candidate["device"]
            current = _validate_device(self.adapter.probe(previous["host"]), previous["host"])
            if current["mac"] != previous["mac"]:
                raise SmartHomeError("Device identity changed since discovery.")
            if len(self.records) >= MAX_DEVICES:
                raise SmartHomeError("Trusted device registry limit reached.")
            if any(d["project"] == project and d["host"] == current["host"] for d in self.records):
                raise SmartHomeError("This LAN address is already paired.")
            record = {"project": project, "id": secrets.token_urlsafe(10), "voice_auto": False,
                      **{k: current[k] for k in ("host", "mac", "type", "model", "alias")}}
            self.records.append(record)
            try:
                self._save()
            except Exception:
                self.records.pop()
                raise
            del self.candidates[candidate_id]
            return dict(record)

    def unpair(self, project, device_id, *, approved=False):
        with self.lock:
            project = self._project(project)
            if approved is not True:
                raise SmartHomeError("Explicit approval is required to unpair a device.")
            for i, device in enumerate(self.records):
                if device["project"] == project and device["id"] == device_id:
                    self.records.pop(i)
                    self.pending = {key: plan for key, plan in self.pending.items()
                                    if plan["device"]["id"] != device_id}
                    self._save()
                    return {"status": "unpaired"}
            raise SmartHomeError("Device is not paired to this workspace.")


    def set_voice_auto(self, project, device_id, enabled, *, approved=False):
        """Permit hands-free switching only for deliberately enrolled light-class devices."""
        with self.lock:
            project = self._project(project)
            if approved is not True or type(enabled) is not bool:
                raise SmartHomeError("Changing voice permissions requires explicit local approval.")
            device = next((d for d in self.records if d["project"] == project and d["id"] == device_id), None)
            if not device:
                raise SmartHomeError("Pair this device in the active workspace first.")
            if enabled and device["type"] not in VOICE_AUTO_TYPES:
                raise SmartHomeError("Automatic switching is limited to lights, not plugs or wall switches.")
            previous = device.get("voice_auto", False)
            device["voice_auto"] = enabled
            try:
                self._save()
            except Exception:
                device["voice_auto"] = previous
                raise
            return {"device": device["alias"], "voice_auto": enabled}

    @staticmethod
    def _voice_intent(utterance):
        """Match only wake-prefixed exact device names, never arbitrary LLM instructions."""
        if type(utterance) is not str or len(utterance) > 180:
            raise SmartHomeError("Invalid spoken device command.")
        cleaned = re.sub(r"[.!?]+$", "", utterance.strip().lower())
        match = re.fullmatch(
            r"(?:hey|okay|ok)\s+arkus[, ]+\s*(?:please\s+)?(?:turn|switch)\s+(on|off)\s+(?:the\s+)?([a-z0-9][a-z0-9 -]{0,79})",
            cleaned
        )
        if not match:
            raise SmartHomeError("Say 'Hey ARKUS, turn on Study Light' using the trusted device name.")
        return match.group(1), " ".join(match.group(2).split())

    def voice(self, project, utterance):
        """Voice transcript: propose typed approval or execute an explicitly enrolled light."""
        with self.lock:
            project = self._project(project)
            desired, name = self._voice_intent(utterance)
            matches = [d for d in self.records if d["project"] == project and
                       " ".join(d["alias"].strip().lower().split()) == name]
            if len(matches) != 1:
                raise SmartHomeError("No uniquely named trusted device matched this spoken command.")
            device = matches[0]
            if device.get("voice_auto") is not True:
                return {"status": "approval-required", **self.propose(project, device["id"], desired)}
            if device["type"] not in VOICE_AUTO_TYPES:
                raise SmartHomeError("Only enrolled lights can be switched automatically.")
            key = (project, device["id"])
            now = time.monotonic()
            if now - self.last_voice.get(key, -1e9) < 5:
                raise SmartHomeError("Voice command rate limit: wait five seconds.")
            self.last_voice[key] = now
            log = {"project": project, "device": device["id"], "action": desired,
                   "source": "voice-auto", "status": "failed"}
            try:
                current = _validate_device(self.adapter.probe(device["host"]), device["host"])
                if current["mac"] != device["mac"] or current["type"] != device["type"]:
                    raise SmartHomeError("Device identity or type changed. Voice action refused.")
                state = desired == "on"
                result = _validate_device(self.adapter.switch(device["host"], state, device["mac"]), device["host"])
                if result["mac"] != device["mac"] or result["type"] != device["type"] or result["is_on"] is not state:
                    raise SmartHomeError("Device did not confirm the requested state.")
                log["status"] = "complete"
                return {"status": "complete", "device": device["alias"], "is_on": result["is_on"]}
            finally:
                self.events.append(log)
                self.events = self.events[-80:]
                self._save()

    def propose(self, project, device_id, desired):
        with self.lock:
            project = self._project(project)
            if type(desired) is not str or desired not in ("on", "off"):
                raise SmartHomeError("Only an explicit on or off action is supported.")
            device = next((d for d in self.records
                           if d["project"] == project and d["id"] == device_id), None)
            if not device:
                raise SmartHomeError("Pair a verified device in this workspace first.")
            if len(self.pending) >= 32:
                raise SmartHomeError("Too many pending device actions.")
            identifier = secrets.token_urlsafe(12)
            # The exact phrase must be typed by the human; not supplied to AI tools.
            confirmation = "TURN " + desired.upper() + " " + device["alias"] + " " + identifier[-6:]
            self.pending[identifier] = {"project": project, "device": dict(device),
                                        "desired": desired == "on", "confirmation": confirmation,
                                        "expires": time.monotonic() + 90}
            return {"id": identifier, "device": device["alias"], "state": desired,
                    "confirmation": confirmation, "expires_in_seconds": 90}

    def execute(self, project, action_id, confirmation):
        with self.lock:
            project = self._project(project)
            plan = self.pending.get(action_id)
            if plan is None or plan["project"] != project:
                raise SmartHomeError("Unknown or already-used device action.")
            if time.monotonic() > plan["expires"]:
                del self.pending[action_id]
                raise SmartHomeError("Device approval expired. Propose a new action.")
            if type(confirmation) is not str or confirmation != plan["confirmation"]:
                raise SmartHomeError("Type the exact approval phrase before changing a device.")
            del self.pending[action_id]  # Consume before any hardware interaction.
            device = plan["device"]
            log = {"project": project, "device": device["id"],
                   "action": "on" if plan["desired"] else "off", "status": "failed"}
            try:
                current = _validate_device(self.adapter.probe(device["host"]), device["host"])
                if current["mac"] != device["mac"]:
                    raise SmartHomeError("Device identity changed. Action refused.")
                result = _validate_device(
                    self.adapter.switch(device["host"], plan["desired"], device["mac"]), device["host"])
                if result["mac"] != device["mac"] or result["is_on"] is not plan["desired"]:
                    raise SmartHomeError("The device did not confirm the requested action.")
                log["status"] = "complete"
                return {"status": "complete", "device": device["alias"],
                        "is_on": result["is_on"]}
            finally:
                self.events.append(log)
                self.events = self.events[-80:]
                self._save()
