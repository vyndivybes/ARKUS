// Exact wake-prefix and paired-device matching only. Never executes hardware actions.
export function matchDeviceCommand(text, devices) {
  if(typeof text!=='string' || text.length>180) return null;
  const cleaned=text.trim().toLowerCase().replace(/[.!?]+$/,'');
  const match=cleaned.match(/^(?:hey|okay|ok)\s+arkus[, ]+\s*(?:please\s+)?(?:turn|switch)\s+(on|off)\s+(?:the\s+)?([a-z0-9][a-z0-9 -]{0,79})$/);
  if(!match)return null;
  if(!Array.isArray(devices))throw new Error('Trusted device list is unavailable.');
  const target=match[2].trim().replace(/\s+/g,' ');
  const matches=devices.filter(d=>typeof d?.alias==='string'&&d.alias.trim().toLowerCase().replace(/\s+/g,' ')===target);
  if(matches.length!==1)throw new Error('Voice command must match one uniquely named trusted device.');
  return {device_id:matches[0].id,state:match[1],alias:matches[0].alias};
}
