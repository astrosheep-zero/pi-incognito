# Public Windows API probe: a DOS-device alias, not an NTFS symlink.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class DosDeviceProbe {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool DefineDosDevice(uint flags, string name, string target);
  public static void Map(string name, string target) {
    if (!DefineDosDevice(1 | 8, name, target)) throw new Win32Exception(Marshal.GetLastWin32Error());
  }
  public static void Remove(string name, string target) {
    if (!DefineDosDevice(1 | 2 | 4 | 8, name, target)) throw new Win32Exception(Marshal.GetLastWin32Error());
  }
}
'@
$name = "pi-incognito-$PID-$([guid]::NewGuid().ToString().Substring(0, 8))"
$dir = Join-Path $env:TEMP $name
New-Item -ItemType Directory -Path $dir | Out-Null
Set-Content -NoNewline (Join-Path $dir 'public.jsonl') 'public prefix'
$env:PI_DEVICE_PATH = "\\.\$name\public.jsonl"
$env:PI_DEVICE_PHASE = 'public'
try {
  [DosDeviceProbe]::Map($name, "\??\$dir")
  node test/windows-dos-device-probe.mjs
  if ($LASTEXITCODE -ne 0) { throw 'public alias check failed' }
  [DosDeviceProbe]::Map($name, '\Device\Null')
  $env:PI_DEVICE_PHASE = 'private'
  node test/windows-dos-device-probe.mjs
  if ($LASTEXITCODE -ne 0) { throw 'null alias check failed' }
} finally {
  [DosDeviceProbe]::Remove($name, '\Device\Null')
  [DosDeviceProbe]::Remove($name, "\??\$dir")
  Get-Content (Join-Path $dir 'public.jsonl')
  Remove-Item -Recurse -Force $dir
}
