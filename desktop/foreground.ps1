$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ArkusWindow {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
'@
# Compile interop once, but make a FRESH Win32 query for every requested tick.
# Never cache identity or enumerate background windows. Input is a signal, never code.
while ($null -ne [Console]::ReadLine()) {
 try {
  $window = [ArkusWindow]::GetForegroundWindow()
  [uint32]$foregroundProcessId = 0
  [void][ArkusWindow]::GetWindowThreadProcessId($window, [ref]$foregroundProcessId)
  $foregroundProcess = Get-Process -Id $foregroundProcessId -ErrorAction Stop
  [Console]::WriteLine((@{pid=$foregroundProcessId; name=$foregroundProcess.ProcessName} | ConvertTo-Json -Compress))
 } catch { [Console]::WriteLine('{}') }
}
